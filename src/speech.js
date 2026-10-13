import { Platform, requestUrl } from 'obsidian';
import { TtsController } from './core/tts/controller.js';
import { EdgeSpeechClient } from './core/tts/edge-client.js';
import { buildSpeechRequest, checkTtsSignal, synthesizeHttp, ttsError, ttsProfile } from './core/tts/providers.js';
import { splitSpeechText } from './core/tts/text.js';
import { normalizeLocalProfile } from './runtime/local.js';
import { getSecret, ttsSecretId } from './settings.js';

// One speech controller per plugin: only one thing reads aloud at a time.
export class SpeechService {
  constructor(plugin) {
    this.plugin = plugin; this.listeners = new Set();
    const edge = new EdgeSpeechClient(async (text, voice, options) => {
      const { synthesizeEdge } = await import('./core/tts/edge.js');
      checkTtsSignal(options.signal); return synthesizeEdge(text, voice, options);
    });
    this.controller = new TtsController({
      makeAudio: () => new window.Audio(), speech: window.speechSynthesis,
      makeUtterance: text => new window.SpeechSynthesisUtterance(text),
      synthesize: async (profile, text, signal) => {
        if (profile.id === 'edge') {
          if (!Platform.isDesktopApp) throw ttsError('mobile');
          return edge.synthesize(text, profile.voice, { signal });
        }
        if (profile.id === 'macos') {
          if (!Platform.isDesktopApp || !Platform.isMacOS) throw ttsError('macPlatform');
          const { synthesizeMacSpeech } = await import('./core/tts/macos.js');
          return synthesizeMacSpeech(text, profile.voice, { signal });
        }
        if (profile.id === 'localModel') return plugin.local().synthesize(profile, text, signal);
        return synthesizeHttp(profile, text, { request: requestUrl, key: profile.key, signal });
      },
      onChange: controller => { for (const listener of this.listeners) listener(controller); },
    });
  }
  get settings() { return this.plugin.settings.tts; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  profile() {
    const settings = this.settings, id = settings.provider;
    let profile = ttsProfile(settings, id);
    if (id === 'localModel') profile = { ...profile, ...normalizeLocalProfile(profile) };
    return { ...profile, key: getSecret(this.plugin.app, ttsSecretId(id)) };
  }
  // Long sentences for online voices; short clauses keep local synthesis responsive.
  chunking() { return this.settings.provider === 'localModel' ? { limit: 40, clauses: true } : { limit: 240, clauses: false }; }
  configurationError(profile = this.profile()) {
    if (profile.id === 'system') return typeof window.speechSynthesis?.speak === 'function' && typeof window.SpeechSynthesisUtterance === 'function' ? null : ttsError('systemUnavailable');
    if (profile.id === 'macos') return Platform.isDesktopApp && Platform.isMacOS ? null : ttsError('macPlatform');
    if (profile.id === 'edge') return Platform.isDesktopApp ? null : ttsError('mobile');
    if (profile.id === 'localModel') return Platform.isDesktopApp ? null : ttsError('localPlatform');
    try { buildSpeechRequest(profile, '', profile.key); return null; } catch (error) { return error; }
  }
  // Speak plain text without a note (settings test, public API).
  speak(owner, text, profile = this.profile()) {
    const { limit, clauses } = this.chunking(), items = splitSpeechText(text, limit, clauses);
    if (items.length) this.controller.start(owner, items, profile, { rate: this.settings.rate });
    return items.length;
  }
  dispose() { this.controller.dispose(); this.listeners.clear(); }
}
export function hiddenProvider(id, selected) {
  return id !== selected && ((['edge', 'localModel'].includes(id) && !Platform.isDesktopApp) || (id === 'macos' && (!Platform.isDesktopApp || !Platform.isMacOS)));
}
export function providerHelp(id) {
  return id === 'system' ? 'tts.help.system' : id === 'localModel' ? 'tts.help.localModel' : id === 'macos' ? 'tts.help.macos' : id === 'edge' ? 'tts.help.edge' : 'tts.help.cloud';
}
export function providerLabel(t, id, fallback) {
  return ['system', 'macos', 'localModel', 'doubao', 'siliconflow', 'qwen'].includes(id) ? t(`tts.provider.${id}`) : fallback;
}
