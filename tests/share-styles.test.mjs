import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, fft, peakLevel, spectrum } from '../src/core/share/analysis.js';
import { DEFAULT_STYLE, STYLE_IDS, VISUAL_STYLES, bandsAt, levelAt, ramp, styleNeeds } from '../src/core/share/styles.js';
import { buildScene, drawContent } from '../src/core/share/scene.js';
import { normalizeSettings } from '../src/settings.js';
import { estimateMarks } from '../src/core/tts/timing.js';

const RATE = 44100;
const sine = (hz, seconds, amp = 0.4) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / RATE));

// A canvas that records what was drawn and measures text as 30px per character.
function recorder() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const target = { calls, measureText: text => ({ width: [...String(text)].length * 30 }), createLinearGradient: () => gradient, createRadialGradient: () => gradient };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : (...args) => { calls.push([key, ...args]); }),
    set: (object, key, value) => { object[key] = value; return true; },
  });
}
const cueOf = (text, from, to) => ({ item: { text }, from, to, marks: estimateMarks(text, to - from, from) });

test('FFT puts a pure tone in the right bin', () => {
  const n = 1024, re = Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 32 * i / n)), im = new Float32Array(n);
  fft(re, im);
  const power = Array.from(re, (r, i) => r * r + im[i] * im[i]);
  assert.equal(power.indexOf(Math.max(...power.slice(0, n / 2))), 32);
});
test('spectrum bands follow the pitch: a low tone lights low bands, a high tone lights high bands, silence nothing', () => {
  const quiet = new Float32Array(RATE), tone = (hz) => spectrum(Float32Array.from([...sine(hz, 1)]), RATE, 30);
  const at = (result, frame) => Array.from(result.spectrum.subarray(frame * result.bands, (frame + 1) * result.bands));
  const loudest = values => values.indexOf(Math.max(...values));
  const low = at(tone(200), 15), high = at(tone(3000), 15);
  assert.ok(loudest(low) < 16 && loudest(high) > 30, `low ${loudest(low)} high ${loudest(high)}`);
  assert.ok(Math.max(...at(spectrum(quiet, RATE, 30), 10)) === 0);
  assert.equal(tone(200).spectrum.length, 30 * 48);
});
test('analyse computes only what the style asks for', () => {
  const pcm = sine(300, 1);
  assert.deepEqual(Object.keys(analyse(pcm, RATE, [])).sort(), ['envelope', 'rate']);
  assert.ok(analyse(pcm, RATE, ['pcm']).pcm === pcm);
  const both = analyse(pcm, RATE, ['pcm', 'spectrum']);
  assert.ok(both.spectrum && both.bands === 48 && both.peak > 0.05);
  assert.ok(peakLevel(new Float32Array(100)) >= 0.05);
});
test('every registered style declares its needs and draws without throwing, in both shapes', () => {
  assert.ok(STYLE_IDS.includes(DEFAULT_STYLE) && STYLE_IDS.length >= 4);
  const pcm = sine(250, 3), cues = [cueOf('第一句话在这里。', 0, 1.5), cueOf('第二句话也在这里。', 1.7, 3)];
  for (const id of STYLE_IDS) {
    assert.ok(Array.isArray(VISUAL_STYLES[id].needs) && typeof VISUAL_STYLES[id].draw === 'function', id);
    for (const orientation of ['portrait', 'landscape']) {
      const ctx = recorder(), features = analyse(pcm, RATE, styleNeeds(id));
      const scene = buildScene({ orientation, title: '标题', cues, features, visual: id, duration: 3 }, ctx);
      assert.equal(scene.visual, id);
      drawContent(ctx, scene, 1.0);
      assert.ok(ctx.calls.filter(c => ['fill', 'stroke'].includes(c[0])).length > 10, `${id} ${orientation} drew shapes`);
    }
  }
});
test('unknown or missing styles fall back to the default; missing audio features draw nothing instead of crashing', () => {
  const ctx = recorder(), cues = [cueOf('一句话。', 0, 1)];
  assert.equal(buildScene({ orientation: 'portrait', title: 't', cues, features: { envelope: new Float32Array(30) }, visual: 'nope', duration: 1 }, ctx).visual, DEFAULT_STYLE);
  for (const id of STYLE_IDS) drawContent(ctx, buildScene({ orientation: 'portrait', title: 't', cues, features: { envelope: new Float32Array(30) }, visual: id, duration: 1 }, ctx), 0.5);
  const scene = { features: { envelope: Float32Array.from([0.2, 0.9]) } };
  assert.ok(Math.abs(levelAt(scene, 5) - 0.9) < 1e-6); assert.equal(bandsAt(scene, 0).length, 48);
});
test('the colour ramp runs cool to warm and stays inside 0..255', () => {
  assert.equal(ramp(0), 'rgb(125,211,252)'); assert.equal(ramp(1), 'rgb(240,171,252)'); assert.equal(ramp(-5), ramp(0)); assert.match(ramp(0.5), /^rgb\(167,139,250\)$/);
});
test('saved visual style is validated', () => {
  assert.equal(normalizeSettings({ share: { visual: 'ring' } }, true).share.visual, 'ring');
  assert.equal(normalizeSettings({ share: { visual: 'confetti' } }, true).share.visual, DEFAULT_STYLE);
  assert.equal(normalizeSettings({}, true).share.visual, DEFAULT_STYLE);
});
