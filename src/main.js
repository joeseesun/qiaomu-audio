import { MarkdownView, Platform, Plugin } from 'obsidian';
import { initLanguage, t } from './i18n.js';
import { TTS_PROVIDERS } from './core/tts/providers.js';
import { normalizeSettings, getSecret, setSecret, ttsSecretId, migrateAsrSecrets } from './settings.js';
import { SpeechService, hiddenProvider } from './speech.js';
import { TranscriptionService } from './transcription.js';
import { createLocalTtsManager } from './runtime/local.js';
import { audioEditorExtension, editorView } from './obsidian/editor-extension.js';
import { ReadingManager } from './obsidian/reading.js';
import { DictationManager } from './obsidian/dictation.js';
import { ShareManager } from './obsidian/share.js';
import { AudioSettingTab } from './obsidian/settings-tab.js';
import { quietAction } from './obsidian/ui.js';
import { createApi } from './api.js';

const DECORATED = Symbol('qiaomu-audio-actions');

export default class QiaomuAudioPlugin extends Plugin {
  async onload() {
    initLanguage();
    this.settings = normalizeSettings(await this.loadData(), Platform.isDesktopApp);
    migrateAsrSecrets(this.app, this.settings.asr.profiles);
    this.voiceCatalogs = {}; this.macVoices = null; this.actionEls = new Set();
    this.speech = new SpeechService(this);
    this.transcription = new TranscriptionService(this);
    this.reading = new ReadingManager(this);
    this.dictation = new DictationManager(this);
    this.share = new ShareManager(this);
    this.registerEditorExtension(audioEditorExtension((cm, changes) => {
      this.reading.onDocChange(cm, changes); this.dictation.onDocChange(cm, changes);
    }, cm => { if (editorView(this.reading.session?.view) === cm) this.reading.render(); }));
    this.registerCommands();
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      const view = info instanceof MarkdownView ? info : this.activeView();
      if (!view) return;
      menu.addItem(item => item.setSection('qiaomu-audio').setIcon('volume-2')
        .setTitle(t(editor.somethingSelected() ? 'cmd.readSelection' : 'cmd.readHere'))
        .onClick(() => this.reading.start(view, editor.somethingSelected() ? 'selection' : 'cursor')));
      menu.addItem(item => item.setSection('qiaomu-audio').setIcon('share-2').setTitle(t('cmd.share')).onClick(() => this.share.open(view)));
      menu.addItem(item => item.setSection('qiaomu-audio').setIcon('mic').setTitle(t('cmd.dictateHere')).onClick(() => this.dictation.toggle(view)));
    }));
    this.app.workspace.onLayoutReady(() => this.decorateViews());
    this.registerEvent(this.app.workspace.on('layout-change', () => { this.decorateViews(); this.reading.checkWorkspace(); }));
    this.registerEvent(this.app.workspace.on('file-open', () => this.reading.checkWorkspace()));
    this.settingTab = new AudioSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.api = createApi(this);
  }
  onunload() {
    this.settingTab?.hide();
    this.dictation?.dispose(); this.reading?.dispose(); this.speech?.dispose(); this.localManager?.dispose();
    for (const el of this.actionEls) el.remove();
    this.app.workspace.getLeavesOfType('markdown').forEach(leaf => { if (leaf.view) delete leaf.view[DECORATED]; });
  }
  activeView() { return this.app.workspace.getActiveViewOfType(MarkdownView); }
  // Desktop-only local runtime, created on first use so mobile never loads Node modules.
  local() {
    if (!this.localManager) {
      const vault = this.app.vault.adapter.getBasePath?.();
      this.localManager = createLocalTtsManager({ vaultPaths: vault ? [vault] : [] });
    }
    return this.localManager;
  }
  async saveSettings() { await this.saveData(this.settings); }
  openSettings(section) {
    const setting = this.app.setting;
    if (!setting) return;
    this.settingTab.focusSection = section;
    setting.open(); setting.openTabById(this.manifest.id);
  }
  readAloud(view) {
    if (view.editor.somethingSelected()) this.reading.start(view, 'selection');
    else if (this.reading.session?.view === view) this.reading.toggle();
    else this.reading.start(view, 'auto');
  }
  // Two header buttons on every Markdown note: read aloud and dictate.
  decorateViews() {
    for (const el of this.actionEls) if (!el.isConnected) { el._qaudioDispose?.(); this.actionEls.delete(el); }
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view[DECORATED]) continue;
      view[DECORATED] = true;
      const mic = quietAction(view.addAction('mic', t('action.dictate'), () => this.dictation.toggle(view)), t('action.dictate'));
      const read = quietAction(view.addAction('play', t('action.read'), () => this.readAloud(view)), t('action.read'));
      mic.addClass('qaudio-action'); read.addClass('qaudio-action');
      this.actionEls.add(mic); this.actionEls.add(read);
      this.actionEls.add(this.reading.attachTrigger(view, read));
    }
  }
  registerCommands() {
    const withView = run => checking => { const view = this.activeView(); if (!view) return false; if (!checking) run(view); return true; };
    const whenReading = run => checking => { if (!this.reading.isActive()) return false; if (!checking) run(); return true; };
    this.addCommand({ id: 'read-aloud', name: t('cmd.read'), icon: 'volume-2', checkCallback: withView(view => this.readAloud(view)) });
    this.addCommand({ id: 'read-from-start', name: t('cmd.readStart'), icon: 'volume-2', checkCallback: withView(view => this.reading.start(view, 'start')) });
    this.addCommand({ id: 'read-from-cursor', name: t('cmd.readHere'), icon: 'text-cursor-input', checkCallback: checking => {
      const view = this.activeView(); if (!view || view.getMode() !== 'source') return false;
      if (!checking) this.reading.start(view, 'cursor'); return true;
    } });
    this.addCommand({ id: 'return-to-reading', name: t('player.follow'), icon: 'locate-fixed', checkCallback: whenReading(() => this.reading.returnToReading()) });
    this.addCommand({ id: 'read-selection', name: t('cmd.readSelection'), icon: 'volume-2', editorCheckCallback: (checking, editor, info) => {
      if (!editor.somethingSelected()) return false;
      const view = info instanceof MarkdownView ? info : this.activeView();
      if (!view) return false;
      if (!checking) this.reading.start(view, 'selection');
      return true;
    } });
    this.addCommand({ id: 'export-share', name: t('cmd.share'), icon: 'share-2', editorCheckCallback: (checking, editor, info) => {
      const view = info instanceof MarkdownView ? info : this.activeView();
      if (!view?.file) return false;
      if (!checking) this.share.open(view);
      return true;
    } });
    this.addCommand({ id: 'toggle-reading', name: t('cmd.toggle'), icon: 'play', checkCallback: whenReading(() => this.reading.toggle()) });
    this.addCommand({ id: 'stop-reading', name: t('cmd.stop'), icon: 'square', checkCallback: whenReading(() => this.reading.stop()) });
    this.addCommand({ id: 'next-sentence', name: t('cmd.next'), icon: 'skip-forward', checkCallback: whenReading(() => this.reading.skip(1)) });
    this.addCommand({ id: 'previous-sentence', name: t('cmd.previous'), icon: 'skip-back', checkCallback: whenReading(() => this.reading.skip(-1)) });
    this.addCommand({ id: 'dictate', name: t('cmd.dictate'), icon: 'mic', checkCallback: checking => {
      const view = this.dictation.session?.view || this.activeView();
      if (!view) return false;
      if (!checking) void this.dictation.toggle(view);
      return true;
    } });
    this.addCommand({ id: 'cancel-dictation', name: t('cmd.cancelDictation'), icon: 'x', checkCallback: checking => {
      if (!this.dictation.isActive()) return false;
      if (!checking) this.dictation.cancel();
      return true;
    } });
  }
  async readerSpeechSettings() {
    let tts = this.app.plugins?.plugins?.['qiaomu-reader']?.settings?.tts;
    if (!tts) {
      try { tts = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/plugins/qiaomu-reader/data.json`))?.settings?.tts; }
      catch { tts = null; }
    }
    return tts && typeof tts === 'object' && TTS_PROVIDERS[tts.provider] ? tts : null;
  }
  // Copies Qiaomu Reader's speech service, voices, speed and keys. Returns the number of keys copied, or -1 if none found.
  async importReaderSpeech() {
    const tts = await this.readerSpeechSettings();
    if (!tts) return -1;
    const own = this.settings.tts;
    if (!hiddenProvider(tts.provider, '')) own.provider = tts.provider;
    own.profiles = { ...own.profiles, ...(tts.profiles && typeof tts.profiles === 'object' ? tts.profiles : {}) };
    if (tts.rate) own.rate = tts.rate;
    let keys = 0;
    for (const id of Object.keys(TTS_PROVIDERS)) {
      const secret = getSecret(this.app, `qiaomu-reader-tts-${id.toLowerCase()}`);
      if (secret && !getSecret(this.app, ttsSecretId(id))) { try { setSecret(this.app, ttsSecretId(id), secret); keys++; } catch { /* Keep importing others. */ } }
    }
    this.settings = normalizeSettings(this.settings, Platform.isDesktopApp);
    await this.saveSettings();
    this.speech.controller.cache.clear(); this.reading.restartWithSettings();
    return keys;
  }
}
