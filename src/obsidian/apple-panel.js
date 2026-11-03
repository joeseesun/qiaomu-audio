import { Setting } from 'obsidian';
import { errorText, t } from '../i18n.js';

export function applePanel(root, plugin, onReady) {
  const note = root.createDiv({ cls: 'qaudio-setting-note', text: t('asr.appleHelp') });
  const feedback = root.createDiv({ cls: 'qaudio-status-line', attr: { role: 'status', 'aria-live': 'polite' } });
  const actions = new Setting(root);
  const abort = new AbortController();
  let busy = false;
  const check = async (button, prepare) => {
    if (busy) return;
    busy = true; button.setDisabled(true); feedback.setText(t(prepare ? 'asr.applePreparing' : 'dictation.preparing'));
    try {
      if (prepare) await plugin.apple().prepare(plugin.settings.asr.language, abort.signal);
      else await plugin.apple().status(plugin.settings.asr.language);
      if (!root.isConnected || abort.signal.aborted) return;
      feedback.setText(t('asr.appleReady'));
      await onReady?.();
    } catch (error) { if (!abort.signal.aborted && root.isConnected) feedback.setText(errorText(error)); }
    finally { busy = false; button.setDisabled(false); }
  };
  actions.addButton(button => button.setButtonText(t('asr.appleCheck')).onClick(() => { void check(button, false); }));
  actions.addButton(button => button.setButtonText(t('asr.applePrepare')).onClick(() => { void check(button, true); }));
  const help = note.createEl('a', { text: t('asr.appleInstall'), href: 'https://github.com/joeseesun/qiaomu-audio/blob/main/docs/apple-speech.md' });
  help.setAttribute('target', '_blank'); help.setAttribute('rel', 'noopener');
  return { destroy: () => abort.abort() };
}
