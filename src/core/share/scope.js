// Which part of a note to export, and the speakable items inside it. Pure: no Obsidian or DOM imports.
import { markdownChunks } from '../../markdown/speech-source.js';

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

// Headings with the source range of their section (up to the next heading of the same or a higher level).
export function outline(source) {
  const lines = String(source || '').split('\n'), found = [];
  let offset = 0, fence = null, i = 0;
  const advance = () => { offset += lines[i].length + 1; i++; };
  if (/^---\s*$/.test(lines[0] || '')) {
    advance();
    while (i < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[i])) advance();
    if (i < lines.length) advance();
  }
  for (; i < lines.length; advance()) {
    const raw = lines[i], line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (fence) { if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null; continue; }
    const f = FENCE.exec(line);
    if (f) { fence = f[1]; continue; }
    const m = HEADING.exec(line);
    if (!m) continue;
    const title = m[2].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_=~`]/g, '').trim();
    if (title) found.push({ level: m[1].length, title, start: offset, lineEnd: offset + raw.length, end: source.length });
  }
  found.forEach((heading, index) => {
    const next = found.slice(index + 1).find(other => other.level <= heading.level);
    if (next) heading.end = next.start;
  });
  return found;
}

// Drop ranges that lie inside another and sort the rest in note order.
export function mergeRanges(ranges) {
  const sorted = [...ranges].filter(r => r.to > r.from).sort((a, b) => a.from - b.from || b.to - a.to), merged = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.from < last.to) last.to = Math.max(last.to, range.to); else merged.push({ ...range });
  }
  return merged;
}

// The scopes worth offering right now. The first entry is the default.
export function exportScopes(source, { selection = null, cursor = 0 } = {}) {
  const text = String(source || ''), scopes = [], headings = outline(text);
  if (selection && selection.to > selection.from) scopes.push({ id: 'selection', ranges: [{ from: selection.from, to: selection.to }] });
  scopes.push({ id: 'note', ranges: [{ from: 0, to: text.length }] });
  if (cursor > 0 && cursor < text.length) scopes.push({ id: 'cursor', ranges: [{ from: cursor, to: text.length }] });
  const current = headings.filter(h => h.start <= cursor).at(-1);
  if (current) scopes.push({ id: 'section', title: current.title, ranges: [{ from: current.start, to: current.end }] });
  if (headings.length > 1) scopes.push({ id: 'sections', ranges: [], headings });
  return scopes;
}

// Speakable sentences for the ranges, in the order given. `range` is the index of the source range and
// `heading` marks items that are a heading line, so a video can style them as titles.
export function exportItems(source, ranges, { limit = 240, clauses = false } = {}) {
  const headings = outline(source), items = [];
  ranges.forEach((range, index) => {
    for (const chunk of markdownChunks(source.slice(range.from, range.to), { base: range.from, limit, clauses })) {
      const heading = headings.find(h => chunk.start >= h.start && chunk.start <= h.lineEnd);
      items.push({ ...chunk, range: index, heading: !!heading, level: heading?.level || 0 });
    }
  });
  return items;
}

export const plainText = items => items.map(item => item.text).join('\n');
export const characterCount = items => items.reduce((sum, item) => sum + [...item.text.replace(/\s+/g, '')].length, 0);
// Spoken seconds at normal speed, from character counts (Chinese ≈ 4.5 characters/s, other text ≈ 15).
export function estimateSeconds(items) {
  let seconds = 0;
  for (const item of items) {
    const cjk = (item.text.match(/[㐀-鿿぀-ヿ가-힯]/gu) || []).length, other = item.text.replace(/[㐀-鿿぀-ヿ가-힯\s]/gu, '').length;
    seconds += cjk / 4.5 + other / 15 + 0.2;
  }
  return seconds;
}
