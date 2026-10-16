import { Menu, Notice } from 'obsidian';
import { openVoicePicker, audioSpeechChoiceText } from './speech-choices.js';
import { voiceChoices } from '../core/tts/choices.js';
import { localVoiceChoices } from '../runtime/local.js';
import { markdownChunks, readingPlan } from '../markdown/speech-source.js';
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
  attachTrigger(view, trigger) {
    const slot = trigger.ownerDocument.createElement('div'); slot.className = 'qaudio-speech-slot';
    trigger.before(slot); slot.append(trigger); view._qaudioSpeechSlot = slot;
    const more = iconButton(slot, 'ellipsis', t('player.more'), event => this.playbackMenu(event, view), { cls: 'qaudio-idle-more' });
    trigger.addClass('qaudio-trigger'); more.addEventListener('mousedown', event => event.preventDefault());
    const resize = new slot.ownerDocument.defaultView.ResizeObserver(() => slot.classList.toggle('is-narrow', view.containerEl.clientWidth <= 650));
    resize.observe(view.containerEl); slot.classList.toggle('is-narrow', view.containerEl.clientWidth <= 650);
    slot._qaudioDispose = () => resize.disconnect();
    this.plugin.register(slot._qaudioDispose);
    return slot;
  }
  finishClosing() {
    if (!this.closing) return;
    const { slot, bar, timer } = this.closing; slot.ownerDocument.defaultView.clearTimeout(timer);
    slot.classList.remove('is-open', 'is-closing'); bar.remove(); this.closing = null;
  }
  updateRing(session) {
    if (!session.ui?.progress || this.controller.owner !== session.owner) return;
    const c = this.controller, total = session.items.reduce((sum, item) => sum + item.text.length, 0);
    const before = session.items.slice(0, c.index).reduce((sum, item) => sum + item.text.length, 0);
    const fraction = c.state === 'ended' ? 1 : Math.min(1, (before + (session.spoken || 0)) / Math.max(1, total));
    session.ui.play.style.setProperty('--qaudio-progress', String(fraction));
    session.ui.progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }
  get controller() { return this.plugin.speech.controller; }
  isActive() { return !!this.session; }
  isPlaying() { return !!this.session && this.controller.owner === this.session.owner && BUSY.includes(this.controller.state); }

  start(view, mode = 'auto') {
    if (!view?.file || !view.editor) { new Notice(t('notice.noNote')); return; }
    if (!this.plugin.settings.tts.welcomed) { this.voiceMenu(); return; }
    const speech = this.plugin.speech, editor = view.editor, source = editor.getValue(), { limit, clauses } = speech.chunking();
    if (mode === 'selection' && !editor.somethingSelected()) { new Notice(t('notice.selectText')); return; }
    let items, index = 0;
    const fingerprint = speechFingerprint(source), progressKey = view.file.path;
    const selection = editor.somethingSelected() && (mode === 'auto' || mode === 'selection');
    if ((mode === 'auto' || mode === 'selection') && editor.somethingSelected()) {
      const from = editor.posToOffset(editor.getCursor('from')), to = editor.posToOffset(editor.getCursor('to'));
      items = markdownChunks(source.slice(from, to), { base: from, limit, clauses });
    } else {
      let offset = 0;
      if (mode === 'cursor' || (mode === 'auto' && view.getMode() === 'source')) offset = editor.posToOffset(editor.getCursor());
      else if (mode === 'auto') {
        const line = Math.floor(view.previewMode?.getScroll?.() || 0);
        offset = line > 0 ? editor.posToOffset({ line: Math.min(line, editor.lineCount() - 1), ch: 0 }) : 0;
      }
      if (mode === 'auto' && offset === 0) offset = resumeOffset(this.plugin.settings.readingProgress, progressKey, fingerprint);
      ({ items, index } = readingPlan(source, { limit, clauses, offset, exact: mode === 'cursor' }));
    }
    if (!items.length || index < 0) { new Notice(t(mode === 'cursor' ? 'notice.noTextAfterCursor' : 'notice.emptyText')); return; }
    // Reuse the mounted bar for jumps in the same note; remounting moves focus
    // and creates a visible flash at exactly the moment the user seeks.
    let session = this.session;
    if (session?.view === view && session.file === view.file) {
      speech.stopPreview();
      Object.assign(session, { items, index, follow: true, error: null, spoken: 0, fingerprint, selection, dirty: false, completed: false, scrubbing: false });
    } else {
      this.stop();
      session = this.session = { view, file: view.file, items, index, follow: true, error: null, fingerprint, progressKey, selection };
    }
    const owner = session.owner ||= {
      view, follow: true,
      clearHighlight: () => showSpeechRange(view, null),
      onSegment: item => this.onSegment(session, item),
      onProgress: (_item, _index, word) => { session.spoken = word?.end || 0; this.updateRing(session); },
    };
    if (!session.bar) { this.mountBar(session); this.watchScroll(session); }
    const profile = speech.profile(), problem = speech.configurationError(profile);
    if (problem) { this.controller.stop(session.owner); session.error = problem; this.render(); return; }
    this.controller.makeAudio = () => new (view.containerEl.ownerDocument.defaultView || window).Audio();
    this.controller.start(owner, items, profile, { index, rate: speech.settings.rate });
  }
  onSegment(session, item) {
    if (session !== this.session) return;
    const { view } = session;
    if (view.file !== session.file || !view.containerEl.isConnected) { this.stop(); return; }
    session.index = this.controller.index; session.spoken = 0; this.updateRing(session);
    if (!session.selection && !session.dirty) {
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
    const away = event => {
      if (session !== this.session || !session.follow) return;
      if (session.bar.contains(event.target)) return;
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
  toggleFollow() {
    if (!this.session) return;
    if (!this.session.follow) this.returnToReading();
    else { this.session.follow = false; this.render(); }
  }
  readFromCursor() {
    const session = this.session; if (!session) return;
    if (session.view.getMode() !== 'source') { new Notice(t('notice.cursorInEditor')); return; }
    this.start(session.view, session.view.editor.somethingSelected() ? 'selection' : 'cursor');
  }
  readFromStart() { if (this.session) this.start(this.session.view, 'start'); }
  seek(index) {
    this.plugin.speech.stopPreview();
    const session = this.session; if (!session || session.error) return;
    const offset = session.items[index]?.start;
    if (offset === undefined) return;
    if (session.dirty) {
      const paused = this.controller.state === 'paused';
      const source = session.view.editor.getValue(), options = this.plugin.speech.chunking();
      const first = session.items[0]?.start || 0, last = session.items.at(-1)?.end || source.length;
      const items = session.selection ? markdownChunks(source.slice(first, last), { ...options, base: first }) : markdownChunks(source, options);
      index = items.findIndex(item => item.end > offset);
      if (index < 0) { new Notice(t('notice.noTextAfterCursor')); return; }
      session.items = items;
      session.fingerprint = speechFingerprint(source); session.dirty = false;
      this.controller.start(session.owner, session.items, this.plugin.speech.profile(), { index, rate: this.plugin.speech.settings.rate, paused });
    } else this.controller.seek(index);
    session.index = index;
    if (this.controller.state === 'paused') {
      const item = session.items[index];
      if (!session.selection) { rememberProgress(this.plugin.settings.readingProgress, session.progressKey, session.fingerprint, item.start); void this.plugin.saveSettings(); }
      showSpeechRange(session.view, { from: item.start, to: item.end });
      if (session.follow) this.reveal(session, item);
    }
    this.render();
  }
  // Keeps saved offsets on the same words when the note is edited during reading.
  onDocChange(cm, changes) {
    const session = this.session;
    if (!session || editorView(session.view) !== cm) return;
    session.dirty = true;
    for (const item of session.items) {
      item.start = changes.mapPos(item.start, 1); item.end = Math.max(item.start, changes.mapPos(item.end, -1));
    }
  }
  toggle() {
    this.plugin.speech.stopPreview();
    const session = this.session; if (!session) return;
    if (session.error) { this.retry(); return; }
    if (this.controller.state === 'ended') { if (session.selection) this.seek(0); else this.readFromStart(); return; }
    if (session.dirty && this.controller.state === 'paused') { this.seek(this.controller.index); }
    this.controller.toggle();
  }
  pause() { if (this.session && BUSY.includes(this.controller.state)) this.controller.toggle(); }
  skip(delta) { if (this.session) this.seek(Math.max(0, Math.min(this.session.items.length - 1, this.controller.index + delta))); }
  retry() {
    const session = this.session; if (!session) return;
    const profile = this.plugin.speech.profile(), problem = this.plugin.speech.configurationError(profile);
    session.error = problem;
    if (problem) { this.render(); return; }
    if (this.controller.owner === session.owner) { this.controller.profile = { ...profile }; this.controller.cache.clear(); this.controller.retry(); }
    else this.controller.start(session.owner, session.items, profile, { index: session.index, rate: this.plugin.speech.settings.rate });
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
  stop(animate = false) {
    const session = this.session; if (!session) return;
    window.clearTimeout(this.progressTimer);
    if (!session.selection) void this.plugin.saveSettings();
    this.session = null;
    this.plugin.speech.discardPreview(session.owner); this.voicePicker?.close();
    this.controller.stop(session.owner);
    showSpeechRange(session.view, null);
    session.unwatch?.(); this.finishClosing();
    const slot = session.bar?.parentElement, win = slot?.ownerDocument.defaultView;
    if (animate && slot?.classList.contains('qaudio-speech-slot') && !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      session.ui.panel.hidden = true; session.ui.message.classList.add('qaudio-hidden'); session.ui.play.setIconName('play');
      session.bar.inert = true; slot.classList.add('is-closing');
      const focused = session.bar.contains(slot.ownerDocument.activeElement);
      const timer = win.setTimeout(() => { this.finishClosing(); if (focused) slot.querySelector('.qaudio-trigger')?.focus(); }, 340);
      this.closing = { slot, bar: session.bar, timer };
    } else { slot?.classList.remove('is-open'); session.bar?.remove(); }
    session.cleanPanel?.();
    session.layoutObserver?.disconnect();
    session.view.contentEl.style.removeProperty('--qaudio-player-height');
    session.view.contentEl.removeClass('qaudio-has-bar');
    this.render();
  }
  // Stops when the note in the reading tab changes or the tab closes.
  checkWorkspace() {
    const session = this.session; if (!session) return;
    if (!session.view.containerEl.isConnected || session.view.file !== session.file) this.stop();
    else this.render();
  }

  mountBar(session) {
    const { view } = session;
    this.finishClosing();
    const slot = view._qaudioSpeechSlot || view.contentEl;
    const bar = session.bar = slot.createDiv({ cls: 'qaudio-bar qaudio-player qaudio-inline' });
    slot.classList.add('is-open');
    const labelId = `qaudio-player-${Date.now().toString(36)}`;
    bar.createSpan({ cls: 'qaudio-sr', text: t('player.label'), attr: { id: labelId } });
    bar.setAttr('role', 'region'); bar.setAttr('aria-labelledby', labelId);
    const row = bar.createDiv('qaudio-bar-row');
    const tucked = bar.createDiv('qaudio-tucked');
    const ui = session.ui = {};
    ui.voice = iconButton(tucked, 'audio-lines', t('player.voice'), event => this.voiceMenu(event), { text: true, cls: 'qaudio-voice' });
    ui.previous = iconButton(tucked, 'skip-back', t('player.previous'), () => this.skip(-1));
    ui.play = iconButton(row, 'play', t('player.play'), () => this.toggle(), { cls: 'qaudio-primary' });
    ui.next = iconButton(tucked, 'skip-forward', t('player.next'), () => this.skip(1));
    ui.speed = row.createEl('button', { cls: 'qaudio-button qaudio-speed', attr: { type: 'button' } });
    const speedId = `qaudio-speed-${crypto.randomUUID()}`;
    bar.createSpan({ cls: 'qaudio-sr', text: t('player.speed'), attr: { id: speedId } }); ui.speed.setAttribute('aria-labelledby', speedId);
    ui.speed.addEventListener('click', event => this.speedMenu(event));
    ui.cursor = iconButton(tucked, 'text-cursor-input', t('cmd.readHere'), () => this.readFromCursor(), { cls: 'qaudio-cursor' });
    ui.follow = iconButton(tucked, 'locate-fixed', t('player.follow'), () => this.toggleFollow(), { cls: 'qaudio-follow' });
    ui.more = iconButton(row, 'ellipsis', t('player.more'), event => this.playbackMenu(event), { cls: 'qaudio-more' });
    ui.close = iconButton(row, 'x', t('player.close'), () => this.stop(true), { cls: 'qaudio-close' });
    ui.previous.addClass('qaudio-previous'); ui.play.addClass('qaudio-play'); ui.next.addClass('qaudio-next');
    const panel = bar.createDiv('qaudio-position-panel'); panel.hidden = true;
    const panelControls = panel.createDiv('qaudio-position-controls');
    panelControls.append(ui.previous, ui.next, ui.follow);
    ui.panel = panel;
    ui.progress = ui.play.createSpan({ cls: 'qaudio-sr', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, text: t('player.seek') });
    const footer = panel.createDiv('qaudio-player-footer');
    ui.state = footer.createSpan({ cls: 'qaudio-player-state', attr: { role: 'status', 'aria-live': 'polite' } });
    ui.position = footer.createSpan('qaudio-player-position');
    const seekLabel = panel.createEl('label', { cls: 'qaudio-player-seek' });
    seekLabel.createSpan({ cls: 'qaudio-sr', text: t('player.seek') });
    ui.seek = seekLabel.createEl('input', { type: 'range', attr: { min: '1', max: String(session.items.length), step: '1', value: String(session.index + 1) } });
    ui.seek.addEventListener('input', () => { session.scrubbing = true; ui.position.setText(t('state.position', { index: ui.seek.value, total: session.items.length })); });
    ui.seek.addEventListener('change', () => { session.scrubbing = false; this.seek(Number(ui.seek.value) - 1); });
    ui.seek.addEventListener('blur', () => { session.scrubbing = false; this.render(); });
    ui.message = bar.createDiv({ cls: 'qaudio-bar-message', attr: { role: 'status', 'aria-live': 'polite' } });
    // Clicking player controls must leave the editor's caret/selection intact.
    row.addEventListener('mousedown', event => event.preventDefault());
    const outside = event => { if (!panel.contains(event.target) && !ui.more.contains(event.target)) panel.hidden = true; };
    const escape = event => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopPropagation(); panel.hidden = true; ui.more.focus(); } };
    bar.ownerDocument.addEventListener('pointerdown', outside); bar.addEventListener('keydown', escape);
    session.cleanPanel = () => { bar.ownerDocument.removeEventListener('pointerdown', outside); bar.removeEventListener('keydown', escape); };
    this.render();
  }
  playbackMenu(event, view = this.session?.view) {
    if (!view) return;
    const session = this.session?.view === view ? this.session : null, anchor = event.currentTarget;
    const show = menu => { const box = anchor.getBoundingClientRect(); menu.setUseNativeMenu(false).showAtPosition({ x: box.left, y: box.bottom }); };
    const menu = new Menu();
    menu.addItem(item => item.setTitle(t('player.options')).setIcon('sliders-horizontal').onClick(() => {
      const next = new Menu();
      next.addItem(item => item.setTitle(t('player.speed')).setIcon('gauge').onClick(() => this.speedMenu({ currentTarget: anchor })));
      if (view.getMode() === 'source') next.addItem(item => item.setTitle(t(view.editor.somethingSelected() ? 'cmd.readSelection' : 'cmd.readHere')).setIcon('text-cursor-input').onClick(() => this.start(view, view.editor.somethingSelected() ? 'selection' : 'cursor')));
      next.addItem(item => item.setTitle(t('cmd.readStart')).setIcon('rotate-ccw').onClick(() => this.start(view, 'start')));
      show(next);
    }));
    menu.addItem(item => item.setTitle(t('player.sound')).setIcon('audio-lines').onClick(() => this.voiceMenu()));
    if (session) {
      menu.addItem(item => item.setTitle(t('player.positionFollow')).setIcon('locate-fixed').onClick(() => { session.ui.panel.hidden = false; session.ui.seek.focus(); }));
      menu.addItem(item => item.setTitle(t('player.close')).setIcon('square').onClick(() => this.stop(true)));
    }
    show(menu);
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
    const box = event.currentTarget.getBoundingClientRect(); menu.showAtPosition({ x: box.left, y: box.bottom });
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
    if (session && !session.completed && !session.selection && !session.dirty && c.owner === session.owner && c.state === 'ended') { session.completed = true; rememberProgress(this.plugin.settings.readingProgress, session.progressKey, session.fingerprint, 0, true); void this.plugin.saveSettings(); }
    const state = !session ? 'idle' : session.error ? 'error' : c.owner === session.owner ? c.state : 'idle';
    this.status.toggleClass('qaudio-hidden', !session);
    if (session) this.status.setText(t(`state.${state === 'error' ? 'paused' : state}`));
    if (!session?.ui) return;
    const ui = session.ui, playing = state === 'playing' || state === 'loading';
    const icon = playing ? 'pause' : state === 'ended' || state === 'error' ? 'rotate-ccw' : 'play';
    if (ui.play.dataset.icon !== icon) { ui.play.setIconName(icon); ui.play.dataset.icon = icon; if (!ui.play.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) ui.play.querySelector('.qaudio-icon').animate?.([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 150 }); }
    ui.play.setLabel(t(playing ? 'player.pause' : state === 'ended' ? 'player.replay' : state === 'error' ? 'player.retry' : 'player.play'));
    ui.play.toggleClass('is-loading', state === 'loading');
    this.updateRing(session);
    ui.speed.setText(`${this.plugin.speech.settings.rate}×`);
    ui.voice.setLabel(this.voiceLabel());
    ui.follow.setAttribute('aria-pressed', String(session.follow));
    ui.follow.setLabel(t(session.follow ? 'player.unfollow' : 'player.follow'));
    const index = c.owner === session.owner ? Math.min(c.index, session.items.length - 1) : session.index;
    ui.previous.disabled = !!session.error || index <= 0;
    ui.next.disabled = !!session.error || index >= session.items.length - 1;
    ui.cursor.disabled = session.view.getMode() !== 'source';
    ui.cursor.setLabel(t(session.view.editor.somethingSelected() ? 'cmd.readSelection' : 'cmd.readHere'));
    ui.seek.max = String(session.items.length); ui.seek.disabled = !!session.error || session.items.length < 2;
    if (!session.scrubbing) {
      ui.position.setText(t('state.position', { index: index + 1, total: session.items.length }));
      ui.seek.value = String(index + 1);
      ui.seek.setAttribute('aria-valuetext', ui.position.textContent);
    }
    ui.state.setText(`${t(state === 'error' ? 'state.failed' : `state.${state}`)}${session.selection ? ` · ${t('player.selection')}` : ''}`);
    const error = session.error || (state === 'error' ? c.error : null);
    const messageKey = error ? `error:${errorText(error, this.plugin.speech.settings.provider)}` : !this.plugin.settings.tts.welcomed && this.plugin.speech.settings.provider === 'edge' ? 'welcome' : '';
    if (session.messageKey === messageKey) return;
    session.messageKey = messageKey; ui.message.empty();
    if (error) {
      ui.message.createSpan({ text: errorText(error, this.plugin.speech.settings.provider) });
      const actions = ui.message.createSpan('qaudio-message-actions');
      iconButton(actions, 'rotate-ccw', t('player.retry'), () => this.retry(), { text: true });
      iconButton(actions, 'settings', t('player.openSettings'), () => this.voiceMenu(), { text: true });
    } else if (!this.plugin.settings.tts.welcomed && this.plugin.speech.settings.provider === 'edge') {
      ui.message.createSpan({ text: t('player.welcome') });
      iconButton(ui.message.createSpan('qaudio-message-actions'), 'check', t('player.gotIt'), async () => {
        this.plugin.settings.tts.welcomed = true; await this.plugin.saveSettings(); this.render();
      }, { text: true });
    }
    ui.message.toggleClass('qaudio-hidden', !ui.message.hasChildNodes() && !ui.message.textContent);
  }
  dispose() { this.voicePicker?.close(); this.stop(); this.finishClosing(); this.unsubscribe(); }
}
