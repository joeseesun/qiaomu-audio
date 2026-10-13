import { Menu, Notice } from 'obsidian';
import { openVoicePicker, audioSpeechChoiceText } from './speech-choices.js';
import { voiceChoices } from '../core/tts/choices.js';
import { localVoiceChoices } from '../runtime/local.js';
import { markdownChunks } from '../markdown/speech-source.js';
import { currentLanguage, errorText, t } from '../i18n.js';
import { RATES } from '../settings.js';
import { editorView, rangeVisible, showSpeechRange } from './editor-extension.js';
import { iconButton } from './ui.js';
import { speechFingerprint, rememberProgress, resumeOffset } from '../shared/progress.js';

const BUSY = ['playing', 'loading'];

// Reads one Markdown note at a time: chooses where to start, follows the sentence on screen, and owns the player bar.
export class ReadingManager {
  constructor(plugin) {
    this.plugin = plugin; this.session = null;
    this.unsubscribe = plugin.speech.subscribe(() => this.render());
    this.status = plugin.addStatusBarItem(); this.status.addClass('qaudio-status', 'qaudio-hidden');
    this.status.addEventListener('click', () => this.toggle());
  }
  get controller() { return this.plugin.speech.controller; }
  isActive() { return !!this.session; }
  isPlaying() { return !!this.session && this.controller.owner === this.session.owner && BUSY.includes(this.controller.state); }

