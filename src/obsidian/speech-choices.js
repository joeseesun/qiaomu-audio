import { Modal, Notice, Platform, Setting } from 'obsidian';
import { TTS_MODELS, changeSpeechModel, modelKey, uniqueChoices, canLoadVoiceCatalog } from '../core/tts/choices.js';
import { LOCAL_MODELS, normalizeLocalProfile } from '../runtime/local.js';
import { t } from '../i18n.js';
import { TTS_PROVIDERS } from '../core/tts/providers.js';
import { hiddenProvider } from '../speech.js';
import { iconButton } from './ui.js';

// Shared by Audio and RSS. Based on Reader's SpeechChoices: scope voices by model,
// load native voices immediately, fence late catalogs, and preserve reading while auditioning.
export class SpeechChoices {
  constructor(parent, { host, tx, chinese = false, onChange, errorText, onSettings }) {
    Object.assign(this, { parent, host, tx, chinese, onChange, errorText, onSettings });
    this.render();
    if (host.settings.tts.provider === 'system' && window.speechSynthesis?.addEventListener) {
      this.voicesChanged = () => this.render(); window.speechSynthesis.addEventListener('voiceschanged', this.voicesChanged);
    }
  }
  options() { return { chinese: this.chinese, tx: this.tx }; }
  async update(key, value) {
    this.host.speech.stopPreview();
    const { host } = this, profile = host.speech.profile(), id = profile.id;
    let next = key === modelKey(profile) && id !== 'localModel' ? changeSpeechModel(profile, value, host.voiceCatalogs[id]) : { ...profile, [key]: value };
    if (id === 'localModel') next = normalizeLocalProfile(key === 'model' ? { ...next, voice: '' } : next);
    const { id: _id, label: _label, key: _key, ...saved } = next;
    host.settings.tts.profiles[id] = saved;
    await this.onChange(key); if (!this.disposed) this.render();
  }
  async provider(id) {
    this.abort?.abort(); this.host.speech.stopPreview(); this.host.speech.controller.pause();
    this.host.settings.tts.provider = id; this.nativeAttempted = false; this.message = '';
    await this.onChange('provider'); if (!this.disposed) this.render();
  }
  field(name, key, values, custom, parent = this.parent) {
    const value = this.host.speech.profile()[key] || '', choices = uniqueChoices(values);
    if (!choices.some(choice => choice.id === value)) choices.unshift({ id: value, label: value || this.tx(custom ? 'custom' : 'automatic') });
    const row = new Setting(parent).setName(name);
    row.addDropdown(drop => {
      drop.selectEl.dataset.speechField = key;
      for (const choice of choices) drop.addOption(choice.id, choice.label); if (custom) drop.addOption('__custom__', this.tx('custom'));
      drop.setValue(value).onChange(async next => {
        if (next === '__custom__') {
          if (row.settingEl.querySelector('input')) { row.settingEl.querySelector('input').focus(); return; }
          row.addText(text => { text.inputEl.setAttribute('aria-labelledby', row.nameEl.id); text.setValue(value); text.inputEl.addEventListener('change', () => { void this.update(key, text.getValue().trim()); }); text.inputEl.focus(); });
        } else await this.update(key, next);
      });
    });
    row.nameEl.id = `qiaomu-speech-field-${crypto.randomUUID()}`;
    for (const input of row.settingEl.querySelectorAll('select,input')) { input.removeAttribute('aria-label'); input.removeAttribute('title'); input.setAttribute('aria-labelledby', row.nameEl.id); }
    return row;
  }
  render() {
    if (this.disposed) return;
    const { host, tx } = this, profile = host.speech.profile(), id = profile.id;
    this.parent.empty(); this.parent.addClass('qaudio-choices');
    const catalog = host.voiceCatalogs[id] || {};
    if (id === 'localModel') this.field(tx('model'), 'model', LOCAL_MODELS.map(model => ({ id: model.id, label: model.label })), false);
    else if (TTS_MODELS[id]) this.field(tx(id === 'doubao' ? 'resource' : 'model'), modelKey(profile), [...TTS_MODELS[id], ...(catalog.models || [])], true);
    const voices = host.speech.choices(profile, this.options());
    const voice = this.field(tx('voice'), 'voice', voices, !['macos', 'system', 'localModel'].includes(id));
    voice.addButton(button => button.setButtonText(tx('picker')).setDisabled(id === 'macos' && !catalog.voices).onClick(() => { this.modal?.close(); this.modal = new VoicePicker(this); this.modal.open(); }));
    if (id === 'system' && Platform.isDesktopApp && Platform.isMacOS) voice.setDesc(tx('macHelp'));
    if (id === 'macos' && catalog.voices && profile.voice && !catalog.voices.some(v => v.id === profile.voice)) voice.setDesc(tx('unavailable'));
    this.modal?.refreshVoices?.();
    if (canLoadVoiceCatalog(id) || id === 'macos') {
      const refresh = new Setting(this.parent).setName(tx('refresh'));
      const feedback = refresh.descEl.createSpan({ text: this.message || '', attr: { role: 'status' } });
      refresh.addButton(button => button.setButtonText(tx('refresh')).onClick(() => { void this.load(button, feedback); }));
      if (id === 'macos' && !catalog.voices && !this.nativeAttempted) { this.nativeAttempted = true; void this.load(null, feedback); }
    }
  }
  async load(button, feedback) {
    this.abort?.abort(); const abort = this.abort = new AbortController();
    const profile = this.host.speech.profile(), identity = JSON.stringify([profile.id, profile.baseUrl, profile.region, profile.key]);
    button?.setDisabled(true); feedback?.setText(this.tx('loading'));
    try {
      const catalog = await this.host.speech.loadChoices(profile, { ...this.options(), signal: abort.signal });
      const current = this.host.speech.profile();
      if (abort.signal.aborted || this.disposed || identity !== JSON.stringify([current.id, current.baseUrl, current.region, current.key])) return;
      this.host.voiceCatalogs[profile.id] = catalog;
      // Keep the old property for Audio integrations; it is always this same native list.
      if (profile.id === 'macos') this.host.macVoices = catalog.voices;
      this.message = this.tx(catalog.more ? 'partial' : 'loaded'); this.render();
    } catch (error) {
      if (!abort.signal.aborted && !this.disposed) { this.message = this.errorText(error); feedback?.setText(this.message); button?.setDisabled(false); }
    }
  }
  destroy() { this.disposed = true; this.abort?.abort(); this.modal?.close(); if (this.voicesChanged) window.speechSynthesis.removeEventListener('voiceschanged', this.voicesChanged); }
}
class VoicePicker extends Modal {
  constructor(choices) { super(choices.host.app); this.choices = choices; this.previewOwner = {}; }
  onOpen() {
    const { tx, host } = this.choices; this.setTitle(tx('picker')); this.contentEl.addClass('qaudio-modal', 'qaudio-voice-picker');
    this.services = this.contentEl.createDiv('qaudio-voice-services'); this.models = this.contentEl.createDiv('qaudio-voice-models');
    const search = this.contentEl.createEl('label', { cls: 'qaudio-voice-search' }); search.createSpan({ cls: 'qaudio-sr', text: tx('search') });
    const input = search.createEl('input', { type: 'search', attr: { placeholder: tx('search') } });
    this.list = this.contentEl.createDiv('qaudio-voice-list');
    const status = this.contentEl.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    const render = () => {
      const profile = host.speech.profile(), id = profile.id; this.services.empty(); this.models.empty();
      const service = new Setting(this.services).setName(tx('service')).addDropdown(drop => {
        drop.selectEl.dataset.speechField = 'provider';
        for (const [provider, data] of Object.entries(TTS_PROVIDERS)) if (!hiddenProvider(provider, id)) drop.addOption(provider, ['system','macos','localModel'].includes(provider) ? tx(provider) : data.label);
        drop.setValue(id).onChange(provider => { void this.choices.provider(provider); });
      });
      service.nameEl.id = `qiaomu-speech-service-${crypto.randomUUID()}`; service.controlEl.querySelector('select').setAttribute('aria-labelledby', service.nameEl.id);
      const problem = host.speech.configurationError(profile); if (problem) service.setDesc(this.choices.errorText(problem));
      if (id === 'localModel') this.choices.field(tx('model'), 'model', LOCAL_MODELS.map(model => ({ id: model.id, label: model.label })), false, this.models);
      else if (TTS_MODELS[id]) this.choices.field(tx(id === 'doubao' ? 'resource' : 'model'), modelKey(profile), [...TTS_MODELS[id], ...(host.voiceCatalogs[id]?.models || [])], true, this.models);
      const voices = host.speech.choices(host.speech.profile(), this.choices.options());
      this.list.empty(); const query = input.value.toLocaleLowerCase().trim(), selected = host.speech.profile().voice;
      const filtered = voices.filter(voice => `${voice.label} ${voice.id}`.toLocaleLowerCase().includes(query));
      for (const voice of filtered) {
        const row = this.list.createDiv('qaudio-voice-row');
        const choose = iconButton(row, voice.id === selected ? 'check' : 'audio-lines', voice.label, async () => { await this.choices.update('voice', voice.id); if (this.contentEl.isConnected) render(); }, { text: true });
        choose.setAttribute('aria-pressed', String(voice.id === selected));
        iconButton(row, 'volume-2', `${tx('preview')} ${voice.label}`, () => {
          if (host.speech.controller.owner === this.previewOwner && this.previewVoice === voice.id && host.speech.controller.state !== 'ended') { host.speech.stopPreview(this.previewOwner); status.setText(''); return; }
          try { const next = { ...host.speech.profile(), voice: voice.id }; const problem = host.speech.configurationError(next); if (problem) { status.setText(this.choices.errorText(problem)); return; } this.previewVoice = voice.id; host.speech.startPreview(this.previewOwner, tx('sample'), next); }
          catch (error) { new Notice(this.choices.errorText(error)); }
        });
      }
      if (!filtered.length) this.list.createEl('p', { text: tx('empty') });
    };
    if (this.choices.onSettings) new Setting(this.contentEl).addButton(button => button.setButtonText(tx('settings')).onClick(() => { this.close(); this.choices.onSettings(); }));
    this.refreshVoices = render; input.addEventListener('input', render); render(); input.focus();
    this.unsubscribe = host.speech.subscribe(c => { if (c.owner === this.previewOwner) status.setText(c.state === 'error' ? this.choices.errorText(c.error) : tx(c.state === 'ended' ? 'verified' : c.state === 'paused' ? 'paused' : 'loading')); });
  }
  onClose() { this.unsubscribe?.(); this.choices.host.speech.stopPreview(this.previewOwner); this.contentEl.empty(); this.onClosed?.(); }
}

