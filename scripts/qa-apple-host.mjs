/* global require -- Desktop Obsidian QA bridge; this script is never bundled. */
/* eslint-disable @typescript-eslint/no-require-imports -- Host acceptance needs the desktop CommonJS bridge. */
// Isolated desktop acceptance. Speech bytes are a deterministic WAV; decode, encoders, files and Obsidian are real.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const root = process.cwd(), base = await fs.mkdtemp(path.join(os.tmpdir(), 'qaudio-share-'));
const vault = path.join(base, 'qaudio-apple-qa'), profile = path.join(base, 'profile'), plugin = path.join(vault, '.obsidian/plugins/qiaomu-audio');
const output = path.resolve(process.env.QA_OUTPUT || 'artifacts/apple-qa');
await fs.mkdir(plugin, { recursive: true }); await fs.mkdir(profile); await fs.mkdir(output, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) await fs.copyFile(path.join(root, name), path.join(plugin, name));
await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), '["qiaomu-audio"]');
await fs.writeFile(path.join(vault, 'Apple QA.md'), '# Apple QA\n\n音频分享测试。第二句验证字幕。\n');
await fs.writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { abcd1100abcd9278: { path: vault, ts: 1, open: true } }, disableGpu: true }));
if (process.env.OBSIDIAN_ASAR) await fs.copyFile(process.env.OBSIDIAN_ASAR, path.join(profile, 'obsidian-1.15.0.asar'));
await new Promise((resolve, reject) => {
  const speech = spawn('/usr/bin/say', ['-v','Tingting','-o',path.join(base,'fixture.aiff'),'今天我们测试乔木语音。会议定在星期五下午三点，请大家提前准备好材料。']);
  speech.on('error',reject); speech.on('close',code=>code===0?resolve():reject(Error('Fixture generation failed')));
});
const port = 9278, host = spawn(process.env.OBSIDIAN_EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], { stdio: 'ignore' });
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
    const r = await call('Runtime.evaluate', { expression: "!!(window.app?.vault?.getName()==='qaudio-apple-qa'&&app.workspace.layoutReady)", returnByValue: true });
    if (r.result?.value) break;
    if (i === 149) throw Error('QA vault not ready'); await delay(200);
  }
  const result = await call('Runtime.evaluate', { expression: `(${acceptance.toString()})(${JSON.stringify(output)}, ${process.env.QA_SETTINGS_ONLY === "1"}, ${JSON.stringify(process.env.QA_LANGUAGE || "zh")}, ${JSON.stringify(path.join(base,"fixture.aiff"))})`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  await fs.writeFile(path.join(output, 'host-result.json'), JSON.stringify(result.result.value, null, 2));
  const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, 'host.png'), Buffer.from(image.data, 'base64'));
  console.log(JSON.stringify(result.result.value, null, 2));
} finally { socket?.close(); host.kill(); }