  start(view, mode = 'auto') {
    if (!view?.file || !view.editor) { new Notice(t('notice.noNote')); return; }
    const speech = this.plugin.speech, editor = view.editor, source = editor.getValue(), { limit, clauses } = speech.chunking();
    let items, index = 0;
    if ((mode === 'auto' || mode === 'selection') && editor.somethingSelected()) {
      const from = editor.posToOffset(editor.getCursor('from')), to = editor.posToOffset(editor.getCursor('to'));
      items = markdownChunks(source.slice(from, to), { base: from, limit, clauses });
    } else {
      items = markdownChunks(source, { limit, clauses });
      let offset = 0;
      if (mode === 'cursor' || (mode === 'auto' && view.getMode() === 'source')) offset = editor.posToOffset(editor.getCursor());
      else if (mode === 'auto') {
        const line = Math.floor(view.previewMode?.getScroll?.() || 0);
        offset = line > 0 ? editor.posToOffset({ line: Math.min(line, editor.lineCount() - 1), ch: 0 }) : 0;
      }
      const found = items.findIndex(item => item.end > offset);
      index = found > 0 ? found : 0;
    }
    const fingerprint = speechFingerprint(source), progressKey = view.file.path;
    const selection = editor.somethingSelected() && (mode === 'auto' || mode === 'selection');
    if (!selection && mode === 'auto' && index === 0) { const offset = resumeOffset(this.plugin.settings.readingProgress, progressKey, fingerprint); const found = items.findIndex(item => item.end > offset); if (found >= 0) index = found; }
    if (!items.length) { new Notice(t('notice.emptyText')); return; }
    this.stop();
    const session = this.session = { view, file: view.file, items, follow: true, error: null, fingerprint, progressKey, selection };
    const owner = session.owner = {
      view, follow: true,
      clearHighlight: () => showSpeechRange(view, null),
      onSegment: item => this.onSegment(session, item),
    };
    this.mountBar(session);
    this.watchScroll(session);
    const profile = speech.profile(), problem = speech.configurationError(profile);
    if (problem) { session.error = problem; this.render(); return; }
    this.controller.makeAudio = () => new (view.containerEl.ownerDocument.defaultView || window).Audio();
    this.controller.start(owner, items, profile, { index, rate: speech.settings.rate });
  }
  onSegment(session, item) {
    if (session !== this.session) return;
    const { view } = session;
    if (view.file !== session.file || !view.containerEl.isConnected) { this.stop(); return; }
    if (!session.selection) {
      rememberProgress(this.plugin.settings.readingProgress, session.progressKey, session.fingerprint, item.start);
      window.clearTimeout(this.progressTimer); this.progressTimer = window.setTimeout(() => { void this.plugin.saveSettings(); }, 700);
    }
    showSpeechRange(view, { from: item.start, to: item.end });
    if (session.follow) this.reveal(session, item);
  }
  reveal(session, item) {
    const { view } = session, editor = view.editor;
    session.programmatic = Date.now();
    if (view.getMode() === 'preview') {
      const line = editor.offsetToPos(item.start).line, top = view.previewMode.getScroll();
      const visible = Math.max(5, Math.floor(view.contentEl.clientHeight / 28) - 4);
      if (line < top || line > top + visible) view.previewMode.applyScroll(Math.max(0, line - 2));
    } else if (!rangeVisible(view, item.start)) {
      editor.scrollIntoView({ from: editor.offsetToPos(item.start), to: editor.offsetToPos(item.end) }, true);
    }
  }
  // Scrolling by hand while reading stops following until "Return to reading" is pressed.
  watchScroll(session) {
    const el = session.view.contentEl;
    const away = () => {
      if (session !== this.session || !session.follow || !this.isPlaying()) return;
      if (Date.now() - (session.programmatic || 0) < 400) return;
      session.follow = false; this.render();
    };
    el.addEventListener('wheel', away, { passive: true });
    el.addEventListener('touchmove', away, { passive: true });
    session.unwatch = () => { el.removeEventListener('wheel', away); el.removeEventListener('touchmove', away); };
  }
  returnToReading() {
    const session = this.session; if (!session) return;
    session.follow = true;
    const item = this.controller.items[this.controller.index];
    if (item) this.reveal(session, item);
    this.render();
  }
  // Keeps saved offsets on the same words when the note is edited during reading.
  onDocChange(cm, changes) {
    const session = this.session;
    if (!session || editorView(session.view) !== cm) return;
    for (const item of session.items) {
      item.start = changes.mapPos(item.start, 1); item.end = Math.max(item.start, changes.mapPos(item.end, -1));
    }
  }
  toggle() {
    this.plugin.speech.stopPreview();
    const session = this.session; if (!session) return;
    if (session.error) { this.retry(); return; }
    if (this.controller.state === 'ended') { this.controller.index = 0; this.controller.retry(); return; }
    this.controller.toggle();
  }
  pause() { if (this.session && BUSY.includes(this.controller.state)) this.controller.toggle(); }
  skip(delta) { this.plugin.speech.stopPreview(); if (this.session && !this.session.error) this.controller.skip(delta); }
  retry() {
    const session = this.session; if (!session) return;
    const profile = this.plugin.speech.profile(), problem = this.plugin.speech.configurationError(profile);
    session.error = problem;
    if (problem) { this.render(); return; }
    if (this.controller.owner === session.owner) { this.controller.profile = { ...profile }; this.controller.cache.clear(); this.controller.retry(); }
    else this.controller.start(session.owner, session.items, profile, { index: this.controller.owner === session.owner ? this.controller.index : 0, rate: this.plugin.speech.settings.rate });
  }
  // Applies a changed voice or service to the current sentence.
  restartWithSettings() {
    const session = this.session; if (!session) return;
    if (this.controller.owner === session.owner && this.controller.items.length) {
      const index = this.controller.index;
      const profile = this.plugin.speech.profile(), problem = this.plugin.speech.configurationError(profile);
      session.error = problem;
      if (problem) { this.controller.pause(); this.render(); return; }
      this.controller.start(session.owner, session.items, profile, { index, rate: this.plugin.speech.settings.rate, paused: this.controller.state === 'paused' });
    } else this.retry();
  }
  stop() {
    const session = this.session; if (!session) return;
    window.clearTimeout(this.progressTimer);
    if (!session.selection) void this.plugin.saveSettings();
    this.session = null;
    this.plugin.speech.discardPreview(session.owner); this.voicePicker?.close();
    this.controller.stop(session.owner);
    showSpeechRange(session.view, null);
    session.unwatch?.(); session.bar?.remove();
    session.view.contentEl.removeClass('qaudio-has-bar');
    this.render();
  }
  // Stops when the note in the reading tab changes or the tab closes.
  checkWorkspace() {
    const session = this.session; if (!session) return;
    if (!session.view.containerEl.isConnected || session.view.file !== session.file) this.stop();
  }

