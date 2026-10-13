// Markdown note → speakable text with a source-offset map, so the sentence being read can be highlighted
// and followed in the editor. Pure: no Obsidian or DOM imports.
import { splitSpeechText } from '../core/tts/text.js';

const FENCE = /^\s*(`{3,}|~{3,})/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const FOOTNOTE_DEF = /^\s*\[\^[^\]]+\]:/;
const BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/;
const WORD = /[\p{L}\p{N}]/u;

function lines(source) {
  const result = []; let offset = 0;
  for (const raw of source.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    result.push({ text, offset }); offset += raw.length + 1;
  }
  return result;
}
// Display text of a wikilink target: file name without folders, heading after '#', no block refs.
function wikiDisplay(target) {
  const [path, ...rest] = target.split('#');
  const name = path.split('/').pop().replace(/\.md$/i, '');
  const sub = rest.filter(x => x && !x.startsWith('^')).join(' ');
  return [name, sub].filter(Boolean).join(' ');
}

class Builder {
  constructor() { this.text = ''; this.map = []; this.state = { comment: false, html: false }; this.pending = false; }
  emit(char, offset) { this.text += char; this.map.push(offset); }
  // A block boundary becomes a newline (a sentence break for the segmenter).
  breakBlock(offset) {
    if (this.text && !this.text.endsWith('\n')) this.emit('\n', offset);
    this.pending = false;
  }
  softBreak(offset) { if (this.text && !/\s$/.test(this.text)) this.emit(' ', offset); }
  emitRange(text, offset) { for (let i = 0; i < text.length; i++) this.emit(text[i], offset + i); }
  emitMapped(text, start, end) {
    for (let i = 0; i < text.length; i++) this.emit(text[i], Math.min(end - 1, start + i));
  }
  inline(s, o) {
    const st = this.state;
    for (let i = 0; i < s.length;) {
      const rest = s.slice(i);
      if (st.comment) { const end = s.indexOf('%%', i); if (end < 0) return; st.comment = false; i = end + 2; continue; }
      if (st.html) { const end = s.indexOf('-->', i); if (end < 0) return; st.html = false; i = end + 3; continue; }
      if (rest.startsWith('%%')) { st.comment = true; i += 2; continue; }
      if (rest.startsWith('<!--')) { st.html = true; i += 4; continue; }
      if (s[i] === '\\' && /[\\`*_{}[\]()#+\-.!|~=$<>]/.test(s[i + 1] || '')) { this.emit(s[i + 1], o + i + 1); i += 2; continue; }
      let m;
      if ((m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) { this.emitRange(m[2], o + i + m[1].length); i += m[0].length; continue; }
      if ((m = /^\$(?=\S)[^$\n]*?\S\$(?!\d)/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^!\[\[[^\]\n]*\]\]/.exec(rest)) || (m = /^!\[[^\]\n]*\]\([^)\n]*\)/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/.exec(rest))) {
        if (m[2] !== undefined) this.inline(m[2], o + i + 3 + m[1].length);
        else this.emitMapped(wikiDisplay(m[1]), o + i + 2, o + i + 2 + m[1].length);
        i += m[0].length; continue;
      }
      if ((m = /^\[\^[^\]\n]+\]/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^\[([^\]\n]+)\](\([^)\n]*\)|\[[^\]\n]*\])/.exec(rest))) { this.inline(m[1], o + i + 1); i += m[0].length; continue; }
      if ((m = /^<https?:\/\/[^>\s]+>/.exec(rest)) || (m = /^https?:\/\/[^\s<>()]+/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^<\/?[A-Za-z][^>\n]*>/.exec(rest))) { i += m[0].length; continue; }
      if (s[i] === '#' && (i === 0 || /\s/.test(s[i - 1])) && (m = /^#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*/u.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^(\*\*|__|~~|==)/.exec(rest))) { i += 2; continue; }
      if (s[i] === '*') { i++; continue; }
      if (s[i] === '_' && (!WORD.test(s[i - 1] || '') || !WORD.test(s[i + 1] || ''))) { i++; continue; }
      this.emit(s[i], o + i); i++;
    }
  }
}

