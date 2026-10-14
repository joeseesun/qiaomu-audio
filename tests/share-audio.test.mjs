import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_RATE, encodeMp3, envelope, id3Tag, srt, timeStretch, trimSilence } from '../src/core/share/audio.js';
import { assemble, retime, subtitleCues } from '../src/core/share/timeline.js';

const rate = SAMPLE_RATE;
// A pitched, voice-like tone with a slow amplitude wobble.
const tone = (seconds, hz = 220) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / rate) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / rate)));
// Dominant frequency by counting rising zero crossings.
const hertz = pcm => { let n = 0; for (let i = 1; i < pcm.length; i++) if (pcm[i - 1] < 0 && pcm[i] >= 0) n++; return n / (pcm.length / rate); };

test('time stretch changes length by the speed factor and keeps the pitch', async () => {
  const input = tone(3);
  for (const speed of [0.75, 1.5, 2]) {
    const out = await timeStretch(input, rate, speed);
    assert.ok(Math.abs(out.length / input.length - 1 / speed) < 0.01, `length at ${speed}x`);
    const mid = out.subarray(Math.round(out.length * 0.2), Math.round(out.length * 0.8));
    assert.ok(Math.abs(hertz(mid) - 220) < 12, `pitch at ${speed}x was ${hertz(mid)}`);
    assert.ok(Math.max(...mid.slice(0, 20000).map(Math.abs)) > 0.2, 'not silent');
  }
  assert.equal(await timeStretch(input, rate, 1), input);
});
test('time stretch can be cancelled', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(timeStretch(tone(30), rate, 1.5, { signal: controller.signal }), { name: 'AbortError' });
});
test('trimSilence keeps the voiced part and reports where it began', () => {
  const pcm = new Float32Array(rate * 3); pcm.set(tone(1), rate);
  const { pcm: cut, offset } = trimSilence(pcm, rate);
  assert.ok(Math.abs(offset - 0.96) < 0.01);
  assert.ok(Math.abs(cut.length / rate - 1.08) < 0.02);
});
test('assemble places sentences back to back with gaps and estimates missing word times', () => {
  const a = { item: { text: '你好世界。' }, pcm: tone(1) }, b = { item: { text: 'Second one' }, pcm: tone(0.5), trimmed: 0.1, marks: [{ s: 0, e: 6, from: 0.1, to: 0.4 }, { s: 7, e: 10, from: 0.4, to: 0.6 }] };
  const { cues, duration, pcm } = assemble([a, b], rate);
  assert.equal(pcm.length / rate, duration);
  assert.ok(Math.abs(cues[1].from - (1 + 0.22)) < 0.001);
  assert.ok(cues[0].marks.length >= 4 && cues[0].marks.at(-1).to <= 1.001);
  assert.ok(Math.abs(cues[1].marks[0].from - cues[1].from) < 1e-6 && Math.abs(cues[1].marks[1].to - (cues[1].from + 0.5)) < 1e-6);
  const fast = retime(cues, 0.5);
  assert.equal(fast[1].from, cues[1].from * 0.5); assert.equal(fast[1].marks[0].to, cues[1].marks[0].to * 0.5);
  assert.deepEqual(subtitleCues(fast).map(c => c.text), ['你好世界。', 'Second one']);
});
test('MP3 output decodes as MPEG audio of the right length and carries an ID3 title', async () => {
  const bytes = await encodeMp3(tone(2), rate, { meta: { title: '标题', artist: '乔木', cover: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } } });
  assert.equal(String.fromCharCode(...bytes.subarray(0, 3)), 'ID3');
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  assert.equal(bytes[10 + size], 0xff); assert.equal(bytes[11 + size] & 0xe0, 0xe0);
  const audio = bytes.length - 10 - size;
  assert.ok(Math.abs(audio / (96000 / 8) - 2) < 0.2, `~2 s of 96 kbit/s, got ${audio} bytes`);
  assert.equal(id3Tag({}).length, 10);
});
test('envelope follows loudness and subtitles format as SubRip', () => {
  const pcm = new Float32Array(rate * 2); pcm.set(tone(1), 0);
  const level = envelope(pcm, rate, 30);
  assert.equal(level.length, 60);
  assert.ok(level[10] > 0.4 && level[55] < 0.05);
  assert.equal(srt([{ from: 0, to: 1.5, text: '甲' }, { from: 3661.25, to: 3662, text: '乙' }]), '1\n00:00:00,000 --> 00:00:01,500\n甲\n\n2\n01:01:01,250 --> 01:01:02,000\n乙\n');
});
