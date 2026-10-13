import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudService } from '../src/core/cloud-services.js';
import { TTS_PROVIDERS } from '../src/core/tts/providers.js';
import { ASR_PROVIDERS, newProfile, withProvider } from '../src/core/asr/providers.js';
import { asrSecretId, getSecret, migrateAsrSecrets, normalizeSettings, setSecret } from '../src/settings.js';

function keychain(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { values, secretStorage: { getSecret: id => values.get(id), setSecret: (id, value) => values.set(id, value) } };
}

test('every named cloud provider offers HTTPS console and setup links, never an API endpoint', () => {
  for (const id of Object.keys(TTS_PROVIDERS).filter(id => !['system', 'macos', 'edge', 'localModel', 'compatible'].includes(id))) {
    const info = cloudService('tts', id);
    assert.ok(info?.keyHelp && info.docs, id);
    for (const url of Object.values(info)) { assert.equal(new URL(url).protocol, 'https:'); assert.ok(!new URL(url).hostname.startsWith('api.'), id); }
  }
  for (const p of ASR_PROVIDERS.filter(p => !['local', 'custom'].includes(p.id))) {
    const info = cloudService('asr', p.id);
    assert.ok(info?.keyHelp && info.docs, p.id);
  }
  assert.equal(cloudService('tts', 'compatible'), null);
  assert.equal(cloudService('asr', 'custom'), null);
});

test('switching an ASR provider cannot expose the previous provider key; switching back retains it', () => {
  const app = keychain(), profile = newProfile('siliconflow');
  setSecret(app, asrSecretId(profile.id, profile.provider), ' silicon-key ');
  const next = withProvider(profile, 'mimo');
  assert.equal(getSecret(app, asrSecretId(next.id, next.provider)), '');
  const back = withProvider(next, 'siliconflow');
  assert.equal(getSecret(app, asrSecretId(back.id, back.provider)), 'silicon-key');
});

test('legacy key migrates only into its saved provider and migration is repeatable', () => {
  const profile = { id: 'p1', provider: 'glm' }, old = asrSecretId(profile.id);
  const app = keychain({ [old]: 'old-key' });
  migrateAsrSecrets(app, [profile]); migrateAsrSecrets(app, [profile]);
  assert.equal(getSecret(app, asrSecretId('p1', 'glm')), 'old-key');
  assert.equal(getSecret(app, asrSecretId('p1', 'mimo')), '');
  assert.equal(getSecret(app, old), '');
});

test('migration never overwrites a newer provider key or discards a legacy key when storage fails', () => {
  const profile = { id: 'p1', provider: 'glm' }, old = asrSecretId('p1'), next = asrSecretId('p1', 'glm');
  const app = keychain({ [old]: 'old', [next]: 'new' });
  migrateAsrSecrets(app, [profile]);
  assert.equal(getSecret(app, next), 'new');
  const failed = keychain({ [old]: 'preserve' });
  failed.secretStorage.setSecret = () => { throw new Error('locked'); };
  migrateAsrSecrets(failed, [profile]);
  assert.equal(getSecret(failed, old), 'preserve');
});

test('normalization never serializes ASR credentials from imported settings', () => {
  const normalized = normalizeSettings({ asr: { profiles: [{ id: 'p1', provider: 'mimo', key: 'private', apiKey: 'private' }] } });
  assert.ok(!JSON.stringify(normalized).includes('private'));
});
