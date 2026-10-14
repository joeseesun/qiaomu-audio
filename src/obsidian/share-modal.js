import { Modal, Notice, Platform, Setting } from 'obsidian';
import { currentLanguage, errorText, t } from '../i18n.js';
import { SHARE_SPEEDS } from '../settings.js';
import { outroAccounts } from '../core/share/brand.js';
import { characterCount, estimateSeconds } from '../core/share/scope.js';
import { FPS, buildScene, drawContent, drawCover, drawOutro } from '../core/share/scene.js';
import { estimateMarks } from '../core/tts/timing.js';
import { providerLabel } from '../speech.js';
import { audioSpeechChoiceText, openVoicePicker } from './speech-choices.js';
import { formatDuration, iconButton } from './ui.js';

const PAID_LIMIT = 5000, LONG_VIDEO = 180;
const PRESETS = [
  { id: 'short', format: 'mp4', videos: ['portrait'] },
  { id: 'wide', format: 'mp4', videos: ['landscape'] },
  { id: 'audio', format: 'mp3', videos: ['portrait'] },
];
const phaseWeights = (speed, video) => ({ voice: 0.5, speed: speed ? 0.06 : 0, audio: video ? 0 : 0.1, video: video ? 0.4 : 0 });
const size = bytes => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// One dialog: pick what to export, how it should sound and look, then make the files.
export class ShareModal extends Modal {
  constructor(manager, context) {
    super(manager.app);
    this.manager = manager; this.context = context; this.plugin = manager.plugin;
    const saved = this.plugin.settings.share, desktop = manager.canMakeVideo();
    this.s = { scope: context.scopes[0].id, picked: new Set(), edited: null, title: null, format: desktop ? saved.format : 'mp3', videos: new Set(saved.videos), speed: saved.speed,
      cover: saved.cover, outro: saved.outro, srt: saved.srt, coverImage: saved.coverImage, embed: saved.embed };
    this.images = {}; this.busy = false;
  }
  get speech() { return this.manager.speech; }
  get desktop() { return this.manager.canMakeVideo(); }

  onOpen() {
    this.setTitle(t('share.title')); this.modalEl.addClass('qaudio-share-modal'); this.contentEl.addClass('qaudio-modal', 'qaudio-share');
    const body = this.body = this.contentEl.createDiv('qaudio-share-body');
    this.renderPresets(body); this.renderScope(body); this.renderText(body); this.renderVoice(body); this.renderLook(body); this.renderMore(body);
    this.footer = this.contentEl.createDiv('qaudio-share-footer');
    this.renderActions();
    this.refresh();
    void Promise.all([this.manager.image(this.plugin.settings.share.avatar), this.manager.image(this.plugin.settings.share.background)]).then(([avatar, background]) => {
      if (this.closed) { avatar?.close?.(); background?.close?.(); return; }
      this.images = { avatar, background }; this.drawPreviews();
    });
  }
  onClose() {
    this.closed = true; this.abort?.abort(); this.stopAudition(); window.clearTimeout(this.previewTimer);
    this.images.avatar?.close?.(); this.images.background?.close?.(); this.contentEl.empty();
  }

  // ---- state -------------------------------------------------------------------------------------------------
  scopeData() { return this.context.scopes.find(s => s.id === this.s.scope) || this.context.scopes[0]; }
  ranges() {
    const scope = this.scopeData();
    return scope.id === 'sections' ? [...this.s.picked].sort((a, b) => a - b).map(i => ({ from: scope.headings[i].start, to: scope.headings[i].end })) : scope.ranges;
  }
  items() { return this.manager.items(this.context.source, this.ranges(), this.s.edited); }
  defaultTitle() {
    const scope = this.scopeData();
    return (scope.id === 'section' ? scope.title : this.context.view.file.basename) || t('share.untitled');
  }
  title() { return (this.s.title ?? '').trim() || this.defaultTitle(); }
  isVideo() { return this.s.format === 'mp4' && this.desktop; }
  orientations() { return ['portrait', 'landscape'].filter(o => this.s.videos.has(o)); }
  hasSignature() { const share = this.plugin.settings.share; return !!(share.name || share.accounts.some(a => a.handle?.trim())); }