// Returns { text, map } where map[k] is the source offset of text[k].
export function markdownSpeech(source) {
  const b = new Builder(), all = lines(String(source || ''));
  let fence = null, math = false, i = 0, paragraph = false;
  if (/^---\s*$/.test(all[0]?.text || '')) {
    for (i = 1; i < all.length && !/^(---|\.\.\.)\s*$/.test(all[i].text); i++);
    i++;
  }
  for (; i < all.length; i++) {
    const { text, offset } = all[i];
    if (fence) { if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(text)) fence = null; continue; }
    const f = FENCE.exec(text);
    if (f && !b.state.comment && !b.state.html) { fence = f[1]; b.breakBlock(offset); paragraph = false; continue; }
    if (math) { if (text.includes('$$')) math = false; continue; }
    if (/^\s*\$\$/.test(text) && !b.state.comment) {
      if (!/\$\$.*\$\$/.test(text.trim().slice(2)) && !/^\s*\$\$.+\$\$\s*$/.test(text)) math = true;
      b.breakBlock(offset); paragraph = false; continue;
    }
    if (!text.trim() || HR.test(text) || TABLE_RULE.test(text) || FOOTNOTE_DEF.test(text)) {
      if (!b.state.comment && !b.state.html) { b.breakBlock(offset); paragraph = false; continue; }
    }
    let start = 0, line = text.replace(BLOCK_ID, m => ' '.repeat(m.length)), separate = false;
    const quote = /^(\s*>\s?)+/.exec(line);
    if (quote) start = quote[0].length;
    const callout = /^\[![^\]]+\][+-]?\s*/.exec(line.slice(start));
    if (callout) { start += callout[0].length; separate = true; }
    const heading = /^\s{0,3}#{1,6}\s+/.exec(line.slice(start));
    if (heading) { start += heading[0].length; separate = true; line = line.replace(/\s#+\s*$/, m => ' '.repeat(m.length)); }
    const list = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/.exec(line.slice(start));
    if (list) { start += list[0].length; separate = true; }
    const table = /^\s*\|/.test(line.slice(start));
    if (table) separate = true;
    if (separate || !paragraph) b.breakBlock(offset);
    else b.softBreak(offset - 1);
    if (table) {
      const cells = line.slice(start); let cellStart = 0;
      for (let k = 0; k <= cells.length; k++) {
        if (k === cells.length || (cells[k] === '|' && cells[k - 1] !== '\\')) {
          const cell = cells.slice(cellStart, k);
          if (cell.trim()) { if (b.text && !b.text.endsWith('\n')) b.emit('，', offset + start + cellStart - 1); b.inline(cell, offset + start + cellStart); }
          cellStart = k + 1;
        }
      }
    } else b.inline(line.slice(start), offset + start);
    paragraph = !separate;
    if (separate) b.breakBlock(offset + text.length);
  }
  return { text: b.text, map: b.map };
}

// Speakable sentences with absolute source offsets [start, end). `from` skips everything before that offset.
export function markdownChunks(source, { base = 0, from = 0, limit = 240, clauses = false } = {}) {
  const { text, map } = markdownSpeech(source), chunks = [];
  for (const part of splitSpeechText(text, limit, clauses)) {
    let s = part.start, e = part.end - 1;
    while (s <= e && /\s/.test(text[s])) s++;
    while (e >= s && /\s/.test(text[e])) e--;
    if (s > e || !WORD.test(part.text)) continue;
    const start = base + map[s], end = base + map[e] + 1;
    if (end <= from) continue;
    chunks.push({ text: part.text, start, end });
  }
  return chunks;
}
export function lineOfOffset(source, offset) {
  let line = 0;
  for (let i = 0; i < Math.min(offset, source.length); i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}
