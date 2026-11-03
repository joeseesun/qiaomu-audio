import { Platform } from 'obsidian';
import { asrError } from '../core/asr/providers.js';
import { concatSamples, rmsDb } from '../core/asr/audio.js';

export const appleAvailable = () => Platform.isDesktopApp && Platform.isMacOS;
export const appleLanguage = code => code === 'auto' ? 'zh' : code;
/* global require, Buffer -- Guarded Obsidian desktop native bridge. */
export function createAppleSpeech() {
  if (!Platform.isDesktop) throw asrError('applePlatform');
  if (!appleAvailable()) throw asrError('applePlatform');
  /* eslint-disable @typescript-eslint/no-require-imports -- Desktop-only external helper. */
  return new AppleSpeech({ cp: require('node:child_process'), fs: require('node:fs/promises'), os: require('node:os'), path: require('node:path') });
  /* eslint-enable @typescript-eslint/no-require-imports -- End guarded desktop imports. */
}

// The plugin neither downloads nor compiles executable code. The helper is installed separately.
export class AppleSpeech {
  constructor(modules) {
    Object.assign(this, modules); this.children = new Set(); this.closed = false;
    this.executable = '/Applications/Qiaomu Audio Helper.app/Contents/MacOS/qiaomu-audio-helper';
  }
  async check() {
    if (this.closed) throw asrError('appleClosed');
    try { await this.fs.access(this.executable); } catch { throw asrError('appleHelperMissing'); }
    if (this.closed) throw asrError('appleClosed');
  }
  async run(args, { signal, onMessage, timeout = 90000, streaming = false } = {}) {
    await this.check();
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    return new Promise((resolve, reject) => {
      let buffer = '', last, settled = false, ready = false;
      const child = this.cp.spawn(this.executable, args, { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
      this.children.add(child);
      const finish = (error, value) => {
        if (settled) {
          if (streaming && error) { onMessage?.({ error: error.code || 'appleProtocol' }); child.stdin.end(); child.kill(); }
          return;
        }
        settled = true;
        window.clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (!streaming || error) { child.stdin.end(); child.kill(); }
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      const timer = window.setTimeout(() => finish(asrError('timeout')), timeout);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(asrError('appleHelperMissing')));
      child.on('close', code => { this.children.delete(child); if (!settled) finish(code === 0 ? null : asrError('appleRecognition'), last); });
      child.stdout.on('data', bytes => {
        buffer += bytes.toString('utf8');
        if (buffer.length > 1024 * 1024) { finish(asrError('appleProtocol')); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          let message;
          try { message = JSON.parse(buffer.slice(0, end)); } catch { finish(asrError('appleProtocol')); return; }
          buffer = buffer.slice(end + 1);
          if (message.error) { finish(asrError(message.error)); return; }
          last = message;
          if (streaming && message.ready && !ready) {
            ready = true; window.clearTimeout(timer); signal?.removeEventListener('abort', abort);
            finish(null, child);
          }
          onMessage?.(message);
        }
      });
    });
  }
  async status(language) { return this.run(['status', appleLanguage(language)]); }
  async prepare(language, signal) { return this.run(['prepare', appleLanguage(language)], { signal, timeout: 600000 }); }
  async transcribe(wav, language, signal) {
    await this.check();
    const directory = await this.fs.mkdtemp(this.path.join(this.os.tmpdir(), 'qiaomu-apple-'));
    const file = this.path.join(directory, 'speech.wav');
    try {
      await this.fs.writeFile(file, wav, { mode: 0o600 });
      const result = await this.run(['transcribe', file, appleLanguage(language)], { signal });
      if (typeof result?.text !== 'string') throw asrError('appleProtocol');
      return result.text;
    } finally { await this.fs.rm(directory, { recursive: true, force: true }); }
  }
  recorder(options) { return new SystemRecorder(this, options); }
  dispose() { this.closed = true; for (const child of this.children) { child.stdin.end(); child.kill(); } this.children.clear(); }
}

export class SystemRecorder {
  constructor(bridge, { onFrame, onLevel, onError }) {
    Object.assign(this, { bridge, onFrame, onLevel, onError }); this.blocks = []; this.length = 0; this.stopped = false; this.abort = new AbortController();
  }
  get seconds() { return this.length / 16000; }
  async start() {
    this.child = await this.bridge.run(['capture'], { streaming: true, signal: this.abort.signal, timeout: 20000, onMessage: message => {
      if (this.stopped) return;
      if (message.error) { this.onError?.(asrError(message.error)); void this.stop(); return; }
      if (typeof message.pcm !== 'string') return;
      const bytes = Buffer.from(message.pcm, 'base64');
      if (!bytes.length || bytes.length % 4 || bytes.length > 65536) { this.onError?.(asrError('appleProtocol')); void this.stop(); return; }
      const copy = Uint8Array.from(bytes), samples = new Float32Array(copy.buffer);
      if (!samples.every(Number.isFinite)) { this.onError?.(asrError('appleProtocol')); void this.stop(); return; }
      this.blocks.push(samples); this.length += samples.length;
      this.onLevel?.(rmsDb(samples)); this.onFrame?.(samples);
    } });
    if (this.stopped) { this.child.stdin.end(); this.child.kill(); return; }
    this.child.on('close', () => { if (!this.stopped) this.onError?.(asrError('systemAudioStopped')); });
  }
  samples() { return concatSamples(this.blocks); }
  audioBlob() { return null; }
  async stop() {
    if (this.stopped) return;
    this.stopped = true; this.abort.abort();
    if (this.child) { this.child.stdin.end(); this.child.kill(); }
  }
}