  // ---- layout ------------------------------------------------------------------------------------------------
  chips(parent, options, selected, onPick) {
    const row = parent.createDiv({ cls: 'qaudio-chips', attr: { role: 'group' } }), buttons = new Map();
    const paint = () => { for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(selected(id))); };
    for (const option of options) {
      const button = row.createEl('button', { cls: 'qaudio-chip', text: option.label, attr: { type: 'button' } });
      if (option.disabled) button.disabled = true;
      button.addEventListener('click', () => { onPick(option.id); paint(); });
      buttons.set(option.id, button);
    }
    paint(); row.paint = paint; return row;
  }
  renderPresets(body) {
    const options = PRESETS.filter(p => this.desktop || p.format === 'mp3').map(p => ({ id: p.id, label: t(`share.preset.${p.id}`) }));
    this.presetRow = this.chips(body.createDiv('qaudio-share-row'), options, id => { const p = PRESETS.find(x => x.id === id); return this.s.format === p.format && (p.format === 'mp3' || (this.s.videos.size === 1 && this.s.videos.has(p.videos[0]))); },
      id => { const p = PRESETS.find(x => x.id === id); this.s.format = p.format; if (p.format === 'mp4') this.s.videos = new Set(p.videos); this.refresh(); });
    this.presetRow.addClass('qaudio-presets');
  }
  renderScope(body) {
    const setting = new Setting(body).setName(t('share.scope'));
    setting.addDropdown(drop => {
      for (const scope of this.context.scopes) drop.addOption(scope.id, t(`share.scope.${scope.id}`, { title: scope.title || '' }));
      drop.setValue(this.s.scope).onChange(value => { this.s.scope = value; this.s.edited = null; this.s.title = null; this.refresh(); });
    });
    this.scopeSetting = setting; this.pickList = body.createDiv('qaudio-share-sections');
    this.stats = body.createDiv({ cls: 'qaudio-share-stats', attr: { role: 'status', 'aria-live': 'polite' } });
  }
  renderPicker() {
    const scope = this.scopeData(); this.pickList.empty();
    this.pickList.toggleClass('qaudio-hidden', scope.id !== 'sections');
    if (scope.id !== 'sections') return;
    scope.headings.forEach((heading, index) => {
      const label = this.pickList.createEl('label', { cls: 'qaudio-share-section' }); label.style.paddingInlineStart = `${(heading.level - 1) * 14}px`;
      const box = label.createEl('input', { type: 'checkbox' }); box.checked = this.s.picked.has(index);
      label.createSpan({ text: heading.title });
      box.addEventListener('change', () => { if (box.checked) this.s.picked.add(index); else this.s.picked.delete(index); this.s.edited = null; this.refresh({ keepPicker: true }); });
    });
  }
  renderText(body) {
    const details = body.createEl('details', { cls: 'qaudio-details qaudio-share-text' });
    const summary = details.createEl('summary'); summary.createSpan({ text: t('share.editText') });
    this.textArea = details.createEl('textarea', { cls: 'qaudio-share-textarea', attr: { rows: '6', spellcheck: 'false' } });
    details.createEl('p', { cls: 'qaudio-share-hint', text: t('share.editTextHint') });
    this.textArea.addEventListener('input', () => { this.s.edited = this.textArea.value; this.refresh({ keepText: true, keepPicker: true }); });
  }
  renderVoice(body) {
    this.voiceSetting = new Setting(body).setName(t('share.voice'));
    this.voiceSetting.addButton(b => { this.auditionButton = b; b.setButtonText(t('share.audition')).onClick(() => { void this.audition(); }); });
    this.voiceSetting.addButton(b => b.setButtonText(t('share.changeVoice')).onClick(() => this.pickVoice()));
    const speed = new Setting(body).setName(t('share.speed'));
    speed.addSlider(slider => {
      slider.setLimits(SHARE_SPEEDS.min, SHARE_SPEEDS.max, SHARE_SPEEDS.step).setValue(this.s.speed).onChange(value => { this.s.speed = Math.round(value * 100) / 100; this.speedValue?.setText(`${this.s.speed.toFixed(2).replace(/0$/, '')}×`); this.refresh({ keepText: true, keepPicker: true }); });
      slider.sliderEl.setAttribute('aria-labelledby', (speed.nameEl.id ||= `qaudio-share-speed-${crypto.randomUUID()}`));
    });
    // Newer Obsidian shows the slider value itself; older versions need ours.
    if (!speed.controlEl.querySelector('.slider-value')) this.speedValue = speed.controlEl.createSpan({ cls: 'qaudio-share-value', text: `${this.s.speed.toFixed(2).replace(/0$/, '')}×` });
    this.speedNote = speed.descEl;
  }
  renderLook(body) {
    this.formatSetting = new Setting(body).setName(t('share.format'));
    this.formatRow = this.chips(this.formatSetting.controlEl, [{ id: 'mp3', label: 'MP3' }, { id: 'mp4', label: 'MP4', disabled: !this.desktop }], id => this.s.format === id, id => { this.s.format = id; this.refresh({ keepText: true, keepPicker: true }); });
    this.videoBlock = body.createDiv('qaudio-share-video');
    this.shapeSetting = new Setting(this.videoBlock).setName(t('share.shape'));
    this.shapeRow = this.chips(this.shapeSetting.controlEl, [{ id: 'portrait', label: t('share.portrait') }, { id: 'landscape', label: t('share.landscape') }], id => this.s.videos.has(id), id => {
      if (this.s.videos.has(id)) { if (this.s.videos.size > 1) this.s.videos.delete(id); } else this.s.videos.add(id);
      this.refresh({ keepText: true, keepPicker: true });
    });
    new Setting(this.videoBlock).setName(t('share.cover')).addToggle(toggle => toggle.setValue(this.s.cover).onChange(value => { this.s.cover = value; this.schedulePreview(); }));
    this.outroSetting = new Setting(this.videoBlock).setName(t('share.outro'));
    this.outroSetting.addToggle(toggle => { this.outroToggle = toggle; toggle.setValue(this.s.outro && this.hasSignature()).setDisabled(!this.hasSignature()).onChange(value => { this.s.outro = value; this.schedulePreview(); }); });
    this.outroSetting.addButton(b => { this.outroSetup = b; b.setButtonText(t('share.setSignature')).onClick(() => { this.close(); this.plugin.openSettings('share'); }); });
    this.outroSetup.buttonEl.toggleClass('qaudio-hidden', this.hasSignature());
    this.previews = this.videoBlock.createDiv('qaudio-share-previews');
    for (const key of ['cover', 'content', 'outro']) { const frame = this.previews.createDiv('qaudio-share-frame'); frame[key] = frame.createEl('canvas', { attr: { 'aria-hidden': 'true' } }); this[`${key}Frame`] = frame; }
    this.videoNote = this.videoBlock.createEl('p', { cls: 'qaudio-share-hint' });
  }
  renderMore(body) {
    const details = body.createEl('details', { cls: 'qaudio-details qaudio-advanced qaudio-share-more' });
    details.createEl('summary').createSpan({ text: t('share.more') });
    const card = details.createDiv('qaudio-card');
    const titleRow = new Setting(card).setName(t('share.titleLabel'));
    titleRow.nameEl.id = `qaudio-share-title-${crypto.randomUUID()}`;
    titleRow.addText(text => {
      text.setPlaceholder(this.defaultTitle()).onChange(value => { this.s.title = value; this.schedulePreview(); });
      this.titleInput = text; text.inputEl.setAttribute('aria-labelledby', titleRow.nameEl.id);
    });
    new Setting(card).setName(t('share.srt')).setDesc(t('share.srtDesc')).addToggle(toggle => toggle.setValue(this.s.srt).onChange(value => { this.s.srt = value; }));
    this.coverImageSetting = new Setting(card).setName(t('share.coverImage')).setDesc(t('share.coverImageDesc')).addToggle(toggle => toggle.setValue(this.s.coverImage).onChange(value => { this.s.coverImage = value; }));
    this.embedSetting = new Setting(card).setName(t('share.embed')).addToggle(toggle => toggle.setValue(this.s.embed).onChange(value => { this.s.embed = value; }));
    this.destination = new Setting(card).setName(t('share.destination'));
    this.destination.addButton(b => b.setButtonText(t('share.changeFolder')).onClick(() => { this.close(); this.plugin.openSettings('share'); }));
  }
  renderActions() {
    this.footer.empty();
    const progress = this.footer.createDiv({ cls: 'qaudio-share-progress qaudio-hidden', attr: { role: 'status', 'aria-live': 'polite' } });
    this.progressText = progress.createSpan(); this.progressBar = progress.createEl('progress', { attr: { max: '1', value: '0' } }); this.progressBox = progress;
    this.error = this.footer.createDiv({ cls: 'qaudio-share-error qaudio-hidden', attr: { role: 'alert' } });
    const buttons = this.footer.createDiv('qaudio-share-buttons');
    this.cancelButton = buttons.createEl('button', { text: t('settings.cancel') }); this.cancelButton.addEventListener('click', () => this.close());
    this.makeButton = buttons.createEl('button', { cls: 'mod-cta', text: t('share.make') }); this.makeButton.addEventListener('click', () => { void this.run(); });
  }

  // ---- updates -----------------------------------------------------------------------------------------------
  refresh({ keepText = false, keepPicker = false } = {}) {
    if (this.closed) return;
    if (!this.desktop && this.s.format === 'mp4') this.s.format = 'mp3';
    const items = this.items(), video = this.isVideo();
    if (!keepPicker) this.renderPicker();
    if (!keepText && this.s.edited === null) this.textArea.value = items.map(item => item.text).join('\n');
    const chars = characterCount(items), seconds = estimateSeconds(items) / this.s.speed;
    this.stats.empty();
    if (!items.length) this.stats.setText(t('share.empty'));
    else {
      this.stats.createSpan({ text: t('share.stats', { chars, time: formatDuration(seconds) }) });
      const profile = this.speech.profile();
      if (this.manager.isPaid(profile) && chars > PAID_LIMIT) this.stats.createDiv({ cls: 'qaudio-share-warn', text: t('share.costWarn', { chars }) });
      if (video && seconds > LONG_VIDEO) this.stats.createDiv({ cls: 'qaudio-share-warn', text: t('share.longVideo') });
    }
    this.makeButton.disabled = this.busy || !items.length;
    this.voiceSetting.setDesc(this.voiceText());
    this.speedNote.setText(this.s.speed === 1 ? '' : t('share.speedNote'));
    this.presetRow.paint(); this.formatRow.paint(); this.shapeRow.paint();
    this.videoBlock.toggleClass('qaudio-hidden', !video);
    this.videoNote.setText(this.desktop ? '' : t('share.videoDesktop'));
    this.formatSetting.setDesc(this.desktop ? '' : t('share.videoDesktop'));
    this.titleInput?.setPlaceholder(this.defaultTitle());
    const folder = Platform.isDesktopApp ? this.plugin.settings.share.folder.trim() : '';
    this.destination.setDesc(folder || t('share.destinationVault'));
    this.embedSetting.setDesc(folder ? t('share.embedOutside') : t('share.embedDesc'));
    this.embedSetting.settingEl.toggleClass('qaudio-hidden', !!folder);
    this.destination.settingEl.toggleClass('qaudio-hidden', !Platform.isDesktopApp);
    this.schedulePreview();
  }
  voiceText() {
    const profile = this.speech.profile(), choice = this.speech.choices(profile, { chinese: currentLanguage() === 'zh', tx: audioSpeechChoiceText }).find(c => c.id === profile.voice);
    const label = choice?.label || profile.voice || t('tts.systemVoice');
    return profile.id === 'system' ? t('share.systemVoice') : `${providerLabel(t, profile.id, profile.label || profile.id)} · ${label}`;
  }
  pickVoice() {
    this.stopAudition();
    const plugin = this.plugin, id = this.speech.profile().id;
    const modal = openVoicePicker(plugin, { tx: audioSpeechChoiceText, chinese: currentLanguage() === 'zh', onChange: async () => { await plugin.saveSettings(); this.refresh({ keepText: true, keepPicker: true }); },
      errorText: error => errorText(error, id), onSettings: () => { this.close(); plugin.openSettings(); } });
    const previous = modal.onClosed; modal.onClosed = () => { previous?.(); this.refresh({ keepText: true, keepPicker: true }); };
  }
  // First sentences at the chosen speed, so the voice can be judged before paying for the whole export.
  async audition() {
    if (this.auditioning) { this.stopAudition(); return; }
    const profile = this.speech.profile(), problem = this.speech.configurationError(profile);
    if (profile.id === 'system') { this.showError(t('share.systemVoice')); return; }
    if (problem) { this.showError(errorText(problem, profile.id)); return; }
    const item = this.items()[0]; if (!item) return;
    this.showError(''); this.auditioning = new AbortController(); this.auditionButton.setButtonText(t('settings.stop'));
    const abort = this.auditioning;
    try {
      const result = await this.manager.synthesize(profile, { text: item.text.slice(0, 120) }, abort.signal);
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime })), audio = new Audio(url);
      audio.preservesPitch = true; audio.playbackRate = this.s.speed;
      this.auditionAudio = audio; this.auditionUrl = url;
      audio.addEventListener('ended', () => this.stopAudition()); audio.addEventListener('error', () => this.stopAudition());
      await audio.play();
    } catch (error) { const message = this.manager.failed(error, profile); this.stopAudition(); if (message) this.showError(message); }
  }
  stopAudition() {
    this.auditioning?.abort(); this.auditioning = null;
    if (this.auditionAudio) { this.auditionAudio.pause(); this.auditionAudio = null; }
    if (this.auditionUrl) { URL.revokeObjectURL(this.auditionUrl); this.auditionUrl = null; }
    this.auditionButton?.setButtonText(t('share.audition'));
  }
  showError(message) { this.error?.setText(message || ''); this.error?.toggleClass('qaudio-hidden', !message); }

  // What the video will look like, drawn with the same code that renders it.
  schedulePreview() { window.clearTimeout(this.previewTimer); this.previewTimer = window.setTimeout(() => this.drawPreviews(), 120); }
  drawPreviews() {
    if (this.closed || !this.isVideo()) return;
    const items = this.items().slice(0, 2); if (!items.length) return;
    const orientation = this.orientations()[0] || 'portrait', share = this.plugin.settings.share;
    let at = 0;
    const cues = items.map(item => {
      const duration = Math.max(1.6, item.text.length / ((item.text.match(/[㐀-鿿]/g) || []).length > item.text.length / 2 ? 4.5 : 15)), cue = { item, from: at, to: at + duration, marks: estimateMarks(item.text, duration, at) };
      at += duration + 0.2; return cue;
    });
    const envelope = Float32Array.from({ length: Math.ceil(at * FPS) + 90 }, (_, i) => 0.55 + 0.35 * Math.sin(i / 2.3) * Math.cos(i / 7));
    const accounts = outroAccounts(share.accounts, kind => this.manager.platformLabel(kind));
    const [w, h] = orientation === 'landscape' ? [1920, 1080] : [1080, 1920];
    const make = (key, draw) => {
      const canvas = this[`${key}Frame`][key]; canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'), scene = buildScene({ orientation, title: this.title(), caption: t('share.captionSample'), byline: share.name, cues, envelope, duration: at,
        cover: { image: this.images.background || null }, outro: { name: share.name, avatar: this.images.avatar || null, accounts } }, ctx);
      draw(ctx, scene);
    };
    this.coverFrame.toggleClass('qaudio-hidden', !this.s.cover); this.outroFrame.toggleClass('qaudio-hidden', !(this.s.outro && this.hasSignature()));
    this.previews.toggleClass('is-landscape', orientation === 'landscape');
    if (this.s.cover) make('cover', (ctx, scene) => drawCover(ctx, scene, 1));
    make('content', (ctx, scene) => { const mark = cues[0].marks[Math.min(1, cues[0].marks.length - 1)]; drawContent(ctx, scene, mark ? (mark.from + mark.to) / 2 : 0.5); });
    if (this.s.outro && this.hasSignature()) make('outro', (ctx, scene) => drawOutro(ctx, scene, 3.6));
  }

  // ---- generating --------------------------------------------------------------------------------------------
  setBusy(busy) {
    this.busy = busy; this.makeButton.disabled = busy; this.body.toggleClass('is-busy', busy);
    this.makeButton.setText(busy ? t('share.making') : t('share.make')); this.cancelButton.setText(busy ? t('share.cancelMake') : t('settings.cancel'));
    this.progressBox.toggleClass('qaudio-hidden', !busy);
  }
  async run() {
    if (this.busy) return;
    const profile = this.speech.profile(), problem = this.speech.configurationError(profile);
    this.stopAudition(); this.showError('');
    if (profile.id === 'system') { this.showError(t('share.systemVoice')); return; }
    if (problem) { this.showError(errorText(problem, profile.id)); return; }
    const items = this.items(); if (!items.length) return;
    const { speed } = this.s, video = this.isVideo(), weights = phaseWeights(speed !== 1, video), order = ['voice', 'speed', 'audio', 'video'];
    const abort = this.abort = new AbortController();
    this.setBusy(true);
    const onProgress = ({ phase, fraction }) => {
      const before = order.slice(0, order.indexOf(phase)).reduce((sum, key) => sum + weights[key], 0), total = Object.values(weights).reduce((a, b) => a + b, 0);
      this.progressBar.value = Math.min(1, (before + weights[phase] * fraction) / total);
      this.progressText.setText(t(`share.phase.${phase}`, { percent: Math.round(fraction * 100) }));
    };
    const title = this.title();
    try {
      const options = { format: this.s.format, videos: this.orientations(), speed, cover: this.s.cover, outro: this.s.outro, srt: this.s.srt, coverImage: this.s.coverImage && video };
      const profileNow = this.speech.profile();
      const result = await this.manager.generate({ items, profile: profileNow, options, title, caption: t('share.caption', { time: formatDuration(estimateSeconds(items) / speed) }), signal: abort.signal, onProgress });
      if (abort.signal.aborted) return;
      const saved = await this.manager.save(result.files, this.context.view.file.path);
      await this.remember();
      this.embed(saved);
      this.showResult(saved);
    } catch (error) {
      const message = this.manager.failed(error, profile);
      if (!this.closed) { this.setBusy(false); if (message) this.showError(message); }
    }
  }
  async remember() {
    const share = this.plugin.settings.share;
    Object.assign(share, { format: this.s.format, videos: this.orientations(), speed: this.s.speed, cover: this.s.cover, outro: this.s.outro, srt: this.s.srt, coverImage: this.s.coverImage, embed: this.s.embed });
    await this.plugin.saveSettings();
  }
  embed(saved) {
    if (!this.s.embed) return;
    const target = saved.find(f => f.vaultFile && f.kind === 'video') || saved.find(f => f.vaultFile && f.kind === 'audio'); if (!target) return;
    const { view } = this.context, editor = view.editor;
    if (!editor || !view.containerEl.isConnected) return;
    const link = `!${this.app.fileManager.generateMarkdownLink(target.vaultFile, view.file.path).replace(/^!/, '')}`;
    const at = editor.getCursor('to'), start = at.ch === 0;
    editor.replaceRange(`${start ? '' : '\n\n'}${link}\n${start ? '\n' : ''}`, at);
  }
  showResult(saved) {
    this.footer.empty(); this.body.addClass('qaudio-hidden'); this.setTitle(t('share.done'));
    const list = this.footer.createDiv('qaudio-share-results');
    for (const file of saved) {
      const row = list.createDiv('qaudio-share-result');
      row.createSpan({ cls: 'qaudio-share-file', text: file.name }); row.createSpan({ cls: 'qaudio-share-size', text: size(file.bytes.length) });
      if (Platform.isDesktopApp) { const show = iconButton(row, 'folder-open', t('share.reveal'), () => this.manager.reveal(file), { text: true }); show.addClass('qaudio-share-reveal'); }
    }
    this.footer.createEl('p', { cls: 'qaudio-share-hint', text: saved[0]?.fullPath ? t('share.savedFolder', { folder: saved[0].fullPath.slice(0, saved[0].fullPath.length - saved[0].name.length - 1) }) : t('share.savedHint') });
    const buttons = this.footer.createDiv('qaudio-share-buttons');
    const again = buttons.createEl('button', { text: t('share.again') }); again.addEventListener('click', () => { this.setTitle(t('share.title')); this.body.removeClass('qaudio-hidden'); this.renderActions(); this.setBusy(false); this.refresh({ keepText: true, keepPicker: true }); });
    const done = buttons.createEl('button', { cls: 'mod-cta', text: t('share.finish') }); done.addEventListener('click', () => this.close());
    new Notice(t('share.saved', { count: saved.length }));
  }
}
