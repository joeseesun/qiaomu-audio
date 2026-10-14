import { FuzzySuggestModal } from 'obsidian';

const IMAGE = /^(png|jpe?g|webp|gif|bmp|avif)$/i;

// Pick an image from the vault; the settings store its path.
export class ImageSuggest extends FuzzySuggestModal {
  constructor(app, placeholder, onChoose) { super(app); this.onPick = onChoose; this.setPlaceholder(placeholder); }
  getItems() { return this.app.vault.getFiles().filter(file => IMAGE.test(file.extension)); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.onPick(file.path); }
}
