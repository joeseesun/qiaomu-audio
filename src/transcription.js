import { Platform, requestUrl } from 'obsidian';
import { asrError, cloudConfig } from './core/asr/providers.js';
import { recognizeCloud, tidyTranscript } from './core/asr/request.js';
import { TARGET_RATE, encodeWav, joinTranscript, splitForRecognition } from './core/asr/audio.js';
import { LOCAL_ASR_MODEL } from './runtime/local.js';
import { asrSecretId, getSecret } from './settings.js';

// SenseVoice decodes one language per piece and is most accurate on short phrases cut at pauses.
const LOCAL_CHUNK = { target: 8, maximum: 15 };

export class TranscriptionService {
  constructor(plugin) { this.plugin = plugin; }
  get settings() { return this.plugin.settings.asr; }
  // What dictation will use now, or null when the person has not chosen yet.
  engine(value = this.settings.engine) {
    if (value === 'local') return Platform.isDesktopApp ? { kind: 'local', id: 'local' } : null;
    if (value?.startsWith('cloud:')) {
      const profile = this.settings.profiles.find(p => `cloud:${p.id}` === value);
      return profile ? { kind: 'cloud', id: value, profile } : null;
    }
    return null;
  }
  async readiness(engine = this.engine()) {
    if (!engine) return asrError('noEngine');
    if (engine.kind === 'local') {
      const state = await this.plugin.local().status(LOCAL_ASR_MODEL);
      return state.phase === 'ready' ? null : asrError('localMissing');
    }
    try {
      const cfg = cloudConfig(engine.profile);
      if (!cfg.local && !getSecret(this.plugin.app, asrSecretId(engine.profile.id, engine.profile.provider))) return asrError('key');
      return null;
    } catch (error) { return error; }
  }
  chunking(engine) {
    if (engine.kind === 'local') return LOCAL_CHUNK;
    const cfg = cloudConfig(engine.profile);
    return { target: cfg.chunkSeconds, maximum: cfg.maxChunkSeconds };
  }
  // One phrase or recording piece (16 kHz mono samples) → text.
  async recognizePiece(engine, samples, signal) {
    const wav = encodeWav(samples, TARGET_RATE), language = this.settings.language;
    if (engine.kind === 'local') return tidyTranscript(await this.plugin.local().transcribe(LOCAL_ASR_MODEL, wav, signal));
    const cfg = cloudConfig(engine.profile), key = getSecret(this.plugin.app, asrSecretId(engine.profile.id, engine.profile.provider));
    return recognizeCloud(cfg, key, wav, { request: requestUrl, language, signal });
  }
  // A whole recording → text. Long audio is cut at pauses; cloud pieces run three at a time.
  async transcribe(samples, { signal, onProgress, engine = this.engine() } = {}) {
    const problem = await this.readiness(engine);
    if (problem) throw problem;
    const { target, maximum } = this.chunking(engine);
    const pieces = splitForRecognition(samples, TARGET_RATE, target, maximum), results = new Array(pieces.length);
    let next = 0, done = 0;
    onProgress?.(0, pieces.length);
    const worker = async () => {
      while (next < pieces.length) {
        const index = next++;
        results[index] = await this.recognizePiece(engine, pieces[index], signal);
        onProgress?.(++done, pieces.length);
      }
    };
    const lanes = engine.kind === 'local' ? 1 : Math.min(3, pieces.length);
    await Promise.all(Array.from({ length: lanes }, worker));
    return joinTranscript(results);
  }
  // Checks a cloud service with one second of quiet audio: any successful answer (even empty text) means it works.
  async test(profile, signal) {
    const engine = { kind: 'cloud', id: `cloud:${profile.id}`, profile };
    const problem = await this.readiness(engine);
    if (problem) throw problem;
    const samples = new Float32Array(TARGET_RATE);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 8) * 0.002;
    await this.recognizePiece(engine, samples, signal);
  }
}
