import { Notice, Platform } from 'obsidian';
import { errorText, t } from '../i18n.js';
import { SAMPLE_RATE } from '../core/share/audio.js';
import { outroAccounts } from '../core/share/brand.js';
import { exportItems, exportScopes, mergeRanges } from '../core/share/scope.js';
import { fileBase, runExport } from '../core/share/export.js';
import { makeCanvas, videoSupported } from '../core/share/video.js';
import { splitSpeechText } from '../core/tts/text.js';
import { checkTtsSignal, ttsError } from '../core/tts/providers.js';
import { ShareModal } from './share-modal.js';
import { revealPath, saveToFolder } from './export-folder.js';

const FREE = ['edge', 'system', 'macos', 'localModel'];

// Exports a note, a selection or some sections as MP3 / MP4 with the voice chosen for reading aloud.
export class ShareManager {
  constructor(plugin) { this.plugin = plugin; }
  get speech() { return this.plugin.speech; }
  get app() { return this.plugin.app; }
  canMakeVideo() { return Platform.isDesktopApp && videoSupported(); }
  isPaid(profile = this.speech.profile()) { return !FREE.includes(profile.id); }

  open(view, preferred = 'auto') {
    if (!view?.file || !view.editor) { new Notice(t('notice.noNote')); return; }
    this.plugin.reading.stop();
    const editor = view.editor, source = editor.getValue();
    const selection = editor.somethingSelected() ? { from: editor.posToOffset(editor.getCursor('from')), to: editor.posToOffset(editor.getCursor('to')) } : null;
    const cursor = editor.posToOffset(editor.getCursor('from'));
    const scopes = exportScopes(source, { selection, cursor });
    if (preferred === 'note') scopes.sort((a, b) => (b.id === 'note') - (a.id === 'note'));
    new ShareModal(this, { view, source, scopes, cursor: editor.posToOffset(editor.getCursor('to')) }).open();
  }

  // Sentences for the chosen ranges, or for text the user edited in the preview box.
  items(source, ranges, edited = null) {
    const { limit, clauses } = this.speech.chunking();
    if (edited !== null) {
      return edited.split('\n').flatMap(line => splitSpeechText(line, limit, clauses).map(part => ({ text: part.text, start: 0, end: 0, range: 0, heading: false, level: 0 })));
    }
    return exportItems(source, mergeRanges(ranges), { limit, clauses });
  }

  // Same cache and providers as reading aloud, so exporting a sentence you just heard costs nothing.
  async synthesize(profile, item, signal) {
    checkTtsSignal(signal);
    if (profile.id === 'system') throw ttsError('systemExport');
    const { key: _key, ...publicProfile } = profile, key = JSON.stringify([publicProfile, item.text]), controller = this.speech.controller;
    const cached = controller.cache.get(key); if (cached) return cached;
    const result = await controller.synthesize(profile, item.text, signal);
    checkTtsSignal(signal); controller.cache.set(key, result); return result;
  }
  async decode(bytes) {
    const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    let audio;
    try { audio = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); } catch { throw ttsError('response'); }
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) { const data = audio.getChannelData(c); for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels; }
    return { pcm: mono, rate: audio.sampleRate };
  }
  async image(path) {
    if (!path) return null;
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    try { return await createImageBitmap(new Blob([await this.app.vault.readBinary(file)])); } catch { return null; }
  }
  platformLabel(kind) { return t(`share.platform.${kind}`); }

  // The options the modal collected → the files. Throws on failure; AbortError when cancelled.
  async generate({ items, profile, options, title, caption, signal, onProgress }) {
    const share = this.plugin.settings.share, signature = share.name || share.accounts.some(a => a.handle);
    const wantsVideo = options.format === 'mp4', videos = wantsVideo ? options.videos : [];
    const [avatar, background] = wantsVideo || options.coverImage ? await Promise.all([this.image(share.avatar), this.image(share.background)]) : [null, null];
    const outro = wantsVideo && options.outro && signature ? { name: share.name, avatar, accounts: outroAccounts(share.accounts, kind => this.platformLabel(kind)) } : null;
    const cover = (wantsVideo || options.coverImage) && options.cover ? { image: background } : null;
    try {
      return await runExport({
        items, speed: options.speed, title, caption, artist: share.name || '', baseName: fileBase(title), cover, outro, visual: options.visual, avatar, signal, onProgress,
        outputs: { mp3: options.format === 'mp3', srt: options.srt, cover: options.coverImage && !!cover, videos },
      }, { synthesize: (item, abort) => this.synthesize(profile, item, abort), decode: bytes => this.decode(bytes), concurrency: 2, doc: activeDocument,
        makeContext: (w, h) => makeCanvas(w, h, activeDocument).getContext('2d') });
    } finally { avatar?.close?.(); background?.close?.(); }
  }

  // Files go to the folder chosen in settings (anywhere on this computer), else beside the note's attachments.
  async save(files, sourcePath) {
    const folder = Platform.isDesktopApp ? this.plugin.settings.share.folder.trim() : '';
    if (folder) return saveToFolder(files, folder);
    const saved = [];
    for (const file of files) {
      const path = await this.app.fileManager.getAvailablePathForAttachment(file.name, sourcePath);
      const data = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength);
      const vaultFile = await this.app.vault.createBinary(path, data);
      saved.push({ ...file, name: vaultFile.name, vaultFile });
    }
    return saved;
  }
  reveal(saved) {
    if (saved.fullPath) { if (!revealPath(saved.fullPath)) new Notice(saved.fullPath); return; }
    const app = this.app;
    if (typeof app.showInFolder === 'function') app.showInFolder(saved.vaultFile.path);
    else new Notice(saved.vaultFile.path);
  }
  failed(error, profile) {
    if (error?.name === 'AbortError' || error?.code === 'aborted') return '';
    return errorText(error, profile.id);
  }
}
