import { Platform } from 'obsidian';
import { models } from './models.json';
import workerSource from './speech-runtime.py';
import { checkTtsSignal, ttsError } from '../core/tts/providers.js';
const registry = { models };

export const LOCAL_MODELS = Object.entries(registry.models).filter(([, value]) => value.kind !== 'asr').map(([id, value]) => ({ id, ...value }));
export const ASR_MODELS = Object.entries(registry.models).filter(([, value]) => value.kind === 'asr').map(([id, value]) => ({ id, ...value }));
export const LOCAL_ASR_MODEL = 'sensevoice';
export const LOCAL_DEFAULT_MODEL = 'kokoro';
export const LOCAL_DEFAULT_VOICE = registry.models.kokoro.defaultVoice;
export function normalizeLocalProfile(profile = {}) {
  const model = registry.models[profile.model] ? profile.model : LOCAL_DEFAULT_MODEL;
  const voice = registry.models[model].voices.some(v => v.id === profile.voice) ? profile.voice : registry.models[model].defaultVoice;
  return { ...profile, model, voice };
}
export function localVoiceChoices(model, chinese = true) {
  return (registry.models[model]?.voices || []).map(v => {
    const language = !chinese ? v.lang : !v.lang.startsWith('zh') ? '英文'
      : v.gender === 'male' ? '中文男声' : v.gender === 'female' ? '中文女声' : '';
    return { id: v.id, label: [chinese ? v.name : v.nameEn, language,
      v.recommended ? chinese ? '推荐' : 'Recommended' : ''].filter(Boolean).join(' · '),
    sourceName: `${registry.models[model].label} · ${v.id}`, recommended: !!v.recommended };
  });
}
const SAMPLE = '你好，这是乔木语音的本地朗读测试。';
const aborted = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));

// Desktop-only Node access, guarded before require so mobile never loads it.
/* global require, process, Buffer -- Obsidian desktop provides Node globals for native operations. */
export function createLocalTtsManager(options = {}) {
  if (!Platform.isDesktop) throw ttsError('localPlatform');
  /* eslint-disable @typescript-eslint/no-require-imports -- Desktop-only native bridge. */
  const modules = { fs: require('node:fs/promises'), path: require('node:path'), os: require('node:os'),
    cp: require('node:child_process'), crypto: require('node:crypto'), http: require('node:http') };
  /* eslint-enable @typescript-eslint/no-require-imports -- End guarded native imports. */
  return new LocalTtsManager(modules, options);
}

