import { Notice, Platform, Scope } from 'obsidian';
import { PhraseSegmenter, TARGET_RATE, concatSamples, encodeWav, hasSpeech } from '../core/asr/audio.js';
import { errorText, t } from '../i18n.js';
import { editorView } from './editor-extension.js';
import { MAX_SECONDS, Recorder } from './recorder.js';
import { formatDuration, iconButton } from './ui.js';
import { ChooseEngineModal } from './choose-engine.js';

// Speak → text at the cursor. "After you finish" recognises the whole recording; "while you speak" recognises each phrase.
export class DictationManager {
  constructor(plugin) {
    this.plugin = plugin; this.session = null;
    this.status = plugin.addStatusBarItem(); this.status.addClass('qaudio-status', 'qaudio-recording-status', 'qaudio-hidden');
    this.status.addEventListener('click', () => this.finish());
  }
  isActive() { return !!this.session; }
  async toggle(view) {
    if (!this.session) return this.start(view);
    if (this.session.state === 'listening') return this.finish();
    if (this.session.state === 'error') return this.close();
  }
  async start(view) {
    const plugin = this.plugin;
    if (this.session) return;
    if (!view?.file || !view.editor) { new Notice(t('notice.noNote')); return; }
    const engine = plugin.transcription.engine();
    if (!engine) { new ChooseEngineModal(plugin, () => this.start(view)).open(); return; }
    const problem = await plugin.transcription.readiness(engine);
    if (problem) {
      if (problem.code === 'localMissing') new ChooseEngineModal(plugin, () => this.start(view)).open();
      else { new Notice(errorText(problem)); plugin.openSettings(); }
      return;
    }
    if (plugin.reading.isPlaying()) { plugin.reading.pause(); new Notice(t('dictation.readingPaused')); }
    const editor = view.editor, preview = view.getMode() === 'preview';
    const value = editor.getValue();
    const anchor = preview ? value.length : editor.posToOffset(editor.getCursor('to'));
    const settings = plugin.settings.asr, live = settings.mode === 'live';
    const session = this.session = {
      view, file: view.file, engine, anchor, live, state: 'preparing', inserted: 0, failed: [],
      prefix: preview && value.trim() ? (value.endsWith('\n\n') ? '' : value.endsWith('\n') ? '\n' : '\n\n') : '',
      abort: new AbortController(), queue: Promise.resolve(), started: Date.now(),
    };
    this.mount(session);
    const win = view.containerEl.ownerDocument.defaultView || window;
    const segmenter = live ? new PhraseSegmenter({ onPhrase: phrase => this.enqueue(session, phrase), maxSeconds: Math.min(25, plugin.transcription.chunking(engine).maximum) }) : null;
    session.recorder = new Recorder({ win, keepAudio: settings.keepAudio, onFrame: segmenter ? frame => segmenter.push(frame) : null, onLevel: db => this.level(session, db) });
    session.segmenter = segmenter;
    try { await session.recorder.start(); }
    catch (error) { if (this.session === session) { new Notice(errorText(error), 10000); this.close(); } return; }
    if (this.session !== session) { void session.recorder.stop(); return; }
    session.state = 'listening'; session.started = Date.now();
    session.timer = win.setInterval(() => {
      if (session.recorder.seconds >= MAX_SECONDS) { new Notice(t('dictation.limit')); void this.finish(); }
      this.render();
    }, 250);
    this.render();
  }
  enqueue(session, phrase) {
    session.queue = session.queue.then(async () => {
      if (session.abort.signal.aborted || this.session !== session) return;
      session.pending = (session.pending || 0) + 1; this.render();
      try { this.insert(session, await this.plugin.transcription.recognizePiece(session.engine, phrase, session.abort.signal)); }
      catch (error) { if (error.name !== 'AbortError') { session.failed.push(phrase); session.error = error; } }
      finally { session.pending--; this.render(); }
    });
  }
  async finish() {
    const session = this.session;
    if (!session || session.state !== 'listening') return;
    session.state = 'transcribing'; this.render();
    window.clearInterval(session.timer);
    await session.recorder.stop();
    const samples = session.recorder.samples();
    try {
      if (session.live) { session.segmenter.flush(); await session.queue; if (session.failed.length) throw session.error; }
      else if (hasSpeech(samples)) {
        const text = await this.plugin.transcription.transcribe(samples, { engine: session.engine, signal: session.abort.signal,
          onProgress: (done, total) => { session.progress = total > 1 ? { done, total } : null; this.render(); } });
        this.insert(session, text);
      }
      if (this.session !== session) return;
      if (!session.inserted) new Notice(t(hasSpeech(samples) ? 'dictation.empty' : 'dictation.noSpeech'));
      if (this.plugin.settings.asr.keepAudio && hasSpeech(samples)) await this.saveRecording(session, samples, true);
      this.close();
    } catch (error) {
      if (error?.name === 'AbortError' || this.session !== session) return;
      session.samples = session.live ? concatSamples(session.failed) : samples;
      session.state = 'error'; session.error = error; this.render();
    }
  }
  async retry() {
    const session = this.session;
    if (!session || session.state !== 'error') return;
    session.state = 'transcribing'; session.error = null; session.failed = []; this.render();
    try {
      this.insert(session, await this.plugin.transcription.transcribe(session.samples, { engine: this.plugin.transcription.engine() || session.engine, signal: session.abort.signal,
        onProgress: (done, total) => { session.progress = total > 1 ? { done, total } : null; this.render(); } }));
      if (this.plugin.settings.asr.keepAudio) await this.saveRecording(session, session.samples, true);
      this.close();
    } catch (error) {
      if (error?.name === 'AbortError' || this.session !== session) return;
      session.state = 'error'; session.error = error; this.render();
    }
  }
  cancel() { if (this.session) this.close(); }
  close() {
    const session = this.session; if (!session) return;
    this.session = null;
    session.abort.abort(); window.clearInterval(session.timer);
    void session.recorder?.stop();
    if (session.scope) this.plugin.app.keymap.popScope(session.scope);
    session.bar?.remove();
    this.render();
  }
  // Text goes where the cursor was when dictation started, after anything already dictated.
  insert(session, text) {
    if (!text) return;
    const { view } = session;
    if (view.file !== session.file || !view.containerEl.isConnected) {
      const prefixText = session.prefix; session.prefix = '';
      const anchor = session.anchor;
      session.anchor += prefixText.length + text.length; session.inserted += text.length;
      void this.plugin.app.vault.process(session.file, data => { const at = Math.min(anchor, data.length); return data.slice(0, at) + prefixText + text + data.slice(at); });
      return;
    }
    const editor = view.editor, doc = editor.getValue(), at = Math.min(session.anchor, doc.length);
    const before = doc[at - 1] || '', after = doc[at] || '';
    const spaced = /[A-Za-z0-9.,!?;:]/.test(before) && /^[A-Za-z0-9]/.test(text) ? ` ${text}` : text;
    const content = session.prefix + spaced; session.prefix = '';
    // At the start of a non-empty line (e.g. before a heading), dictation becomes its own paragraph
    // instead of being glued onto that line. Later phrases continue before this break.
    const suffix = !session.separated && (at === 0 || before === '\n') && after && after !== '\n' ? '\n\n' : '';
    if (suffix) session.separated = true;
    session.inserting = true;
    try { editor.replaceRange(content + suffix, editor.offsetToPos(at)); } finally { session.inserting = false; }
    session.anchor = at + content.length; session.inserted += text.length;
    if (view.getMode() === 'source') editor.setCursor(editor.offsetToPos(session.anchor));
  }
  onDocChange(cm, changes) {
    const session = this.session;
    if (!session || session.inserting || editorView(session.view) !== cm) return;
    session.anchor = changes.mapPos(session.anchor, 1);
  }
  async saveRecording(session, samples, embed) {
    const app = this.plugin.app, blob = session.recorder?.audioBlob();
    const ext = blob ? (/mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm') : 'wav';
    const data = blob ? await blob.arrayBuffer() : encodeWav(samples, TARGET_RATE).buffer;
    const stamp = window.moment ? window.moment().format('YYYYMMDD-HHmmss') : String(Date.now());
    try {
      const path = await app.fileManager.getAvailablePathForAttachment(`Recording ${stamp}.${ext}`, session.file.path);
      const file = await app.vault.createBinary(path, data);
      if (embed) {
        const link = app.fileManager.generateMarkdownLink(file, session.file.path);
        this.insert(session, `\n${link.startsWith('!') ? link : `!${link}`}\n`);
      } else new Notice(t('dictation.saved', { path }));
      return file;
    } catch (error) { new Notice(errorText(error)); return null; }
  }

  mount(session) {
    const { view } = session, plugin = this.plugin;
    const bar = session.bar = view.contentEl.createDiv({ cls: 'qaudio-bar qaudio-dictation' });
    const labelId = `qaudio-dictation-${Date.now().toString(36)}`;
    bar.createSpan({ cls: 'qaudio-sr', text: t('dictation.label'), attr: { id: labelId } });
    bar.setAttr('role', 'region'); bar.setAttr('aria-labelledby', labelId);
    const row = bar.createDiv('qaudio-bar-row');
    const ui = session.ui = {};
    ui.dot = row.createSpan('qaudio-rec-dot');
    ui.timer = row.createSpan({ cls: 'qaudio-timer', text: '0:00' });
    ui.meter = row.createDiv('qaudio-meter');
    for (let i = 0; i < 5; i++) ui.meter.createSpan();
    ui.text = row.createSpan({ cls: 'qaudio-dictation-status', attr: { role: 'status', 'aria-live': 'polite' } });
    ui.finish = iconButton(row, 'check', t('dictation.finish'), () => this.finish(), { text: true, cls: 'qaudio-primary-text' });
    ui.cancel = iconButton(row, 'x', t('dictation.cancel'), () => this.cancel());
    ui.message = bar.createDiv({ cls: 'qaudio-bar-message qaudio-hidden', attr: { role: 'alert' } });
    session.scope = new Scope(plugin.app.scope);
    session.scope.register([], 'Escape', () => { this.cancel(); return false; });
    plugin.app.keymap.pushScope(session.scope);
    this.render();
  }
  level(session, db) {
    if (!session.ui || session.state !== 'listening') return;
    const value = Math.max(0, Math.min(1, (db + 60) / 45)), bars = session.ui.meter.children;
    for (let i = 0; i < bars.length; i++) bars[i].setCssProps({ '--qaudio-level': String(Math.max(0.12, value * (0.6 + 0.4 * Math.sin(Date.now() / 90 + i * 1.7) ** 2))) });
  }
  render() {
    const session = this.session;
    this.status.toggleClass('qaudio-hidden', !session || !Platform.isDesktopApp);
    if (session) this.status.setText(`● ${t('dictation.label')} ${formatDuration(session.recorder?.seconds || 0)}`);
    if (!session?.ui) return;
    const ui = session.ui, state = session.state;
    ui.timer.setText(formatDuration(session.recorder?.seconds || 0));
    session.bar.toggleClass('is-listening', state === 'listening');
    ui.text.setText(state === 'preparing' ? t('dictation.preparing') : state === 'listening' ? (session.pending ? t('dictation.transcribing') : t('dictation.listening'))
      : state === 'transcribing' ? (session.progress ? t('dictation.progress', session.progress) : t('dictation.transcribing')) : '');
    ui.finish.toggleClass('qaudio-hidden', state !== 'listening');
    ui.message.empty(); ui.message.toggleClass('qaudio-hidden', state !== 'error');
    if (state === 'error') {
      ui.message.createSpan({ text: errorText(session.error) });
      const actions = ui.message.createSpan('qaudio-message-actions');
      iconButton(actions, 'rotate-ccw', t('dictation.retry'), () => this.retry(), { text: true });
      iconButton(actions, 'save', t('dictation.saveAudio'), async () => { if (await this.saveRecording(session, session.samples, false)) this.close(); }, { text: true });
      iconButton(actions, 'settings', t('player.openSettings'), () => this.plugin.openSettings(), { text: true });
    }
  }
  dispose() { this.close(); }
}
