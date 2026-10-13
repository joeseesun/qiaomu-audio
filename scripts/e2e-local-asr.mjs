// Manual end-to-end check: prepare Python/Sherpa using the external installer first.
// The plugin downloads model data only, then transcribes samples. Needs network on first run.
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const out = await build({ entryPoints: ['src/runtime/local.js'], bundle: true, write: false, format: 'cjs', platform: 'browser', external: ['obsidian', 'node:*', 'jszip'], loader: { '.py': 'text' } });
const module = { exports: {} };
runInNewContext(out.outputFiles[0].text, { module, Buffer, process, URL, AbortController, Uint8Array, TextEncoder, console,
  window: { setTimeout, clearTimeout }, setTimeout, clearTimeout,
  require: id => id === 'obsidian' ? { Platform: { isDesktop: true } } : require(id) });
const { createLocalTtsManager, LOCAL_ASR_MODEL } = module.exports;
const audio = await import('../src/core/asr/audio.js');
const manager = createLocalTtsManager({ vaultPaths: [] });
let last = '';
manager.subscribe((id, s) => { const line = `${s.phase}${s.total ? ` ${Math.floor(s.bytes / 1048576)}/${Math.ceil(s.total / 1048576)}MB` : ''}`; if (line !== last && !/download \d+\/\d+MB/.test(line) || Math.random() < 0.02) console.log('[state]', line); last = line; });
console.log('status before:', (await manager.status(LOCAL_ASR_MODEL)).phase);
const t0 = Date.now();
if ((await manager.status(LOCAL_ASR_MODEL)).phase !== 'ready') await manager.install(LOCAL_ASR_MODEL);
console.log('ready after', ((Date.now() - t0) / 1000).toFixed(1), 's');
const cfg = await manager.config(LOCAL_ASR_MODEL);
const sample = await readFile(`${cfg.modelDir}/test_wavs/zh.wav`);
let t = Date.now(); console.log('zh sample →', JSON.stringify(await manager.transcribe(LOCAL_ASR_MODEL, sample)), Date.now() - t, 'ms');
// Re-encode English sample through our own decoder-free path: parse PCM16 → Float32 → encodeWav.
const en = await readFile(`${cfg.modelDir}/test_wavs/en.wav`);
const pcm = new Int16Array(en.buffer, en.byteOffset + 44, (en.length - 44) >> 1);
const samples = Float32Array.from(pcm, v => v / 32768);
t = Date.now(); console.log('en via encodeWav →', JSON.stringify(await manager.transcribe(LOCAL_ASR_MODEL, audio.encodeWav(samples))), Date.now() - t, 'ms');
const abort = new AbortController(); const p = manager.transcribe(LOCAL_ASR_MODEL, sample, abort.signal); abort.abort();
try { await p; console.log('cancel: resolved (finished first)'); } catch (e) { console.log('cancel →', e.name); }
manager.dispose();
