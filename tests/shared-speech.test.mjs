import test from 'node:test';
import assert from 'node:assert/strict';
import { TtsController } from '../src/core/tts/controller.js';
import { coordinateSpeech } from '../src/shared/coordination.js';
import { speechFingerprint, rememberProgress, resumeOffset } from '../src/shared/progress.js';
import { normalizeSettings } from '../src/settings.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function workspace() {
  const listeners = new Set();
  return { on: (_name, fn) => { listeners.add(fn); return fn; }, trigger: (_name, source) => { for (const fn of listeners) fn(source); }, offref: fn => listeners.delete(fn), listeners };
}
function controller(bus) {
  let coordination;
  const c = new TtsController({ beforePlay: () => coordination.claim(), synthesize: async () => ({ bytes: new Uint8Array([1]), mime: 'audio/mpeg' }), makeAudio: () => ({ play: async () => {}, pause() {}, load() {}, removeAttribute() {} }) });
  coordination = coordinateSpeech(bus, () => c.pause({ releaseSystem: true }));
  return { c, coordination };
}
test('independent instances pause on explicit claim, retain position, never auto-resume after unload', async () => {
  const bus = workspace(), a = controller(bus), b = controller(bus), owner = {};
  a.c.start(owner, [{ text: 'one' }, { text: 'two' }], { id: 'openai' }); await tick();
  a.c.skip(1); await tick();
  b.c.start({}, [{ text: 'rss' }], { id: 'openai' }); await tick();
  assert.equal(a.c.state, 'paused'); assert.equal(a.c.index, 1); assert.equal(a.c.owner, owner);
  a.c.toggle(); await tick(); assert.equal(b.c.state, 'paused'); assert.equal(a.c.state, 'playing');
  a.coordination.dispose(); a.c.dispose(); assert.equal(b.c.state, 'paused'); assert.equal(bus.listeners.size, 1);
  b.c.toggle(); await tick(); assert.equal(b.c.state, 'playing'); b.coordination.dispose(); b.c.dispose();
});
test('a loading instance cannot start playback after another claims speech', async () => {
  const bus = workspace(), a = controller(bus), b = controller(bus); let resolve;
  a.c.synthesize = () => new Promise(r => { resolve = r; });
  a.c.start({}, [{ text: 'late' }], { id: 'openai' });
  b.c.start({}, [{ text: 'new' }], { id: 'openai' }); await tick();
  resolve({ bytes: new Uint8Array([1]), mime: 'audio/mpeg' }); await tick(); assert.equal(a.c.state, 'paused');
  a.c.dispose(); b.c.dispose(); a.coordination.dispose(); b.coordination.dispose();
});
test('system interruption releases global utterance and resumes current sentence', async () => {
  const bus = workspace(); let cancellations = 0, spoken = 0, coordination;
  const c = new TtsController({ beforePlay: () => coordination.claim(), speech: { speak: () => spoken++, getVoices: () => [], cancel: () => cancellations++ }, makeUtterance: text => ({ text }) });
  coordination = coordinateSpeech(bus, () => c.pause({ releaseSystem: true }));
  c.start({}, [{ text: 'sentence' }], { id: 'system' }); await tick();
  const other = coordinateSpeech(bus, () => {}); other.claim(); assert.equal(c.state, 'paused'); assert.equal(cancellations, 1);
  c.toggle(); await tick(); assert.equal(spoken, 2); assert.equal(c.index, 0); c.dispose(); coordination.dispose(); other.dispose();
});
test('resume needs same body, is independent across owners and bounded, completed content starts over', () => {
  const record = {}, original = speechFingerprint('Original.'), rewrite = speechFingerprint('Rewrite.');
  rememberProgress(record, 'rss|original', original, 12); rememberProgress(record, 'note.md', original, 24);
  assert.equal(resumeOffset(record, 'rss|original', rewrite), 0); assert.equal(resumeOffset(record, 'note.md', original), 24);
  rememberProgress(record, 'rss|original', original, 0, true); assert.equal(resumeOffset(record, 'rss|original', original), 0);
  for (let i = 0; i < 510; i++) rememberProgress(record, String(i), original, i); assert.equal(Object.keys(record).length, 500);
});
test('import normalization clones profiles and excludes credentials', () => {
  const raw = { tts: { provider: 'openai', profiles: { openai: { voice: 'coral', key: 'private' }, bad: {} } } };
  const value = normalizeSettings(raw); value.tts.profiles.openai.voice = 'echo';
  assert.equal(raw.tts.profiles.openai.voice, 'coral'); assert.equal(value.tts.profiles.openai.key, undefined); assert.equal(value.tts.profiles.bad, undefined);
});
