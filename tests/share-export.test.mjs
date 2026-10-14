import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport, fileBase } from '../src/core/share/export.js';
import { SAMPLE_RATE } from '../src/core/share/audio.js';

const tone = seconds => Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 200 * i / SAMPLE_RATE));
const ctx = { font: '', measureText: text => ({ width: [...text].length * 30 }) };
const items = [{ text: '第一句话。' }, { text: '第二句话。' }, { text: 'Third one here.' }];
const deps = (extra = {}) => ({
  synthesize: async item => ({ bytes: item.text, mime: 'audio/mpeg' }),
  decode: async text => ({ pcm: tone(0.5 + (String(text).length > 6 ? 0.5 : 0)), rate: SAMPLE_RATE }),
  makeContext: () => ctx,
  renderVideo: async ({ scene, onProgress }) => { onProgress(0.5); return Uint8Array.from([scene.width > scene.height ? 2 : 1]); },
  renderCoverImage: async () => Uint8Array.from([9]),
  ...extra,
});

test('exports MP3, subtitles, both video shapes and a cover from the same track', async () => {
  const seen = [];
  const { files, duration, cues } = await runExport({ items, title: '分享 / 测试', artist: '乔木', speed: 1,
    outputs: { mp3: true, srt: true, cover: true, videos: ['portrait', 'landscape'] }, onProgress: p => seen.push(p.phase) }, deps());
  assert.deepEqual(files.map(f => f.name), ['分享 测试.mp3', '分享 测试.srt', '分享 测试-portrait.mp4', '分享 测试-landscape.mp4', '分享 测试-cover.png']);
  assert.deepEqual([files[2].bytes[0], files[3].bytes[0]], [1, 2]);
  assert.equal(cues.length, 3); assert.ok(duration > 2.3);
  assert.match(new TextDecoder().decode(files[1].bytes), /1\n00:00:00,\d+ --> .*\n第一句话。/);
  assert.ok(files[0].bytes.length > 1000 && seen.includes('voice') && seen.includes('video') && seen.includes('audio'));
});
test('speed shortens the track and re-times the subtitles to match', async () => {
  const normal = await runExport({ items, speed: 1, outputs: { srt: true } }, deps());
  const fast = await runExport({ items, speed: 2, outputs: { srt: true } }, deps());
  assert.ok(Math.abs(fast.duration / normal.duration - 0.5) < 0.03);
  assert.ok(Math.abs(fast.cues[2].from / normal.cues[2].from - 0.5) < 0.03);
});
test('sentences keep their order even when synthesis finishes out of order', async () => {
  const slow = deps({ synthesize: async item => { await new Promise(r => setTimeout(r, item.text.startsWith('第一') ? 30 : 1)); return { bytes: item.text }; } });
  const { cues } = await runExport({ items, outputs: {} }, slow);
  assert.deepEqual(cues.map(c => c.item.text), items.map(i => i.text));
});
test('cancelling stops before more audio is requested; failures name the sentence problem', async () => {
  const controller = new AbortController(); let calls = 0;
  const stop = deps({ synthesize: async () => { calls++; controller.abort(); return { bytes: 'x' }; } });
  await assert.rejects(runExport({ items, outputs: { mp3: true }, signal: controller.signal }, { ...stop, concurrency: 1 }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(runExport({ items, outputs: {} }, deps({ decode: async () => ({ pcm: new Float32Array(100), rate: SAMPLE_RATE }) })), { code: 'response' });
});
test('file names drop characters that are unsafe in paths', () => {
  assert.equal(fileBase('a/b:c*?'), 'a b c');
  assert.equal(fileBase('   '), 'qiaomu-audio');
  assert.equal(fileBase('很长'.repeat(40)).length, 40);
});