class LocalTtsManager {
  constructor(modules, options) {
    Object.assign(this, modules); this.options = options; this.listeners = new Set(); this.states = new Map(); this.operations = new Map();
    const home = this.os.homedir(), env = process.env, join = this.path.join;
    this.root = options.root || join(process.platform === 'darwin' ? join(home, 'Library', 'Application Support')
      : process.platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local')
        : env.XDG_DATA_HOME || join(home, '.local', 'share'), 'qiaomu-audio', 'speech');
    // Qiaomu Reader keeps identical pinned model files here; reuse them read-only instead of downloading twice.
    this.shared = options.sharedRoots || [join(this.path.dirname(this.path.dirname(this.root)), 'qiaomu-reader', 'tts')];
    this.cache = options.cacheRoot || join(process.platform === 'darwin' ? join(home, 'Library', 'Caches')
      : process.platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local')
        : env.XDG_CACHE_HOME || join(home, '.cache'), 'qiaomu-audio', 'speech-cache');
    this.version = `2-${this.crypto.createHash('sha256').update(workerSource + JSON.stringify(registry)).digest('hex').slice(0, 16)}`;
  }
  subscribe(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  emit(id, state) { this.states.set(id, state); for (const listener of this.listeners) listener(id, state); }
  snapshot(id) { return this.states.get(id) || { phase: 'unknown' }; }
  async safeRoot(path) {
    let ancestor = this.path.resolve(path); const missing = [];
    for (;;) {
      try { ancestor = await this.fs.realpath(ancestor); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; missing.unshift(this.path.basename(ancestor)); const parent = this.path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
    }
    const real = this.path.join(ancestor, ...missing);
    for (const vault of this.options.vaultPaths || []) {
      const actual = await this.fs.realpath(vault);
      const relative = this.path.relative(actual, real);
      if (!relative || (!relative.startsWith('..' + this.path.sep) && relative !== '..' && !this.path.isAbsolute(relative))) throw ttsError('localPath');
    }
    await this.fs.mkdir(real, { recursive: true, mode: 0o700 }); return real;
  }
  async initialize() {
    if (!this.initializing) this.initializing = (async () => {
      this.root = await this.safeRoot(this.root); this.cache = await this.safeRoot(this.cache);
      this.script = this.path.join(this.root, `worker-${this.version}.py`);
      await this.fs.writeFile(this.script, workerSource, { mode: 0o600 });
    })();
    return this.initializing;
  }
  paths(id) {
    const model = registry.models[id]; if (!model) throw ttsError('localModel');
    const join = this.path.join, revision = model.revision;
    const venvDir = join(this.root, 'runtimes', id, revision);
    return { ...model, id, version: this.version,
      kind: model.kind || 'tts', modelDir: join(this.root, 'models', id, revision),
      venvDir, python: join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'),
      audioDir: join(this.cache, 'audio'), cacheDir: this.cache,
      endpoint: join(this.root, `endpoint-${id}-${this.version}.json`),
      ready: join(this.root, `ready-${id}-${this.version}.json`), configFile: join(this.root, `config-${id}-${this.version}.json`) };
  }
  env(offline = false) {
    const env = { ...process.env };
    for (const key of ['PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete env[key];
    return { ...env, PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1', ...(offline ? { PIP_NO_INDEX: '1' } : {}) };
  }
  async readJson(path) { try { return JSON.parse(await this.fs.readFile(path, 'utf8')); } catch { return null; } }
  async atomicJson(path, value) {
    const temp = `${path}.${this.crypto.randomUUID()}.tmp`;
    await this.fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await this.fs.rename(temp, path);
  }
  async modelComplete(dir, files) {
    try {
      for (const file of files) if ((await this.fs.stat(this.path.join(dir, file.path))).size !== file.bytes) return false;
      return true;
    } catch { return false; }
  }
  // Prefer this plugin's own copy; otherwise a complete copy of the same pinned revision from Qiaomu Reader.
  async resolveModelDir(cfg) {
    if (await this.modelComplete(cfg.modelDir, cfg.files)) return cfg.modelDir;
    for (const root of this.shared) {
      const dir = this.path.join(root, 'models', cfg.id, cfg.revision);
      if (await this.modelComplete(dir, cfg.files)) return dir;
    }
    return cfg.modelDir;
  }
  async config(id) { const cfg = this.paths(id); cfg.modelDir = await this.resolveModelDir(cfg); return cfg; }
  async status(id) {
    await this.initialize(); if (this.operations.has(id)) return this.snapshot(id);
    const cfg = await this.config(id), marker = await this.readJson(cfg.ready);
    try { await this.fs.access(cfg.python); } catch { const state = { phase: 'runtimeMissing' }; this.emit(id, state); return state; }
    let ready = marker?.version === this.version;
    if (ready) {
      try { await this.fs.access(cfg.python); ready = await this.modelComplete(cfg.modelDir, cfg.files); }
      catch { ready = false; }
    }
    const state = { phase: ready ? 'ready' : 'missing', device: marker?.device };
    this.emit(id, state); return state;
  }
  async voices(model, chinese = true) { return localVoiceChoices(model, chinese); }
  async lock(name, action) {
    const file = this.path.join(this.root, `${name}.lock`), token = this.crypto.randomUUID(); let handle;
    try { handle = await this.fs.open(file, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await this.readJson(file); let dead = false;
      if (Number.isSafeInteger(previous?.pid) && previous.pid > 0) {
        try { process.kill(previous.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
      }
      if (!dead) throw ttsError('localBusy');
      await this.fs.unlink(file); handle = await this.fs.open(file, 'wx', 0o600);
    }
    await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.close();
    try { return await action(); }
    finally { if ((await this.readJson(file))?.token === token) await this.fs.unlink(file); }
  }
  run(command, args, { signal, id, capture = false, offline = false } = {}) {
    checkTtsSignal(signal);
    return new Promise((resolve, reject) => {
      const child = this.cp.spawn(command, args, { cwd: this.root, env: this.env(offline), windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', pending = '', settled = false, cancelling = false, killTimer;
      const finish = (error, value) => { if (settled) return; settled = true; window.clearTimeout(killTimer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
      const cancel = () => {
        if (cancelling || settled) return; cancelling = true;
        if (id) this.emit(id, { phase: 'cancelling' });
        if (process.platform === 'win32') this.cp.spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
        // Hold the download lock until the child has actually stopped writing.
        killTimer = window.setTimeout(() => {
          if (process.platform !== 'win32' && child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
        }, 2000);
      };
      child.stdout.on('data', chunk => {
        if (capture) output = (output + chunk).slice(-16384);
        pending = (pending + chunk).slice(-65536); const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) if (line.startsWith('QAU_RT ') && id) {
          try { const value = JSON.parse(line.slice(8)); if (value.phase) this.emit(id, value); } catch { /* Partial diagnostics are not UI status. */ }
        }
      });
      // Consume upstream diagnostics without persisting paths or reading text.
      child.stderr.on('data', () => {});
      child.on('error', () => finish(ttsError('localEnvironment')));
      child.on('close', code => finish(cancelling ? aborted() : code === 0 ? null : ttsError('localInstall'), output.trim()));
      signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    });
  }
  install(id, options = {}) {
    if (this.operations.has(id)) return this.operations.get(id).promise;
    const abort = new AbortController(); const cancel = () => abort.abort(); options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) abort.abort();
    const promise = this.installModel(id, abort.signal).catch(error => {
      this.emit(id, { phase: error.name === 'AbortError' ? 'cancelled' : 'error', error }); throw error;
    }).finally(() => { this.operations.delete(id); options.signal?.removeEventListener('abort', cancel); });
    this.operations.set(id, { promise, abort }); return promise;
  }
  cancelInstall(id) { this.operations.get(id)?.abort.abort(); }
  async installModel(id, signal) {
    await this.initialize(); const cfg = await this.config(id); this.emit(id, { phase: 'runtime' });
    return this.lock(`install-${id}`, async () => {
      try { await this.fs.access(cfg.python); } catch { throw ttsError('localEnvironment'); }
      await this.atomicJson(cfg.configFile, cfg);
      // Only model data is downloaded. Python and Sherpa are installed outside Obsidian.
      await this.run(cfg.python, [this.script, 'prepare', cfg.configFile], { signal, id });
      checkTtsSignal(signal); this.emit(id, { phase: 'verify' });
      if (cfg.kind === 'asr') {
        const sample = await this.fs.readFile(this.path.join(cfg.modelDir, cfg.sample));
        if (!(await this.recognition(cfg, sample, signal)).trim()) throw ttsError('localInference');
      } else await this.speech(cfg, cfg.defaultVoice, SAMPLE, signal);
      const endpoint = await this.endpoint(cfg), result = await this.httpRequest(endpoint, '/status');
      await this.atomicJson(cfg.ready, { version: this.version, device: result.device, verifiedAt: Date.now() });
      const state = { phase: 'ready', device: result.device }; this.emit(id, state); return state;
    });
  }
  async endpoint(cfg) {
    const existing = await this.readJson(cfg.endpoint);
    if (existing?.version === this.version && existing.model === cfg.id && Number.isInteger(existing.port) && existing.port > 0 && existing.port <= 65535 && typeof existing.token === 'string' && existing.token.length >= 32) {
      try { const status = await this.httpRequest(existing, '/status', undefined, undefined, 2000); if (status.version === this.version && status.model === cfg.id) return existing; } catch { /* Restart stale endpoint safely. */ }
    }
    try {
      await this.lock(`start-${cfg.id}-${this.version}`, async () => {
        const child = this.cp.spawn(cfg.python, [this.script, 'serve', cfg.configFile], { cwd: this.root, env: this.env(true),
          detached: true, windowsHide: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref();
        for (let i = 0; i < 100; i++) {
          await delay(100); const value = await this.readJson(cfg.endpoint);
          if (value?.pid === child.pid && value.version === this.version) return;
        }
        throw ttsError('localEnvironment');
      });
    } catch (error) {
      if (error.code !== 'localBusy') throw error;
      for (let i = 0; i < 100; i++) { await delay(100); const e = await this.readJson(cfg.endpoint); if (e?.version === this.version) { try { await this.httpRequest(e, '/status', undefined, undefined, 2000); return e; } catch { /* Wait for worker. */ } } }
      throw error;
    }
    const endpoint = await this.readJson(cfg.endpoint); if (!endpoint) throw ttsError('localEnvironment'); return endpoint;
  }
  httpRequest(endpoint, route, data, signal, timeout = 90000, extraHeaders = {}) {
    checkTtsSignal(signal);
    return new Promise((resolve, reject) => {
      const raw = data instanceof Uint8Array;
      const body = data === undefined ? null : raw ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(JSON.stringify(data));
      const req = this.http.request({ host: '127.0.0.1', port: endpoint.port, path: route, method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${endpoint.token}`, ...extraHeaders, ...(body ? { 'Content-Type': raw ? 'audio/wav' : 'application/json', 'Content-Length': body.length } : {}) } }, response => {
        let size = 0; const chunks = [];
        response.on('data', bytes => { size += bytes.length; if (size > 32 * 1024 * 1024) req.destroy(ttsError('response')); else chunks.push(bytes); });
        response.on('error', reject); response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          if (response.statusCode !== 200) { reject(ttsError('localInference')); return; }
          if (route === '/speech') resolve(bytes);
          else { try { resolve(JSON.parse(bytes.toString())); } catch { reject(ttsError('response')); } }
        });
      });
      const cancel = () => req.destroy(aborted());
      req.on('error', reject); req.setTimeout(timeout, () => req.destroy(ttsError('timeout')));
      signal?.addEventListener('abort', cancel, { once: true }); req.on('close', () => signal?.removeEventListener('abort', cancel));
      req.end(body);
    });
  }
  async speech(cfg, voice, text, signal) {
    checkTtsSignal(signal); const endpoint = await this.endpoint(cfg); checkTtsSignal(signal);
    const job = this.crypto.randomUUID();
    const cancel = () => { void this.httpRequest(endpoint, '/cancel', { job }, undefined, 2000).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const bytes = await this.httpRequest(endpoint, '/speech', { job, voice, text }, signal);
      if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw ttsError('response');
      return { bytes: new Uint8Array(bytes), mime: 'audio/wav' };
    } catch (error) { cancel(); throw error;
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  async synthesize(profile, text, signal) {
    if ((await this.status(profile.model)).phase !== 'ready') throw ttsError('localMissing');
    const cfg = await this.config(profile.model); return this.speech(cfg, profile.voice || cfg.defaultVoice, text, signal);
  }
  async recognition(cfg, wav, signal) {
    checkTtsSignal(signal); const endpoint = await this.endpoint(cfg); checkTtsSignal(signal);
    const job = this.crypto.randomUUID();
    const cancel = () => { void this.httpRequest(endpoint, '/cancel', { job }, undefined, 2000).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await this.httpRequest(endpoint, '/transcribe', wav instanceof Uint8Array ? wav : new Uint8Array(wav), signal, 120000, { 'X-Job': job });
      return typeof result?.text === 'string' ? result.text : '';
    } catch (error) { cancel(); throw error;
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  // 16 kHz mono WAV bytes in, recognised text out. Audio never leaves this computer.
  async transcribe(model, wav, signal) {
    if ((await this.status(model)).phase !== 'ready') throw ttsError('localMissing');
    return this.recognition(await this.config(model), wav, signal);
  }
  dispose() { for (const op of this.operations.values()) op.abort.abort(); this.listeners.clear(); }
}
