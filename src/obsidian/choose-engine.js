import { Modal, Platform } from 'obsidian';
import { ASR_MODELS, LOCAL_ASR_MODEL } from '../runtime/local.js';
import { t } from '../i18n.js';
import { LocalModelPanel } from './local-panel.js';
import { iconButton } from './ui.js';

// First dictation: one decision, two clear options. Local download starts here, with real progress.
export class ChooseEngineModal extends Modal {
  constructor(plugin, onReady) { super(plugin.app); this.plugin = plugin; this.onReady = onReady; }
  onOpen() {
    const { contentEl, plugin } = this;
    this.setTitle(t('choose.title'));
    contentEl.addClass('qaudio-choose');
    if (Platform.isDesktopApp) {
      const local = contentEl.createDiv('qaudio-option');
      local.createDiv({ cls: 'qaudio-option-title', text: t('choose.local') });
      const size = Math.ceil((ASR_MODELS.find(m => m.id === LOCAL_ASR_MODEL)?.bytes || 0) / 1024 ** 2);
      local.createDiv({ cls: 'qaudio-muted', text: t('choose.localDesc', { size }) });
      this.panel = new LocalModelPanel(local.createDiv(), { manager: plugin.local(), model: LOCAL_ASR_MODEL, details: false, onReady: async () => {
        plugin.settings.asr.engine = 'local'; await plugin.saveSettings();
        this.ready = true; this.close();
      } });
    }
    const cloud = contentEl.createDiv('qaudio-option');
    cloud.createDiv({ cls: 'qaudio-option-title', text: t('choose.cloud') });
    cloud.createDiv({ cls: 'qaudio-muted', text: t('choose.cloudDesc') });
    iconButton(cloud.createDiv('qaudio-actions'), 'settings', t('choose.setup'), () => { this.close(); plugin.openSettings('asr'); }, { text: true });
    // An already-installed local model needs only one click.
    if (Platform.isDesktopApp) void plugin.local().status(LOCAL_ASR_MODEL).then(state => {
      if (state.phase === 'ready' && this.panel && !this.ready) {
        plugin.settings.asr.engine = 'local'; void plugin.saveSettings().then(() => { this.ready = true; this.close(); });
      }
    }).catch(() => {});
  }
  onClose() { this.panel?.destroy(); this.contentEl.empty(); if (this.ready) void this.onReady?.(); }
}
