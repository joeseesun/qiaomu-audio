import { Platform } from 'obsidian';
import { TTS_PROVIDERS } from '../core/tts/providers.js';
import { getSecret, setSecret, ttsSecretId, normalizeSettings } from '../settings.js';
export async function findSpeechSettings(app, sourceId) {
  let data = app.plugins?.plugins?.[sourceId];
  if (!data) { try { data = JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/plugins/${sourceId}/data.json`)); } catch { return null; } }
  const tts = data.settings?.tts || data.state?.settings?.tts || data.tts;
  return tts && TTS_PROVIDERS[tts.provider] ? normalizeSettings({ tts }, Platform.isDesktopApp).tts : null;
}
// Explicit one-time copy. Subsequent voice changes and secrets belong to each receiving plugin.
export async function copySpeechSettings(host, sourceId) {
  const tts = await findSpeechSettings(host.app, sourceId);
  if (!tts) return -1;
  host.settings.tts = tts;
  let keys = 0;
  for (const id of Object.keys(TTS_PROVIDERS)) {
    const value = getSecret(host.app, ttsSecretId(id, sourceId)), target = ttsSecretId(id, host.manifest.id);
    if (value && !getSecret(host.app, target)) { setSecret(host.app, target, value); keys++; }
  }
  await host.saveSettings(); host.speech.controller.cache.clear(); host.reading?.restartWithSettings();
  return keys;
}
