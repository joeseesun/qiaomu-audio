import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { TTS_MODELS, voiceChoices, changeSpeechModel } from '../src/core/tts/choices.js';
import { TTS_PROVIDERS, ttsProfile } from '../src/core/tts/providers.js';
import { macVoiceChoices } from '../src/core/tts/mac-voices.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('every curated provider model chooses an applicable voice; unknown models never guess a preset', () => {
  for (const [id, models] of Object.entries(TTS_MODELS)) for (const model of models) {
    const next = changeSpeechModel(ttsProfile({}, id), model.id, {}), voices = voiceChoices(next);
    assert.ok(voices.length > 0, `${id}/${model.id}`); assert.ok(voices.some(v => v.id === next.voice), `${id}/${model.id}/${next.voice}`);
  }
  for (const id of ['openai', 'qwen', 'minimax', 'elevenlabs', 'siliconflow']) {
    assert.equal(voiceChoices({ ...TTS_PROVIDERS[id], id, model: 'unknown-model' }).length, 0);
    assert.equal(changeSpeechModel(ttsProfile({}, id), 'unknown-model', {}).voice, '');
  }
});
test('enhanced recommended Apple voices retain real IDs and show both quality and recommendation', () => {
  const voice = { id: 'com.apple.siri.natural.Linfei', name: '声音2', lang: 'zh-CN', quality: 2 };
  const choices = macVoiceChoices([voice], key => ({ voiceEnhanced: '增强', recommended: '推荐', voiceDisplayName: '显示名' })[key], true);
  assert.equal(choices[0].id, voice.id); assert.match(choices[0].label, /清和.*增强.*推荐/);
});
const bundled = await build({ entryPoints: ['src/speech.js'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['obsidian', 'node:*', 'ws'], loader: { '.py': 'text' } });
function service() {
  const listeners = new Set(), workspace = { on: (_name, fn) => { listeners.add(fn); return fn; }, offref: fn => listeners.delete(fn), trigger: (_name, source) => { for (const fn of listeners) fn(source); } };
  const module = { exports: {} }, native = [{ id: 'com.apple.siri.natural.Linfei', name: '声音2', lang: 'zh-CN', quality: 2 }];
  const win = { Audio: class { play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} }, speechSynthesis: { getVoices: () => [{ voiceURI: 'browser-basic', name: 'Basic', lang: 'zh-CN' }], speak() {}, cancel() {}, pause() {}, resume() {} }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, setTimeout, clearTimeout };
  const context = { module, window: win, URL, Blob, AbortController, Uint8Array, TextDecoder, require(id) {
    if (id === 'obsidian') return { Platform: { isDesktop: true, isDesktopApp: true, isMacOS: true }, requestUrl: async () => ({ status: 200, arrayBuffer: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'audio/mpeg' } }) };
    if (id === 'node:child_process') return { execFile(_file, _args, _options, cb) { const stdin = new EventEmitter(); stdin.end = value => { assert.equal(JSON.parse(value).operation, 'voices'); queueMicrotask(() => cb(null, JSON.stringify({ voices: native }))); }; return { stdin, kill() {} }; } };
    throw Error(id);
  } };
  runInNewContext(bundled.outputFiles[0].text, context);
  const host = { app: { workspace, secretStorage: { getSecret: () => 'test' } }, manifest: { id: 'test-speech' }, voiceCatalogs: {}, settings: { tts: { provider: 'openai', profiles: {}, rate: 1 } } };
  return { s: new module.exports.SpeechService(host), host };
}
test('both consumers can obtain native enhanced voices independently of browser voices', async () => {
  const { s, host } = service();
  const profile = { id: 'macos', voice: '' }, catalog = await s.loadChoices(profile, { chinese: true, tx: key => key }); host.voiceCatalogs.macos = catalog;
  assert.ok(s.choices(profile).some(v => v.id === 'com.apple.siri.natural.Linfei'));
  assert.ok(s.choices({ id: 'system' }).some(v => v.id === 'browser-basic')); s.dispose();
});
test('auditioning multiple voices restores original owner/index/rate paused without new requests', async () => {
  const { s } = service(), owner = {}, preview = {}, items = [{ text: 'first' }, { text: 'second' }];
  s.controller.start(owner, items, s.profile(), { index: 1, rate: 1.5 }); await tick();
  s.startPreview(preview, 'sample'); await tick(); s.startPreview(preview, 'another sample'); await tick(); s.stopPreview(preview);
  assert.equal(s.controller.owner, owner); assert.equal(s.controller.index, 1); assert.equal(s.controller.rate, 1.5); assert.equal(s.controller.state, 'paused'); assert.equal(s.controller.deferred, true); s.dispose();
});
test('closing a reading view during preview cannot restore a detached owner', async () => {
  const { s } = service(), owner = {}, preview = {};
  s.controller.start(owner, [{ text: 'note' }], s.profile()); await tick(); s.startPreview(preview, 'sample'); await tick();
  s.discardPreview(owner); s.stopPreview(preview); assert.equal(s.controller.owner, null); s.dispose();
});
test('local models expose only TTS and every default voice belongs to its selected model', () => {
  const registry = JSON.parse(readFileSync(new URL('../src/runtime/models.json', import.meta.url), 'utf8'));
  for (const [id, model] of Object.entries(registry.models)) if (model.kind !== 'asr') assert.ok(model.voices.some(v => v.id === model.defaultVoice), id);
});