async function acceptance(output, settingsOnly, language, fixturePath) {
  const app = window.app, fs = require('node:fs/promises');
  if (app.vault.getName() !== 'qaudio-apple-qa') throw Error('Wrong vault');
  window.localStorage.setItem('language', language);
  app.plugins.setEnable(true);
  for (let i=0;i<150 && !app.plugins.plugins['qiaomu-audio']?.settingTab;i++) await new Promise(resolve => window.setTimeout(resolve, 100));
  const p = app.plugins.plugins['qiaomu-audio'];
  await app.workspace.getLeaf(false).setViewState({type:'markdown',state:{file:'Apple QA.md',mode:'source'}});
  await new Promise(resolve => window.setTimeout(resolve, 300));
  const view = p.activeView();
  p.settings.asr.engine = 'apple'; p.settings.asr.language = 'zh'; p.settings.asr.mode = 'batch'; p.settings.asr.keepAudio = true;
  await p.saveSettings();
  if (settingsOnly) {
    p.openSettings('asr');
    for(let i=0;i<100 && !p.settingTab.root?.querySelector('option[value=apple]');i++) await new Promise(resolve => window.setTimeout(resolve, 100));
    const root=p.settingTab.root;
    if(!root?.querySelector('option[value=apple]')) throw Error('Apple settings not visible');
    const settingsWin=root.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
    settingsWin.show(); settingsWin.focus(); await new Promise(resolve=>window.setTimeout(resolve,500));
    await fs.writeFile(output + '/settings-' + language + '.png', (await settingsWin.webContents.capturePage()).toPNG());
    return {settingsText:root.textContent,tab:p.settingTab.tab,connected:root.isConnected};
  }
  const readiness = await p.transcription.readiness(); if (readiness) throw readiness;
  const fixtureBytes = await fs.readFile(fixturePath);
  const cp = require('node:child_process');
  const fixtureWav = fixturePath + '.wav';
  await new Promise((resolve, reject) => cp.execFile('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', fixturePath, fixtureWav], error => error ? reject(error) : resolve()));
  const wav = await fs.readFile(fixtureWav);
  const text = await p.apple().transcribe(wav, 'zh');
  if (!text.includes('星期五') || !text.includes('材料')) throw Error('Unexpected native recognition: ' + text);
  const capture = p.apple().recorder({}); await capture.start();
  const playback = cp.spawn('/usr/bin/afplay', [fixturePath]);
  await new Promise(resolve => playback.on('close', resolve));
  await new Promise(resolve => window.setTimeout(resolve, 500)); await capture.stop();
  const samples = capture.samples();
  if (samples.length < 16000) throw Error('No real system audio captured');
  const transcript = await p.transcription.transcribe(samples);
  if (!transcript.includes('星期五')) throw Error('System audio transcript mismatch: ' + transcript);
  // Exercise the actual command, real native capture, finish, cursor insertion and saved attachment.
  view.editor.setValue('# Apple QA\n\n'); view.editor.setCursor({line:2,ch:0});
  app.commands.executeCommandById('qiaomu-audio:transcribe-system');
  for (let i=0;i<100 && p.dictation.session?.state !== 'listening';i++) await new Promise(resolve => window.setTimeout(resolve, 100));
  if (p.dictation.session?.state !== 'listening') throw Error('System command did not start');
  const player = cp.spawn('/usr/bin/afplay', [fixturePath]);
  await new Promise(resolve => player.on('close', resolve));
  await new Promise(resolve => window.setTimeout(resolve, 300));
  const controls = document.querySelector('.qaudio-bar.qaudio-dictation');
  if (!(/电脑|sound from your Mac|System audio/i.test(controls?.textContent || ''))) throw Error('System recording label missing: '+controls?.textContent+' state='+p.dictation.session?.state+' source='+p.dictation.session?.source);
  const win = require('electron').remote.getCurrentWindow();
  await fs.writeFile(output + '/recording.png', (await win.webContents.capturePage()).toPNG());
  await p.dictation.finish();
  const inserted = view.editor.getValue();
  if (!inserted.includes('星期五') || !inserted.includes('![[')) throw Error('Text or audio attachment missing: ' + inserted);
  const saved = app.vault.getFiles().filter(f => f.extension === 'wav');
  if (!saved.length || (await app.vault.readBinary(saved[0])).byteLength < 32044) throw Error('Saved recording missing or empty');
  // A new startup followed immediately by cancellation leaves no active recorder or late text.
  const before = inserted; const starting = p.dictation.start(view, 'system');
  for (let i=0;i<50 && !p.dictation.session;i++) await new Promise(resolve => window.setTimeout(resolve, 20));
  p.dictation.cancel(); await starting;
  await new Promise(resolve => window.setTimeout(resolve, 200));
  if (p.dictation.isActive() || view.editor.getValue() !== before) throw Error('Cancellation changed text or left recording active');
  p.openSettings('asr');
  for(let i=0;i<100 && !p.settingTab.root?.querySelector('option[value=apple]');i++) await new Promise(resolve => window.setTimeout(resolve, 100));
  const settings = p.settingTab.root;
  if (!settings?.querySelector('option[value=apple]')) throw Error('Apple settings missing');
  const settingsWin = settings.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
  settingsWin.show(); settingsWin.focus(); await new Promise(resolve=>window.setTimeout(resolve,500));
  await fs.writeFile(output + '/settings.png', (await settingsWin.webContents.capturePage()).toPNG());
  return { nativeText: text, capturedSeconds: samples.length/16000, systemTranscript: transcript, inserted, savedRecordings: saved.map(f=>f.path), cancellation:true,  fixtureBytes:fixtureBytes.byteLength, settingsVisible:!!settings };
}
/* eslint-enable @typescript-eslint/no-require-imports -- End isolated desktop QA bridge. */