  mountBar(session) {
    const { view } = session, plugin = this.plugin;
    view.contentEl.addClass('qaudio-has-bar');
    const bar = session.bar = view.contentEl.createDiv({ cls: 'qaudio-bar qaudio-player' });
    const labelId = `qaudio-player-${Date.now().toString(36)}`;
    bar.createSpan({ cls: 'qaudio-sr', text: t('player.label'), attr: { id: labelId } });
    bar.setAttr('role', 'region'); bar.setAttr('aria-labelledby', labelId);
    const row = bar.createDiv('qaudio-bar-row');
    const ui = session.ui = {};
    ui.voice = iconButton(row, 'audio-lines', t('player.voice'), event => this.voiceMenu(event), { text: true, cls: 'qaudio-voice' });
    ui.previous = iconButton(row, 'skip-back', t('player.previous'), () => this.skip(-1));
    ui.play = iconButton(row, 'play', t('player.play'), () => this.toggle(), { cls: 'qaudio-primary' });
    ui.next = iconButton(row, 'skip-forward', t('player.next'), () => this.skip(1));
    ui.speed = row.createEl('button', { cls: 'qaudio-button qaudio-speed', attr: { type: 'button' } });
    ui.speed.addEventListener('click', event => this.speedMenu(event));
    ui.follow = iconButton(row, 'locate-fixed', t('player.follow'), () => this.returnToReading(), { text: true, cls: 'qaudio-follow' });
    ui.settings = iconButton(row, 'settings', t('player.settings'), () => plugin.openSettings());
    ui.close = iconButton(row, 'x', t('player.close'), () => this.stop());
    ui.message = bar.createDiv({ cls: 'qaudio-bar-message', attr: { role: 'status', 'aria-live': 'polite' } });
    ui.position = bar.createDiv({ cls: 'qaudio-sr', attr: { 'aria-live': 'off' } });
    this.render();
  }
  voiceMenu() {
    this.voicePicker?.close();
    this.voicePicker = openVoicePicker(this.plugin, { onSettings: () => this.plugin.openSettings(), tx: audioSpeechChoiceText, chinese: currentLanguage() === 'zh', onChange: async () => { await this.plugin.saveSettings(); this.restartWithSettings(); }, errorText: error => errorText(error, this.plugin.speech.profile().id) });
  }
  speedMenu(event) {
    const speech = this.plugin.speech, menu = new Menu();
    for (const rate of RATES) {
      menu.addItem(item => item.setTitle(`${rate}×`).setChecked(rate === speech.settings.rate).onClick(async () => {
        speech.settings.rate = rate; this.controller.setRate(rate);
        await this.plugin.saveSettings();
        if (speech.settings.provider === 'system' && this.isPlaying()) new Notice(t('player.speedNote'));
        this.render();
      }));
    }
    menu.showAtMouseEvent(event);
  }
  voiceLabel() {
    const profile = this.plugin.speech.profile();
    if (!profile.voice) return t('tts.systemVoice');
    const choices = profile.id === 'localModel' ? localVoiceChoices(profile.model, currentLanguage() === 'zh') : voiceChoices(profile, this.plugin.voiceCatalogs?.[profile.id] || {});
    const label = choices.find(v => v.id === profile.voice)?.label || (this.plugin.macVoices || []).find(v => v.id === profile.voice)?.label || profile.voice.split(/[:/.]/).pop();
    return label.split(' · ')[0].slice(0, 18);
  }
  render() {
    const session = this.session, c = this.controller;
    if (session && !session.selection && c.owner === session.owner && c.state === 'ended') { rememberProgress(this.plugin.settings.readingProgress, session.progressKey, session.fingerprint, 0, true); void this.plugin.saveSettings(); }
    const state = !session ? 'idle' : session.error ? 'error' : c.owner === session.owner ? c.state : 'idle';
    this.status.toggleClass('qaudio-hidden', !session);
    if (session) this.status.setText(`${state === 'playing' || state === 'loading' ? '▶' : '❚❚'} ${t(state === 'playing' || state === 'loading' ? 'status.reading' : 'status.paused')}`);
    if (!session?.ui) return;
    const ui = session.ui, playing = state === 'playing' || state === 'loading';
    ui.play.setIconName(playing ? 'pause' : 'play'); ui.play.setLabel(t(playing ? 'player.pause' : 'player.play'));
    ui.play.toggleClass('is-loading', state === 'loading');
    ui.speed.setText(`${this.plugin.speech.settings.rate}×`);
    ui.voice.setLabel(this.voiceLabel());
    ui.follow.toggleClass('qaudio-hidden', session.follow || !playing);
    ui.previous.disabled = ui.next.disabled = !!session.error;
    if (c.owner === session.owner && c.items.length) ui.position.setText(t('state.position', { index: c.index + 1, total: c.items.length }));
    ui.message.empty();
    const error = session.error || (state === 'error' ? c.error : null);
    if (error) {
      ui.message.createSpan({ text: errorText(error, this.plugin.speech.settings.provider) });
      const actions = ui.message.createSpan('qaudio-message-actions');
      iconButton(actions, 'rotate-ccw', t('player.retry'), () => this.retry(), { text: true });
      iconButton(actions, 'settings', t('player.openSettings'), () => this.plugin.openSettings(), { text: true });
    } else if (!this.plugin.settings.tts.welcomed && this.plugin.speech.settings.provider === 'edge') {
      ui.message.createSpan({ text: t('player.welcome') });
      iconButton(ui.message.createSpan('qaudio-message-actions'), 'check', t('player.gotIt'), async () => {
        this.plugin.settings.tts.welcomed = true; await this.plugin.saveSettings(); this.render();
      }, { text: true });
    } else if (state === 'loading' || state === 'ended') ui.message.setText(t(`state.${state}`));
    ui.message.toggleClass('qaudio-hidden', !ui.message.hasChildNodes() && !ui.message.textContent);
  }
  dispose() { this.stop(); this.unsubscribe(); }
}
