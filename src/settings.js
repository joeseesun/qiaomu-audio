import { TTS_PROVIDERS } from './core/tts/providers.js';
import { ASR_LANGUAGES, MAX_PROFILES, cleanProfile } from './core/asr/providers.js';
import { normalizeRecentChoices } from './core/tts/recent.js';

// Keys live in Obsidian's SecretStorage, never in data.json. IDs: lowercase letters, digits and dashes.
export const ttsSecretId = (provider, namespace = 'qiaomu-audio') => `${namespace}-tts-${String(provider).toLowerCase()}`;
export const asrSecretId = (profileId, provider = '') => `qiaomu-audio-asr-${String(profileId).toLowerCase()}${provider ? `-${String(provider).toLowerCase()}` : ''}`;

// The old profile-only key belongs exclusively to the provider saved with that profile.
export function migrateAsrSecrets(app, profiles) {
  for (const profile of profiles) {
    const old = asrSecretId(profile.id), next = asrSecretId(profile.id, profile.provider);
    const value = getSecret(app, old);
    if (!value) continue;
    try {
      if (!getSecret(app, next)) setSecret(app, next, value);
      setSecret(app, old, '');
    } catch { /* Preserve the old key if the host cannot save the migration. */ }
  }
}
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function defaultSettings(desktop = true) {
  return {
    tts: { provider: desktop ? 'edge' : 'system', profiles: {}, rate: 1, welcomed: false, recent: [] },
    // engine: '' (not chosen yet), 'local' (SenseVoice on this computer) or 'cloud:<profile id>'.
    asr: { engine: '', profiles: [], language: 'auto', mode: 'live', keepAudio: true },
  };
}
export function normalizeSettings(raw, desktop = true) {
  const base = defaultSettings(desktop), value = raw && typeof raw === 'object' ? raw : {};
  const tts = { ...base.tts, ...(value.tts && typeof value.tts === 'object' ? value.tts : {}) };
  if (!TTS_PROVIDERS[tts.provider]) tts.provider = base.tts.provider;
  if (!tts.profiles || typeof tts.profiles !== 'object' || Array.isArray(tts.profiles)) tts.profiles = {};
  tts.profiles = Object.fromEntries(Object.entries(tts.profiles).filter(([id, p]) => TTS_PROVIDERS[id] && p && typeof p === 'object' && !Array.isArray(p)).map(([id, p]) => [id, Object.fromEntries(['voice', 'model', 'baseUrl', 'region', 'resourceId'].filter(key => typeof p[key] === 'string').map(key => [key, p[key]]))]));
  tts.rate = RATES.includes(Number(tts.rate)) ? Number(tts.rate) : 1;
  tts.welcomed = tts.welcomed === true;
  tts.recent = normalizeRecentChoices(tts.recent);

  const source = value.asr && typeof value.asr === 'object' ? value.asr : {};
  const taken = new Set();
  const profiles = (Array.isArray(source.profiles) ? source.profiles : []).slice(0, MAX_PROFILES)
    .map(p => cleanProfile(p, taken)).filter(Boolean);
  let engine = typeof source.engine === 'string' ? source.engine : '';
  if (engine === 'local' && !desktop) engine = '';
  if (engine.startsWith('cloud:') && !profiles.some(p => `cloud:${p.id}` === engine)) engine = profiles[0] ? `cloud:${profiles[0].id}` : '';
  if (engine && engine !== 'local' && !engine.startsWith('cloud:')) engine = '';
  return {
    tts,
    readingProgress: value.readingProgress && typeof value.readingProgress === 'object' && !Array.isArray(value.readingProgress) ? value.readingProgress : {},
    asr: {
      engine, profiles,
      language: ASR_LANGUAGES.includes(source.language) ? source.language : 'auto',
      mode: ['live', 'batch'].includes(source.mode) ? source.mode : base.asr.mode,
      keepAudio: typeof source.keepAudio === 'boolean' ? source.keepAudio : base.asr.keepAudio,
    },
  };
}
export function getSecret(app, id) {
  try { return app.secretStorage?.getSecret(id) || ''; } catch { return ''; }
}
export function setSecret(app, id, value) {
  app.secretStorage.setSecret(id, String(value || '').trim());
}
