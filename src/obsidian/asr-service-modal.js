import { Modal, Notice, Setting } from 'obsidian';
import { ASR_PROVIDERS, MAX_PROFILES, PROTOCOLS, cloudConfig, isLocalUrl, newProfile, providerOf, withProvider } from '../core/asr/providers.js';
import { asrSecretId, getSecret, setSecret } from '../settings.js';
import { errorText, t } from '../i18n.js';

// Nothing is persisted until the user confirms. Escape, close and Cancel discard the draft.
export class AsrServiceModal extends Modal {
  constructor(tab) { super(tab.app); this.tab = tab; this.draftKeys = new Map(); }
  onOpen() { this.setTitle(t('asr.addTitle')); this.contentEl.addClass('qaudio-modal', 'qaudio-asr-service'); this.render(); }
  onClose() { this.closed = true; this.draftKeys.clear(); this.profile = null; this.contentEl.empty(); }
  render() {
    const root = this.contentEl; root.empty();
    root.createEl('p', { text: t('asr.addHelp'), cls: 'qaudio-setting-note' });
    new Setting(root).setName(t('asr.provider')).addDropdown(drop => {
      drop.addOption('', t('asr.chooseProvider'));
      for (const info of ASR_PROVIDERS) drop.addOption(info.id, info.label.startsWith('asr.') ? t(info.label) : info.label);
      drop.setValue(this.profile?.provider || '').onChange(id => { this.profile = id ? (this.profile ? withProvider(this.profile, id) : newProfile(id)) : null; this.render(); });
    });
    if (this.profile) {
      const profile = this.profile, info = providerOf(profile.provider);
      if (!isLocalUrl(profile.baseUrl) || profile.provider === 'custom') {
        let input;
        const key = new Setting(root).setName(t('settings.key')).addText(text => {
          input = text.inputEl; input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false;
          text.setPlaceholder(t('settings.keyPlaceholder')).setValue(this.draftKeys.get(profile.provider) || '');
          input.addEventListener('input', () => { this.draftKeys.set(profile.provider, text.getValue().trim()); this.feedback?.setText(''); });
        });
        key.addButton(button => button.setButtonText(t('settings.showKey')).onClick(() => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; button.setButtonText(t(show ? 'settings.hideKey' : 'settings.showKey')); }));
        this.tab.serviceLinks(key, 'asr', profile.provider);
      }
      if (['custom', 'local'].includes(profile.provider)) this.tab.urlField(root, profile, value => { profile.baseUrl = value; });
      this.tab.choice(root, t('settings.model'), info.models.map(id => ({ id, label: id })), profile.model, value => { profile.model = value; });
      if (info.note) root.createDiv({ text: t(info.note), cls: 'qaudio-setting-note' });
      const advanced = this.tab.advanced(root);
      if (!['custom', 'local'].includes(profile.provider)) this.tab.urlField(advanced, profile, value => { profile.baseUrl = value; });
      if (profile.provider === 'custom') new Setting(advanced).setName(t('settings.protocol')).addDropdown(drop => { for (const value of PROTOCOLS) drop.addOption(value, value); drop.setValue(profile.protocol).onChange(value => { profile.protocol = value; }); });
      new Setting(advanced).setName(t('asr.name')).addText(text => { text.setValue(profile.name || ''); text.inputEl.addEventListener('input', () => { profile.name = text.getValue().trim(); }); });
    }
    this.feedback = root.createDiv({ cls: 'qaudio-status-line', attr: { role: 'status', 'aria-live': 'polite' } });
    const footer = new Setting(root);
    footer.settingEl.addClass('qaudio-modal-footer');
    footer.addButton(button => button.setButtonText(t('settings.cancel')).onClick(() => this.close()));
    footer.addButton(button => button.setButtonText(t('asr.addConfirm')).setCta().setDisabled(!this.profile).onClick(() => { void this.confirm(button); }));
    this.tab.labelInputs(root);
  }
  async confirm(button) {
    const profile = this.profile; if (!profile || this.saving || this.closed) return;
    const settings = this.tab.plugin.settings.asr, key = this.draftKeys.get(profile.provider) || '';
    try { const config = cloudConfig(profile); if (!config.local && !key) throw { code: 'key' }; }
    catch (error) { this.feedback.setText(errorText(error)); this.tab.focusProblem(this.contentEl, error); return; }
    // Same endpoint/model/account is one configuration, even if its visible name differs.
    const existing = settings.profiles.find(p => p.provider === profile.provider && p.baseUrl.replace(/\/+$/, '') === profile.baseUrl.replace(/\/+$/, '') && p.model === profile.model && p.protocol === profile.protocol && getSecret(this.app, asrSecretId(p.id, p.provider)) === key);
    if (!existing && settings.profiles.length >= MAX_PROFILES) { this.feedback.setText(t('asr.profileLimit')); return; }
    this.saving = true; button.setDisabled(true);
    const previousEngine = settings.engine, previousProfiles = settings.profiles;
    const secretId = asrSecretId(profile.id, profile.provider);
    try {
      if (!existing) { if (key) setSecret(this.app, secretId, key); settings.profiles = [...settings.profiles, profile]; }
      settings.engine = `cloud:${(existing || profile).id}`;
      await this.tab.save(); this.close(); this.tab.refresh();
      if (existing) new Notice(t('asr.alreadyAdded'));
    } catch {
      settings.engine = previousEngine; settings.profiles = previousProfiles;
      if (!existing && key) { try { setSecret(this.app, secretId, ''); } catch { /* Rollback is best-effort when SecretStorage fails. */ } }
      if (!this.closed) { this.feedback.setText(t('settings.saveError')); button.setDisabled(false); }
    } finally { this.saving = false; }
  }
}
