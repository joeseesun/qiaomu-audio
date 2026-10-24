import { Notice, Platform, PluginSettingTab, Setting, setIcon } from 'obsidian';
import { TTS_PROVIDERS } from '../core/tts/providers.js';
import { cloudService } from '../core/cloud-services.js';
import { uniqueChoices } from '../core/tts/choices.js';
import { ASR_LANGUAGES, ASR_PROVIDERS, MAX_PROFILES, PROTOCOLS, cloudConfig, isLocalUrl, providerOf, withProvider } from '../core/asr/providers.js';
import { LOCAL_ASR_MODEL } from '../runtime/local.js';
import { currentLanguage, errorText, t } from '../i18n.js';
import { asrSecretId, getSecret, setSecret, ttsSecretId } from '../settings.js';
import { providerLabel } from '../speech.js';
import { openVoicePicker, audioSpeechChoiceText } from './speech-choices.js';
import { AsrServiceModal } from './asr-service-modal.js';
import { LocalModelPanel } from './local-panel.js';
import { findSpeechSettings, copySpeechSettings } from '../shared/configuration.js';
import { MAX_ACCOUNTS, PLATFORMS } from '../core/share/brand.js';
import { ImageSuggest } from './image-suggest.js';
import { iconButton } from './ui.js';
import { pickFolder } from './export-folder.js';

const CUSTOM = '__custom__';
const ADD = '__add__';
let fieldSequence = 0;

