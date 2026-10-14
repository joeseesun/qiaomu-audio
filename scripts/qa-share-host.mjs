/* global require -- Desktop Obsidian QA bridge; this script is never bundled. */
/* eslint-disable @typescript-eslint/no-require-imports -- Host acceptance needs the desktop CommonJS bridge. */
// Isolated desktop acceptance. Speech bytes are a deterministic WAV; decode, encoders, files and Obsidian are real.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const root = process.cwd(), base = await fs.mkdtemp(path.join(os.tmpdir(), 'qaudio-share-'));
const vault = path.join(base, 'qaudio-share-qa'), profile = path.join(base, 'profile'), plugin = path.join(vault, '.obsidian/plugins/qiaomu-audio');
const output = path.resolve(process.env.QA_OUTPUT || 'qa-share-output');
await fs.mkdir(plugin, { recursive: true }); await fs.mkdir(profile); await fs.mkdir(output, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) await fs.copyFile(path.join(root, name), path.join(plugin, name));
await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), '["qiaomu-audio"]');
await fs.writeFile(path.join(vault, 'Export QA.md'), '# Export QA\n\n音频分享测试。第二句验证字幕。\n');
await fs.writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { abcd1100abcd9276: { path: vault, ts: 1, open: true } }, disableGpu: true }));
if (process.env.OBSIDIAN_ASAR) await fs.copyFile(process.env.OBSIDIAN_ASAR, path.join(profile, 'obsidian-1.14.4.asar'));
const port = 9276, host = spawn(process.env.OBSIDIAN_EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], { stdio: 'ignore' });
let socket; const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let page;
  for (let i = 0; i < 100; i++) {
    try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); page = pages.find(p => p.type === 'page' && p.url === 'app://obsidian.md/index.html'); if (page) break; } catch { /* Host starting. */ }
    await delay(300);
  }
  if (!page) throw Error('Obsidian debug page did not start');
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let seq = 0; const pending = new Map();
  socket.on('message', raw => { const r = JSON.parse(raw); if (pending.has(r.id)) { const entry = pending.get(r.id); pending.delete(r.id); clearTimeout(entry.timer); r.error ? entry.reject(Error(JSON.stringify(r.error))) : entry.resolve(r.result); } });
  const call = (method, params) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(Error('QA timeout')), 180000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  // Wait for the actual vault and plugin APIs, not merely a loaded HTML page.
  for (let i = 0; i < 150; i++) {
    const r = await call('Runtime.evaluate', { expression: "!!(window.app?.vault?.getName()==='qaudio-share-qa'&&app.workspace.layoutReady)", returnByValue: true });
    if (r.result?.value) break;
    if (i === 149) throw Error('QA vault not ready'); await delay(200);
  }
  const result = await call('Runtime.evaluate', { expression: `(${acceptance.toString()})(${JSON.stringify(output)})`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  await fs.writeFile(path.join(output, 'host-result.json'), JSON.stringify(result.result.value, null, 2));
  const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, 'host.png'), Buffer.from(image.data, 'base64'));
  console.log(JSON.stringify(result.result.value, null, 2));
} finally { socket?.close(); host.kill(); }

async function acceptance(output) {
  const app = window.app;
  const errors = [], capture = e => errors.push(String(e.message || e.reason || e));
  window.addEventListener('error', capture); window.addEventListener('unhandledrejection', capture);
  if (app.vault.getName() !== 'qaudio-share-qa') throw Error('Wrong vault');
  app.plugins.setEnable(true); await app.plugins.loadManifests(); await app.plugins.enablePlugin('qiaomu-audio');
  const p = app.plugins.plugins['qiaomu-audio']; if (!p?.share) throw Error('Share manager missing');
  await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Export QA.md'));
  await new Promise(resolve => window.setTimeout(resolve, 150));
  app.commands.executeCommandById('qiaomu-audio:export-share');
  const modal = document.querySelector('.qaudio-share-modal'); if (!modal) throw Error('Export command did not open dialog: ' + p.activeView()?.getMode());
  const win = require('electron').remote.getCurrentWindow(); win.show(); win.focus();
  const fs = require('node:fs/promises'), path = require('node:path');
  const rate = 24000, samples = rate, bytes = new Uint8Array(44 + samples * 2), data = new DataView(bytes.buffer);
  const str = (at, text) => [...text].forEach((c, i) => bytes[at + i] = c.charCodeAt(0));
  str(0, 'RIFF'); data.setUint32(4, bytes.length - 8, true); str(8, 'WAVE'); str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) data.setInt16(44 + i * 2, Math.round(6000 * Math.sin(2 * Math.PI * 220 * i / rate)), true);
  // Only speech synthesis is replaced. The production manager, decoding and every export encoder run unchanged.
  p.speech.controller.synthesize = async () => ({ bytes, mime: 'audio/wav' });
  p.settings.tts.provider = 'edge'; p.settings.share.folder = path.join(output, 'files');
  const source = p.activeView().editor.getValue(), items = p.share.items(source, [{ from: 0, to: source.length }]);
  const profile = p.speech.profile(), args = { items, profile, title: 'Windows Export QA', caption: '字幕测试', signal: new AbortController().signal, options: { format: 'mp3', videos: [], speed: 1.5, srt: true, coverImage: false, cover: false, outro: false, visual: 'spectrum' } };
  const audio = await p.share.generate(args); if (!audio.files.some(f => f.kind === 'audio') || !audio.files.some(f => f.kind === 'subtitle')) throw Error('Audio outputs missing');
  const saved = await p.share.save(audio.files, 'Export QA.md'); const twice = await p.share.save(audio.files, 'Export QA.md');
  if (saved[0].fullPath === twice[0].fullPath || !twice[0].name.includes(' 2.')) throw Error('Collision overwritten');
  for (const file of saved) if ((await fs.stat(file.fullPath)).size < 10) throw Error('Empty export');
  let video;
  try {
    const generated = await p.share.generate({ ...args, title: 'Windows Video QA', options: { ...args.options, format: 'mp4', speed: 1, videos: ['portrait', 'landscape'], coverImage: true, cover: true } });
    if (generated.files.filter(f => f.kind === 'video').length !== 2 || !generated.files.some(f => f.kind === 'image')) throw Error('Video outputs missing');
    const files = await p.share.save(generated.files, 'Export QA.md'); video = { supported: true, files: files.map(f => ({ name: f.name, bytes: f.bytes.length })) };
  } catch (e) { if (e.code !== 'videoUnsupported') throw e; video = { supported: false, code: e.code, message: p.share.failed(e, profile), mp3FallbackPassed: true }; }
  const slider = modal.querySelector('input[type=range]'); const style = getComputedStyle(slider);
  const sliderStyle = { inline: slider.getAttribute('style'), background: style.background, track: getComputedStyle(slider, '::-webkit-slider-runnable-track').background, variables: Object.fromEntries([...style].filter(k => k.startsWith('--slider')).map(k => [k, style.getPropertyValue(k)])) };
  if (errors.length) throw Error(JSON.stringify(errors));
  return { os: process.platform, versions: process.versions, installerVersion: require('electron').remote.app.getVersion(), pluginVersion: p.manifest.version, synthesizedVoice: false, mp3: true, srt: true, speed: 1.5, customFolder: true, collision: true, command: true, sliderStyle, video, errors };
}

/* eslint-enable @typescript-eslint/no-require-imports -- End desktop QA bridge. */
