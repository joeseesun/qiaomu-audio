// Browser timer shim for this Node-only controller test.
globalThis.window ||= globalThis;
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignWords, estimateMarks, markIndex, activeRange } from '../src/core/tts/timing.js';
import { buildSpeechRequest, synthesizeHttp, ttsProfile } from '../src/core/tts/providers.js';
import { TtsController } from '../src/core/tts/controller.js';

globalThis.window = globalThis;
const word = (w, a, b) => ({ word: w, startTime: a, endTime: b });
const b64 = text => Buffer.from(text).toString('base64');

test('provider words with trailing punctuation align onto the request text', () => {
  const { marks } = alignWords('你好，语音测试', [word('你', 0.2, 0.3), word('好，', 0.3, 0.7), word('语', 1, 1.1), word('音', 1.1, 1.2), word('测', 1.2, 1.4), word('试', 1.4, 1.7)]);
  assert.deepEqual(marks.map(m => [m.s, m.e]), [[0, 1], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7]]);
  assert.equal(markIndex(marks, 0.1), -1); assert.equal(markIndex(marks, 0.5), 1); assert.equal(markIndex(marks, 9), 5);
});
test('a word the provider rewrote is skipped instead of derailing later words', () => {
  const { marks } = alignWords('共12个，好', [word('共', 0, .1), word('十二', .1, .3), word('个，', .5, .7), word('好', .8, .9)]);
  assert.deepEqual(marks.map(m => m.s), [0, 3, 5]);
  assert.equal(marks.at(-1).e, 6);
});
test('estimates cover the measured audio and pause at punctuation', () => {
  const marks = estimateMarks('你好，世界。Hello world', 6, 0.5);
  assert.equal(marks[0].from, 0.5); assert.ok(Math.abs(marks.at(-1).to - 6.5) < 1e-9);
  const comma = marks.find(m => m.e === 3);
  const plain = marks.find(m => m.s === 3);
  assert.ok(comma.to - comma.from > plain.to - plain.from);
  assert.ok(marks.every((m, i) => i === 0 || m.from === marks[i - 1].to));
  assert.deepEqual(estimateMarks('x', 0), []);
});
test('active range ignores leading and trailing silence', () => {
  const pcm = new Int16Array(1000); pcm.fill(8000, 200, 800);
  assert.deepEqual(activeRange(pcm, 1000), { from: 0.2, to: 0.8 });
  assert.equal(activeRange(new Int16Array(10), 1000), null);
});
test('Doubao asks for word timestamps by model generation', () => {
  const body = id => JSON.parse(buildSpeechRequest({ ...ttsProfile({}, 'doubao'), resourceId: id }, 'Hi', 'k', true).body).req_params.audio_params;
  assert.equal(body('seed-tts-2.0').enable_subtitle, true);
  assert.equal(body('seed-tts-1.0').enable_timestamp, true);
  assert.equal(body('other').enable_subtitle, undefined);
  assert.equal(JSON.parse(buildSpeechRequest(ttsProfile({}, 'doubao'), 'Hi', 'k').body).req_params.audio_params.enable_subtitle, undefined);
});
test('Doubao frames yield audio plus aligned marks, including split sentences', async () => {
  const text = '你好，语音测试。再见';
  const stream = [
    { code: 0, message: 'OK', data: b64('ab'), sentence: { text: '你好，语音测试。', words: [word('你', .2, .3), word('好，', .3, .7), word('语', 1, 1.1), word('音', 1.1, 1.2), word('测', 1.2, 1.4), word('试。', 1.4, 1.7)] } },
    { code: 0, message: 'OK', data: b64('cd'), sentence: { text: '再见', words: [word('再', .1, .3), word('见', .3, .6)] } },
    { code: 20000000, message: 'OK', data: '' },
  ].map(x => JSON.stringify(x)).join('\n');
  const result = await synthesizeHttp(ttsProfile({}, 'doubao'), text, { key: 'k', request: async () => ({ status: 200, text: stream }) });
  assert.equal(result.bytes.length, 4);
  assert.equal(result.marks.length, 8);
  assert.deepEqual(result.marks.slice(-2).map(m => [m.s, m.e]), [[8, 9], [9, 10]]);
  assert.ok(result.marks[6].from >= result.marks[5].to - 1e-9, 'restarted clock continues after the first sentence');
});
test('Doubao retries without timestamps when the parameter is rejected, and works without any words', async () => {
  const sent = [];
  const result = await synthesizeHttp(ttsProfile({}, 'doubao'), 'Hi', { key: 'k', request: async req => {
    sent.push(JSON.parse(req.body).req_params.audio_params);
    return sent.length === 1 ? { status: 400, text: '{}' } : { status: 200, text: JSON.stringify({ code: 0, data: b64('a') }) };
  } });
  assert.equal(sent[0].enable_subtitle, true); assert.equal(sent[1].enable_subtitle, undefined);
  assert.equal(result.marks, undefined);
});
test('controller reports the spoken word; estimates and real marks both drive it', async () => {
  const seen = []; let audio;
  const c = new TtsController({
    synthesize: async (_p, text) => text === 'real' ? { bytes: new Uint8Array(1), mime: 'audio/mpeg', marks: [{ s: 0, e: 2, from: 0, to: 1 }, { s: 2, e: 4, from: 1, to: 2 }] } : { bytes: new Uint8Array(1), mime: 'audio/mpeg' },
    makeAudio: () => (audio = { duration: 4, currentTime: 0, ended: false, play: async () => {}, pause() {}, removeAttribute() {}, load() {} }),
  });
  globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
  c.start({ onProgress: (_i, _n, pos) => seen.push(pos) }, [{ text: 'real' }], { id: 'doubao' });
  await new Promise(r => setTimeout(r, 100)); audio.currentTime = 1.5; await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(seen.at(-1), { start: 2, end: 4 }); c.stop();
  seen.length = 0;
  c.start({ onProgress: (_i, _n, pos) => seen.push(pos) }, [{ text: '一二三四' }], { id: 'macos' });
  await new Promise(r => setTimeout(r, 100)); audio.currentTime = 3.9; await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(seen.at(-1), { start: 3, end: 4 }); c.stop();
  const before = seen.length; audio.currentTime = 0; await new Promise(r => setTimeout(r, 100));
  assert.equal(seen.length, before, 'no progress after stop');
});