export class AudioSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.previewOwner = {}; this.panels = []; }
  // Obsidian 1.13+ renders this definition (and indexes it for settings search); older hosts call display().
  getSettingDefinitions() {
    return [{
      name: t('settings.title'), desc: t('settings.titleDesc'), searchable: true,
      aliases: ['TTS', 'read aloud', 'dictation', 'speech to text', '朗读', '听写', '语音转文字', '转写'],
      render: setting => { this.root = setting.settingEl; this.root.addClass('qaudio-settings-definition'); this.root.parentElement?.addClass('qaudio-settings-group'); this.renderAll(this.root); },
    }];
  }
  display() { this.root = null; this.renderAll(this.containerEl); }
  refresh() {
    if (this.root?.isConnected) this.renderAll(this.root); else this.display();
  }
  renderAll(root) {
    this.cleanup(); root.empty(); root.addClass('qaudio-settings');
    if (this.focusSection === 'asr') { this.tab = 'dictation'; this.focusSection = null; }
    if (this.focusSection === 'share') { this.tab = 'share'; this.focusSection = null; }
    const tab = this.tab || 'read';
    const header = root.createDiv('qaudio-settings-header');
    const identity = header.createDiv('qaudio-settings-identity');
    setIcon(identity.createSpan({ cls: 'qaudio-settings-mark', attr: { 'aria-hidden': 'true' } }), 'audio-lines');
    new Setting(identity).setName(t('settings.title')).setHeading();
    const tabs = header.createDiv({ cls: 'qaudio-tabs', attr: { role: 'tablist' } });
    const sections = [['read', 'volume-2', t('settings.read')], ['dictation', 'mic', t('settings.dictation')], ['share', 'share-2', t('settings.share')], ['about', 'heart', t('settings.about')]];
    const select = id => { this.tab = id; this.refresh(); root.querySelector('[role=tab][aria-selected=true]')?.focus(); };
    sections.forEach(([id, icon, label], index) => {
      const selected = id === tab;
      const button = tabs.createEl('button', { cls: 'qaudio-tab', attr: { type: 'button', role: 'tab', 'aria-selected': String(selected), tabindex: selected ? '0' : '-1' } });
      button.toggleClass('is-active', selected);
      setIcon(button.createSpan({ cls: 'qaudio-icon', attr: { 'aria-hidden': 'true' } }), icon);
      button.createSpan({ text: label });
      button.addEventListener('click', () => select(id));
      button.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        select(sections[(index + (event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length][0]);
      });
    });
    const body = root.createDiv({ cls: 'qaudio-settings-body', attr: { role: 'tabpanel' } });
    if (tab === 'read') this.renderSpeech(body);
    if (tab === 'dictation') this.renderDictation(body);
    if (tab === 'share') this.renderShare(body);
    if (tab === 'about') this.renderAbout(body);
    this.labelInputs(root);
  }
  // A titled group whose rows sit inside one quiet card.
  section(host, title, desc) {
    const el = host.createDiv('qaudio-section');
    if (title) this.heading(el, title, desc);
    return el.createDiv('qaudio-card');
  }
  heading(host, title, desc) {
    const head = new Setting(host).setName(title).setHeading();
    if (desc) head.setDesc(desc);
    head.settingEl.addClass('qaudio-section-head');
  }
  advanced(host) {
    const details = host.createEl('details', { cls: 'qaudio-details qaudio-advanced' });
    const summary = details.createEl('summary');
    summary.createSpan({ text: t('settings.advanced') });
    setIcon(summary.createSpan({ cls: 'qaudio-icon qaudio-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
    return details.createDiv('qaudio-card');
  }
  hide() { this.asrModal?.close(); this.cleanup(); }
  cleanup() {
    const dialog = this.soundDialog; this.soundDialog = null; if (dialog && !dialog.closed) { dialog.adapter.closed = null; dialog.close(); }
    this.unsubscribe?.(); this.unsubscribe = null;
    this.removeVoicesListener?.(); this.removeVoicesListener = null;
    this.asrTestAbort?.abort(); this.asrTestAbort = null;
    this.plugin.speech.stopPreview(this.previewOwner);
    for (const panel of this.panels) panel.destroy(); this.panels = [];
  }
  async save() {
    try { await this.plugin.saveSettings(); }
    catch (error) { new Notice(t('settings.saveError')); throw error; }
  }
  labelInputs(root) {
    for (const row of root.querySelectorAll('.setting-item')) {
      const name = row.querySelector('.setting-item-name');
      if (!name) continue;
      name.id ||= `qaudio-field-${++fieldSequence}`;
      for (const input of row.querySelectorAll('input, select')) {
        input.removeAttribute('aria-label'); input.removeAttribute('title');
        input.setAttribute('aria-labelledby', name.id);
      }
    }
  }
  serviceLinks(setting, kind, id) {
    const info = cloudService(kind, id);
    if (!info) { setting.setDesc(t('settings.customKeyHelp')); return; }
    setting.setDesc(createFragment(f => {
      f.createEl('a', { text: t('settings.keyGet'), href: info.keyHelp, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      if (info.docs) {
        f.appendText(' · ');
        f.createEl('a', { text: t('settings.serviceDocs'), href: info.docs, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      }
    }));
  }
  urlField(host, profile, onChange) {
    return new Setting(host).setName(t('settings.url')).setDesc(t('settings.urlHelp')).addText(text => {
      text.setPlaceholder(t('settings.urlPlaceholder')).setValue(profile.baseUrl || '').inputEl.spellcheck = false;
      text.inputEl.addEventListener('change', () => onChange(text.getValue().trim()));
    });
  }
  focusProblem(root, problem) {
    const name = t(problem.code === 'key' ? 'settings.key' : problem.code === 'region' ? 'settings.region' : ['url', 'https'].includes(problem.code) ? 'settings.url' : 'settings.model');
    const row = [...root.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === name);
    const details = row?.closest('details'); if (details) details.open = true;
    row?.querySelector('input, select')?.focus();
  }

  // A dropdown with optional "Custom…" that reveals a text field.
  choice(host, name, values, current, onChange, { custom = true, desc } = {}) {
    values = uniqueChoices(values);
    if (current && !values.some(v => v.id === current) && !custom) values.push({ id: current, label: current });
    const known = values.some(v => v.id === current);
    const setting = new Setting(host).setName(name);
    if (desc) setting.setDesc(desc);
    let input;
    setting.addDropdown(drop => {
      for (const v of values) drop.addOption(v.id, v.label);
      if (custom) drop.addOption(CUSTOM, t('settings.custom'));
      drop.setValue(known ? current : custom ? CUSTOM : (values[0]?.id ?? ''));
      drop.onChange(value => {
        if (value === CUSTOM) { input.inputEl.toggleClass('qaudio-hidden', false); input.inputEl.focus(); return; }
        input && (input.inputEl.toggleClass('qaudio-hidden', true)); onChange(value);
      });
    });
    if (custom) setting.addText(text => {
      input = text; text.inputEl.toggleClass('qaudio-hidden', known); text.inputEl.spellcheck = false;
      text.setPlaceholder(t('settings.customValue')).setValue(known ? '' : current || '');
      text.inputEl.addEventListener('change', () => { const value = text.getValue().trim(); if (value) onChange(value); });
    });
    return setting;
  }
  secret(host, id, onSaved, onEditing) {
    let field;
    const setting = new Setting(host).setName(t('settings.key')).addText(text => {
      field = text.inputEl;
      text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false;
      text.setPlaceholder(t('settings.keyPlaceholder')).setValue(getSecret(this.app, id));
      text.inputEl.addEventListener('input', () => onEditing?.());
      text.inputEl.addEventListener('change', () => {
        try { setSecret(this.app, id, text.getValue()); text.setValue(getSecret(this.app, id)); onSaved?.(); }
        catch { new Notice(t('settings.keySaveError')); }
      });
    });
    setting.addButton(b => b.setButtonText(t('settings.showKey')).onClick(() => {
      const show = field.type === 'password'; field.type = show ? 'text' : 'password';
      b.setButtonText(t(show ? 'settings.hideKey' : 'settings.showKey'));
    }));
    return setting;
  }

  renderSpeech(body) {
    const plugin = this.plugin, speech = plugin.speech, settings = plugin.settings.tts, id = settings.provider;
    const profile = speech.profile();
    const host = this.section(body, t('settings.voiceSection'), t('settings.voiceSectionDesc'));
    const summary = new Setting(host).setName(providerLabel(t, id, TTS_PROVIDERS[id].label)).setDesc(plugin.reading.voiceLabel());
    summary.addButton(button => button.setButtonText(t('player.sound')).onClick(() => {
      this.soundDialog?.close();
      this.soundDialog = openVoicePicker(plugin, { tx: audioSpeechChoiceText, chinese: currentLanguage() === 'zh', errorText: error => errorText(error, speech.profile().id), onClosed: () => { if (body.isConnected) this.refresh(); } });
    }));
    const problem = speech.configurationError(profile);
    if (problem) host.createDiv({ cls: 'qaudio-feedback', text: errorText(problem, id) });
    void findSpeechSettings(plugin.app, 'qiaomu-ai-rss').then(found => {
      if (!found || !body.isConnected) return;
      new Setting(this.section(body)).setName(t('settings.importRss')).setDesc(t('settings.importRssDesc'))
        .addButton(b => b.setButtonText(t('settings.import')).onClick(async () => { const keys = await copySpeechSettings(plugin, 'qiaomu-ai-rss'); new Notice(keys < 0 ? t('settings.importNone') : t('settings.imported', { keys })); this.refresh(); }));
    });
    void plugin.readerSpeechSettings().then(found => {
      if (!found || !body.isConnected) return;
      new Setting(this.section(body)).setName(t('settings.importReader')).setDesc(t('settings.importReaderDesc'))
        .addButton(b => b.setButtonText(t('settings.import')).onClick(async () => {
          const keys = await plugin.importReaderSpeech();
          new Notice(keys < 0 ? t('settings.importNone') : t('settings.imported', { keys }));
          this.refresh();
        }));
    });
  }

  // Signature used on exported videos: name, avatar and where to follow. Everything is optional.
  renderShare(body) {
    const plugin = this.plugin, share = plugin.settings.share;
    const commit = async (render = false) => { await this.save(); if (render) this.refresh(); };
    const identity = this.section(body, t('settings.shareSection'), t('settings.shareSectionDesc'));
    new Setting(identity).setName(t('settings.shareName')).addText(text => {
      text.setPlaceholder(t('settings.shareNamePlaceholder')).setValue(share.name); text.inputEl.maxLength = 40;
      text.inputEl.addEventListener('change', () => { share.name = text.getValue().trim(); void commit(); });
    });
    const image = (name, desc, key) => {
      const row = new Setting(identity).setName(name).setDesc(share[key] || desc);
      row.addButton(b => b.setButtonText(t('settings.shareChoose')).onClick(() => new ImageSuggest(plugin.app, t('settings.shareChoose'), path => { share[key] = path; void commit(true); }).open()));
      if (share[key]) row.addButton(b => b.setButtonText(t('settings.shareClear')).onClick(() => { share[key] = ''; void commit(true); }));
    };
    image(t('settings.shareAvatar'), t('settings.shareAvatarDesc'), 'avatar');
    image(t('settings.shareBackground'), t('settings.shareBackgroundDesc'), 'background');

    if (Platform.isDesktopApp) {
      const place = this.section(body, t('settings.shareFolderSection'), t('settings.shareFolderSectionDesc'));
      const row = new Setting(place).setName(t('settings.shareFolder'));
      let input;
      row.addText(text => {
        input = text; text.setPlaceholder(t('settings.shareFolderPlaceholder')).setValue(share.folder); text.inputEl.spellcheck = false;
        text.inputEl.addEventListener('change', () => { share.folder = text.getValue().trim(); void commit(true); });
      });
      row.addButton(b => b.setButtonText(t('settings.shareChoose')).onClick(async () => {
        const chosen = await pickFolder(plugin.app.workspace.containerEl.ownerDocument);
        if (chosen) { share.folder = chosen; void commit(true); } else { new Notice(t('settings.shareFolderTypeIt')); input.inputEl.focus(); }
      }));
      if (share.folder) row.addButton(b => b.setButtonText(t('settings.shareFolderReset')).onClick(() => { share.folder = ''; void commit(true); }));
      row.setDesc(share.folder ? t('settings.shareFolderOutside') : t('settings.shareFolderVault'));
    }

    const accounts = this.section(body, t('settings.shareAccounts'), t('settings.shareAccountsDesc'));
    share.accounts.forEach((account, index) => {
      const row = new Setting(accounts).setName(t('settings.shareAccount', { number: index + 1 }));
      row.addDropdown(drop => {
        for (const kind of Object.keys(PLATFORMS)) drop.addOption(kind, t(`share.platform.${kind}`));
        drop.setValue(account.kind).onChange(value => { account.kind = value; void commit(true); });
      });
      if (account.kind === 'custom') row.addText(text => { text.setPlaceholder(t('settings.shareAccountLabel')).setValue(account.label); text.inputEl.maxLength = 20; text.inputEl.addEventListener('change', () => { account.label = text.getValue().trim(); void commit(); }); });
      row.addText(text => { text.setPlaceholder(t('settings.shareAccountHandle')).setValue(account.handle); text.inputEl.maxLength = 80; text.inputEl.spellcheck = false; text.inputEl.addEventListener('change', () => { account.handle = text.getValue().trim(); void commit(); }); });
      iconButton(row.controlEl, 'trash-2', t('settings.shareRemoveAccount'), () => { share.accounts.splice(index, 1); void commit(true); });
    });
    if (share.accounts.length < MAX_ACCOUNTS) new Setting(accounts).addButton(b => b.setButtonText(t('settings.shareAddAccount')).onClick(() => { share.accounts.push({ kind: 'x', handle: '', label: '' }); void commit(true); }));
    if (!Platform.isDesktopApp) body.createEl('p', { cls: 'qaudio-share-hint', text: t('share.videoDesktop') });
  }

  renderDictation(body) {
    const plugin = this.plugin, settings = plugin.settings.asr, engine = settings.engine;
    const host = this.section(body, t('settings.engineSection'), t('settings.engineSectionDesc'));
    const label = p => p.name || `${providerOf(p.provider).label.startsWith('asr.') ? t(providerOf(p.provider).label) : providerOf(p.provider).label} · ${(p.model || '').split('/').pop()}`;
    new Setting(host).setName(t('asr.engine')).addDropdown(drop => {
      if (!engine) drop.addOption('', t('asr.engine.none'));
      if (Platform.isDesktopApp) drop.addOption('local', t('asr.engine.local'));
      const counts = new Map();
      for (const p of settings.profiles) { const name = label(p), count = (counts.get(name) || 0) + 1; counts.set(name, count); drop.addOption(`cloud:${p.id}`, count > 1 ? `${name} · ${count}` : name); }
      if (settings.profiles.length < MAX_PROFILES) drop.addOption(ADD, t('asr.engine.add'));
      drop.setValue(engine).onChange(async value => {
        if (value === ADD) { drop.setValue(engine); this.asrModal?.close(); this.asrModal = new AsrServiceModal(this); this.asrModal.open(); return; }
        settings.engine = value;
        await this.save(); this.refresh();
      });
    });
    if (engine === 'local') {
      host.createDiv({ cls: 'qaudio-setting-note', text: t('asr.localHelp') });
      this.panels.push(new LocalModelPanel(host.createDiv(), { manager: plugin.local(), model: LOCAL_ASR_MODEL }));
    }
    const profile = plugin.transcription.engine()?.profile;
    if (profile) this.renderCloudProfile(host, profile, body);
    const habits = this.section(body, t('settings.habitSection'), t('settings.habitSectionDesc'));
    new Setting(habits).setName(t('asr.mode')).setDesc(t('asr.modeHelp')).addDropdown(drop => {
      drop.addOption('batch', t('asr.mode.batch')).addOption('live', t('asr.mode.live'))
        .setValue(settings.mode).onChange(async value => { settings.mode = value; await this.save(); });
    });
    new Setting(habits).setName(t('asr.language')).addDropdown(drop => {
      for (const code of ASR_LANGUAGES) drop.addOption(code, t(`lang.${code}`));
      drop.setValue(settings.language).onChange(async value => { settings.language = value; await this.save(); });
    });
    new Setting(habits).setName(t('asr.keepAudio')).setDesc(t('asr.keepAudioHelp')).addToggle(toggle => {
      toggle.setValue(settings.keepAudio).onChange(async value => { settings.keepAudio = value; await this.save(); });
    });
  }
  renderCloudProfile(host, profile, body) {
    const plugin = this.plugin, settings = plugin.settings.asr, info = providerOf(profile.provider);
    const replace = async next => {
      this.asrTestAbort?.abort(); this.asrTestAbort = null;
      settings.profiles = settings.profiles.map(p => p.id === profile.id ? next : p);
      await this.save(); this.refresh();
    };
    const secretId = asrSecretId(profile.id, profile.provider);
    let resetTest = () => {};
    host.createDiv({ cls: 'qaudio-setting-note', text: t(isLocalUrl(profile.baseUrl) ? 'asr.localServiceHelp' : 'asr.cloudHelp') });
    new Setting(host).setName(t('asr.provider')).addDropdown(drop => {
      for (const p of ASR_PROVIDERS) drop.addOption(p.id, p.label.startsWith('asr.') ? t(p.label) : p.label);
      drop.setValue(profile.provider).onChange(value => replace(withProvider(profile, value)));
    });
    if (!isLocalUrl(profile.baseUrl) || profile.provider === 'custom') {
      const key = this.secret(host, secretId, () => resetTest(), () => resetTest());
      this.serviceLinks(key, 'asr', profile.provider);
    }
    if (['custom', 'local'].includes(profile.provider)) this.urlField(host, profile, value => replace({ ...profile, baseUrl: value }));
    this.choice(host, t('settings.model'), info.models.map(m => ({ id: m, label: m })), profile.model, value => replace({ ...profile, model: value }));
    if (info.note && profile.provider !== 'local') host.createDiv({ cls: 'qaudio-setting-note', text: t(info.note) });
    const test = new Setting(host).setName(t('asr.test')).setDesc(t(isLocalUrl(profile.baseUrl) ? 'asr.testLocalDesc' : 'asr.testDesc'));
    const status = test.descEl.createSpan({ cls: 'qaudio-status-line', attr: { role: 'status' } });
    let testButton;
    const problem = () => {
      try {
        const config = cloudConfig(profile);
        return !config.local && !getSecret(this.app, secretId) ? { code: 'key' } : null;
      } catch (error) { return error; }
    };
    resetTest = () => {
      this.asrTestAbort?.abort(); this.asrTestAbort = null;
      const error = problem(); status.setText(error ? errorText(error) : t('settings.unverified'));
      status.toggleClass('is-error', !!error); status.removeClass('is-ready');
      testButton?.setButtonText(t('asr.test'));
    };
    test.addButton(b => { testButton = b; b.setButtonText(t('asr.test')).setCta().onClick(async () => {
      if (this.asrTestAbort) { resetTest(); return; }
      const error = problem();
      if (error) { resetTest(); this.focusProblem(body, error); return; }
      const abort = new AbortController(); this.asrTestAbort = abort;
      b.setButtonText(t('settings.cancelTest')); status.setText(t('asr.testing')); status.removeClass('is-ready'); status.removeClass('is-error');
      const current = () => this.asrTestAbort === abort && !abort.signal.aborted && status.isConnected;
      try {
        await plugin.transcription.test(profile, abort.signal);
        if (current()) { status.setText(t('asr.testOk')); status.addClass('is-ready'); }
      } catch (error) {
        if (current()) { status.setText(errorText(error)); status.addClass('is-error'); }
      } finally {
        if (this.asrTestAbort === abort) { this.asrTestAbort = null; b.setButtonText(t('asr.test')); }
      }
    }); });
    resetTest();
    const advanced = this.advanced(body);
    if (!['custom', 'local'].includes(profile.provider)) this.urlField(advanced, profile, value => replace({ ...profile, baseUrl: value }));
    if (profile.provider === 'custom') new Setting(advanced).setName(t('settings.protocol')).addDropdown(drop => {
      for (const p of PROTOCOLS) drop.addOption(p, p);
      drop.setValue(profile.protocol).onChange(value => replace({ ...profile, protocol: value }));
    });
    if (profile.provider === 'local' && info.note) advanced.createDiv({ cls: 'qaudio-setting-note', text: t(info.note) });
    new Setting(advanced).setName(t('asr.name')).addText(text => {
      text.setValue(profile.name || '');
      text.inputEl.addEventListener('change', () => { const name = text.getValue().trim(); const { name: _old, ...rest } = profile; replace(name ? { ...rest, name } : rest); });
    });
    new Setting(advanced).setName(t('asr.remove')).addButton(b => b.setButtonText(t('asr.remove')).setWarning().onClick(async () => {
      settings.profiles = settings.profiles.filter(p => p.id !== profile.id);
      for (const id of ['', ...ASR_PROVIDERS.map(p => p.id)]) {
        try { setSecret(this.app, asrSecretId(profile.id, id), ''); } catch { /* An empty secret is harmless. */ }
      }
      settings.engine = settings.profiles[0] ? `cloud:${settings.profiles[0].id}` : Platform.isDesktopApp ? 'local' : '';
      await this.save(); this.refresh();
    }));
  }

  renderAbout(body) {
    const external = { target: '_blank', rel: 'noopener noreferrer' }, repo = 'https://github.com/joeseesun/qiaomu-audio';
    const hero = body.createDiv('qaudio-about-hero');
    const logo = hero.createDiv({ cls: 'qaudio-about-logo', attr: { 'aria-hidden': 'true' } });
    for (let i = 0; i < 5; i++) logo.createSpan();
    const intro = hero.createDiv('qaudio-about-intro');
    intro.createDiv({ cls: 'qaudio-about-name', text: t('settings.title') });
    intro.createDiv({ cls: 'qaudio-about-tagline', text: t('settings.tagline') });
    const release = hero.createDiv('qaudio-about-release');
    release.createSpan({ cls: 'qaudio-about-label', text: t('about.version') });
    release.createSpan({ cls: 'qaudio-about-version', text: `v${this.plugin.manifest.version}` });
    const actions = hero.createDiv('qaudio-about-actions');
    this.plugin.updateNotes.addButton(actions);
    for (const [icon, label, href] of [['message-circle', t('about.feedback'), `${repo}/issues/new`], ['book-open', t('about.guide'), `${repo}#readme`]]) {
      const link = actions.createEl('a', { cls: 'qaudio-about-action', href, attr: external });
      setIcon(link.createSpan({ cls: 'qaudio-icon', attr: { 'aria-hidden': 'true' } }), icon);
      link.createSpan({ text: label });
    }

    const support = body.createDiv('qaudio-section');
    this.heading(support, t('about.support'), t('about.supportDesc'));
    const grid = support.createDiv('qaudio-about-support');
    const qr = (icon, title, hint, src, alt) => {
      const card = grid.createEl('figure', { cls: 'qaudio-about-qr' });
      card.createDiv('qaudio-about-qr-image').createEl('img', { attr: { src, alt, loading: 'lazy', width: '148', height: '148' } });
      const caption = card.createEl('figcaption');
      const name = caption.createDiv('qaudio-about-qr-title');
      setIcon(name.createSpan({ cls: 'qaudio-icon', attr: { 'aria-hidden': 'true' } }), icon);
      name.createSpan({ text: title });
      caption.createDiv({ cls: 'qaudio-about-qr-hint', text: hint });
    };
    qr('newspaper', t('about.follow'), t('about.followHint'), 'https://radio.qiaomu.ai/assets/qiaomu_wechat_public_account_qr.jpg', t('about.followAlt'));
    qr('coffee', t('about.tip'), t('about.tipHint'), 'https://radio.qiaomu.ai/assets/qiaomu_reward_qr.png', t('about.tipAlt'));

    const footer = body.createDiv('qaudio-about-footer');
    const links = footer.createDiv('qaudio-about-links');
    for (const [label, href] of [['qiaomu.ai', 'https://qiaomu.ai/'], [t('about.blog'), 'https://blog.qiaomu.ai/'], ['X', 'https://x.com/vista8'], ['GitHub', 'https://github.com/joeseesun'], [t('about.email'), 'mailto:vista8@gmail.com']]) {
      links.createEl('a', { text: label, href, attr: external });
    }
    footer.createEl('p', { text: t('about.privacy') });
    footer.createEl('p', { text: t('about.license') });
  }
}