export function audioSpeechChoiceText(key) {
  return t(({ service: 'settings.service', system: 'tts.provider.system', macos: 'tts.provider.macos', localModel: 'tts.provider.localModel', settings: 'player.settings', automatic: 'tts.systemVoice', model: 'settings.model', resource: 'settings.resourceId', voice: 'settings.voice', picker: 'tts.voicePicker', search: 'tts.voiceSearch', custom: 'settings.custom', refresh: 'settings.refreshVoices', loading: 'state.loading', loaded: 'settings.catalogReady', partial: 'settings.catalogPartial', preview: 'settings.preview', sample: 'tts.sample', empty: 'tts.noVoices', verified: 'state.verified', paused: 'state.paused', macHelp: 'tts.macSystemHelp', unavailable: 'tts.unavailableVoice', recommended: 'tts.recommended', voicePremium: 'tts.voicePremium', voiceEnhanced: 'tts.voiceEnhanced', voiceDisplayName: 'tts.voiceDisplayName' })[key] || key);
}
export function openVoicePicker(host, options) {
  const panel = host.app.workspace.containerEl.ownerDocument.createElement('div');
  const choices = new SpeechChoices(panel, { host, ...options });
  const modal = new VoicePicker(choices); choices.modal = modal;
  modal.onClosed = () => { choices.modal = null; choices.destroy(); };
  modal.open(); return modal;
}
