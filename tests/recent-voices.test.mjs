import test from 'node:test';
import assert from 'node:assert/strict';
import { applySpeechChoice, normalizeRecentChoices, rememberSpeechChoice } from '../src/core/tts/recent.js';
import { normalizeSettings } from '../src/settings.js';

test('last service, model, voice, speed and recent combinations survive a settings round trip', () => {
  let settings = normalizeSettings({ tts: { provider: 'openai', rate: 1.5, profiles: { openai: { model: 'tts-1', voice: 'alloy' } } } });
  rememberSpeechChoice(settings.tts, { id: 'openai', model: 'tts-1', voice: 'alloy', key: 'never-persist' });
  rememberSpeechChoice(settings.tts, { id: 'doubao', resourceId: 'seed-tts-2.0', voice: 'vivi' });
  settings = normalizeSettings(JSON.parse(JSON.stringify(settings)));
  assert.equal(settings.tts.provider, 'openai'); assert.equal(settings.tts.rate, 1.5);
  assert.equal(settings.tts.profiles.openai.voice, 'alloy'); assert.equal(settings.tts.recent.length, 2);
  assert.ok(!JSON.stringify(settings).includes('never-persist'));
  applySpeechChoice(settings.tts, settings.tts.recent[0]);
  assert.equal(settings.tts.provider, 'doubao'); assert.equal(settings.tts.profiles.doubao.resourceId, 'seed-tts-2.0');
  assert.equal(settings.tts.profiles.openai.voice, 'alloy'); assert.equal(settings.tts.rate, 1.5);
});
test('recent voices distinguish models, deduplicate and retain only eight latest combinations', () => {
  const settings = { recent: [] };
  for (let i = 0; i < 12; i++) rememberSpeechChoice(settings, { id: 'openai', model: `m${i}`, voice: 'same' });
  assert.equal(settings.recent.length, 8); assert.equal(settings.recent[0].model, 'm11');
  assert.equal(rememberSpeechChoice(settings, settings.recent[0]), false);
  rememberSpeechChoice(settings, settings.recent[3]);
  assert.equal(settings.recent[0].model, 'm8'); assert.equal(settings.recent.length, 8);
});
test('history rejects malformed providers, strips secrets and restores a custom endpoint', () => {
  const recent = normalizeRecentChoices([null, { id: 'invalid' }, { id: '__proto__' }, { id: 'compatible', model: 'local', voice: 'custom', baseUrl: 'http://localhost:8880/v1', key: 'secret', apiKey: 'secret', token: 'secret' }]);
  assert.equal(recent.length, 1); assert.ok(!JSON.stringify(recent).includes('secret'));
  const settings = { profiles: { compatible: { model: 'other' } } };
  assert.equal(applySpeechChoice(settings, recent[0]), true);
  assert.equal(settings.profiles.compatible.baseUrl, 'http://localhost:8880/v1');
});
