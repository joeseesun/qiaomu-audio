import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';

globalThis.window = globalThis;
const bundle = await build({ entryPoints: ['src/runtime/apple.js'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'host', setup(b) {
  b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'mock' }));
  b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const Platform={isDesktop:false,isDesktopApp:false,isMacOS:false};' }));
} }] });
const { AppleSpeech, SystemRecorder, appleAvailable, createAppleSpeech } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function fixture() {
  const children = [], writes = [], removed = [];
  const bridge = new AppleSpeech({
    cp: { spawn(file, args, options) {
      assert.equal(file, '/Applications/Qiaomu Audio Helper.app/Contents/MacOS/qiaomu-audio-helper');
      assert.equal(options.shell, false);
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdin = { end() {} }; child.kills = 0;
      child.kill = () => { child.kills++; queueMicrotask(() => child.emit('close', 0)); };
      child.args = args; children.push(child); return child;
    } },
    fs: { access: async () => {}, mkdtemp: async () => '/tmp/owned-fixture', writeFile: async (...v) => writes.push(v), rm: async path => removed.push(path) },
    os: { tmpdir: () => '/tmp' }, path: { join: (...parts) => parts.join('/') },
  });
  return { bridge, children, writes, removed };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
test('mobile rejects native access before requiring Node or starting a process', () => {
  assert.equal(appleAvailable(), false);
  assert.throws(() => createAppleSpeech(), { code: 'applePlatform' });
});
test('missing helper has an actionable error', async () => {
  const { bridge } = fixture(); bridge.fs.access = async () => { throw Error('missing'); };
  await assert.rejects(bridge.status('zh'), { code: 'appleHelperMissing' });
});
test('native transcription uses private temporary audio, parses fragmented JSON and removes it', async () => {
  const { bridge, children, writes, removed } = fixture();
  const result = bridge.transcribe(new Uint8Array([1, 2]), 'en'); await turn();
  assert.deepEqual(children[0].args, ['transcribe', '/tmp/owned-fixture/speech.wav', 'en']);
  children[0].stdout.emit('data', Buffer.from('{"text":"hello'));
  children[0].stdout.emit('data', Buffer.from(' world"}\n')); children[0].emit('close', 0);
  assert.equal(await result, 'hello world'); assert.equal(writes[0][2].mode, 0o600); assert.deepEqual(removed, ['/tmp/owned-fixture']);
});
test('cancel kills only the requested native child and cleans temporary recording', async () => {
  const { bridge, children, removed } = fixture(), abort = new AbortController();
  const pending = bridge.transcribe(new Uint8Array([1]), 'zh', abort.signal); await turn(); abort.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(children[0].kills, 1); assert.equal(removed.length, 1);
});
test('malformed native output fails with protocol error and kills the child', async () => {
  const { bridge, children } = fixture(); const result = bridge.status('zh'); await turn();
  children[0].stdout.emit('data', Buffer.from('not-json\n'));
  await assert.rejects(result, { code: 'appleProtocol' }); assert.equal(children[0].kills, 1);
});
test('system audio uses the same samples for live phrases and saving, and stops on unload', async () => {
  const { bridge, children } = fixture(), frames = [];
  const recorder = new SystemRecorder(bridge, { onFrame: s => frames.push(s) });
  const starting = recorder.start(); await turn();
  children[0].stdout.emit('data', Buffer.from('{"ready":true}\n')); await starting;
  const pcm = new Float32Array([0.25, -0.5]);
  children[0].stdout.emit('data', Buffer.from(JSON.stringify({ pcm: Buffer.from(pcm.buffer).toString('base64') }) + '\n'));
  assert.deepEqual([...recorder.samples()], [0.25, -0.5]); assert.equal(frames.length, 1);
  await recorder.stop(); assert.equal(children[0].kills, 1);
  children[0].stdout.emit('data', Buffer.from(JSON.stringify({ pcm: Buffer.from(pcm.buffer).toString('base64') }) + '\n'));
  assert.equal(frames.length, 1);
  bridge.dispose();
});
test('stop during capture startup cannot leave a recording process behind', async () => {
  const { bridge, children } = fixture(), recorder = new SystemRecorder(bridge, {});
  const pending = recorder.start(); await turn(); await recorder.stop();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(children[0].kills, 1);
});

test('a malformed capture frame after readiness stops recording and reports the failure', async () => {
  const {bridge,children}=fixture(), errors=[];
  const recorder=new SystemRecorder(bridge,{onError:e=>errors.push(e.code)});
  const pending=recorder.start(); await turn();
  children[0].stdout.emit('data',Buffer.from('{"ready":true}\n')); await pending;
  children[0].stdout.emit('data',Buffer.from('invalid frame\n'));
  assert.deepEqual(errors,['appleProtocol']); assert.equal(recorder.stopped,true); assert.ok(children[0].kills>=1);
});
