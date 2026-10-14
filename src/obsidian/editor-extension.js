import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

export const setSpeechRange = StateEffect.define();
const mark = Decoration.mark({ class: 'qaudio-speaking' });

// The sentence being read, mapped through edits so it stays on the same words.
const speechField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setSpeechRange)) continue;
      const range = effect.value, length = tr.state.doc.length;
      value = range && range.to > range.from && range.from >= 0 && range.to <= length
        ? Decoration.set([mark.range(range.from, range.to)]) : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

// Document edits are forwarded so reading and dictation sessions can map their saved offsets.
export function audioEditorExtension(onChange, onSelectionChange = () => {}) {
  return [speechField, EditorView.updateListener.of(update => {
    if (update.docChanged) onChange(update.view, update.changes);
    if (update.selectionSet) onSelectionChange(update.view);
  })];
}
export function editorView(markdownView) { return markdownView?.editor?.cm || null; }
export function showSpeechRange(markdownView, range) {
  const cm = editorView(markdownView);
  if (!cm) return;
  try { cm.dispatch({ effects: setSpeechRange.of(range) }); } catch { /* A closed editor cannot be updated. */ }
}
// Whether [from, to) is on screen in the editor.
export function rangeVisible(markdownView, from) {
  const cm = editorView(markdownView);
  if (!cm || !cm.dom.isConnected) return true;
  const box = cm.scrollDOM.getBoundingClientRect(), at = cm.coordsAtPos(Math.min(from, cm.state.doc.length));
  const bar = markdownView.contentEl.querySelector('.qaudio-player')?.getBoundingClientRect();
  return !!at && at.top >= box.top && at.bottom <= Math.min(box.bottom, bar?.top ?? box.bottom - 72) - 12;
}
