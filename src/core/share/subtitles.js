// Lays spoken sentences out as subtitle pages for a video. `measure(text)` returns a width in the same unit
// as `maxWidth`, so the layout is independent of any canvas. Pure: no DOM or Obsidian imports.

const WIDE = /[㐀-鿿぀-ヿ가-힯]/u;

function overlaps(ranges, s, e) { return !!ranges?.some(([a, b]) => a < e && b > s); }

// Words of one sentence with their spoken time. Punctuation stays on the word before it so a line never
// starts with "，" or "。"; spaces stay on the word after it.
export function tokenize(cue) {
  const text = cue.item.text, strong = cue.item.strong, tokens = [];
  if (!cue.marks.length) return [{ text, from: cue.from, to: cue.to, strong: !!strong?.length }];
  let cursor = 0;
  for (const mark of cue.marks) {
    const gap = text.slice(cursor, mark.s);
    let lead = gap;
    if (tokens.length) { const [, punctuation, space] = /^(\S*)(\s*)/.exec(gap); tokens.at(-1).text += punctuation; lead = space; } else lead = gap.trimStart();
    tokens.push({ text: lead + text.slice(mark.s, mark.e), from: mark.from, to: mark.to, strong: overlaps(strong, mark.s, mark.e) });
    cursor = mark.e;
  }
  if (cursor < text.length) tokens.at(-1).text += text.slice(cursor).trimEnd();
  return tokens;
}

// A single "word" wider than a line (a URL, a long identifier) is cut into pieces that share its time.
function fit(token, measure, maxWidth) {
  if (measure(token.text) <= maxWidth) return [token];
  const chars = [...token.text], pieces = []; let start = 0;
  while (start < chars.length) {
    let end = start + 1;
    while (end < chars.length && measure(chars.slice(start, end + 1).join('')) <= maxWidth) end++;
    pieces.push({ ...token, text: chars.slice(start, end).join('') }); start = end;
  }
  pieces.forEach((piece, i) => { const span = (token.to - token.from) / pieces.length; piece.from = token.from + span * i; piece.to = token.from + span * (i + 1); });
  return pieces;
}

function greedy(tokens, measure, maxWidth) {
  const lines = []; let line = [], width = 0;
  for (const token of tokens.flatMap(x => fit(x, measure, maxWidth))) {
    const text = line.length ? token.text : token.text.trimStart(), size = measure(text);
    if (line.length && width + size > maxWidth) { lines.push(line); line = []; width = 0; }
    const placed = line.length ? token.text : token.text.trimStart();
    line.push({ ...token, text: placed }); width += measure(placed);
  }
  if (line.length) lines.push(line);
  return lines;
}
// Fill lines greedily, then narrow the measure as far as the line count allows so the last line is not a
// stray character or two.
const BREAK_AFTER = /[，。！？；：、,.;!?:…)）」』”’]\s*$/u;
const lineWidth = (line, measure) => measure(line.map(w => w.text).join(''));
// Try the widths that keep the line count and keep the one that breaks after punctuation, with even lines
// and no stray last line.
export function wrap(tokens, measure, maxWidth) {
  const lines = greedy(tokens, measure, maxWidth);
  if (lines.length < 2) return lines;
  let low = maxWidth * 0.45, high = maxWidth;
  for (let i = 0; i < 8; i++) {
    const mid = (low + high) / 2;
    if (greedy(tokens, measure, mid).length <= lines.length) high = mid; else low = mid;
  }
  let best = null, bestScore = -Infinity;
  for (let step = 0; step <= 10; step++) {
    const width = high + ((maxWidth - high) * step) / 10, trial = greedy(tokens, measure, width);
    if (trial.length > lines.length) continue;
    const widths = trial.map(line => lineWidth(line, measure)), spread = (Math.max(...widths) - Math.min(...widths)) / maxWidth;
    const punctuation = trial.slice(0, -1).filter(line => BREAK_AFTER.test(line.at(-1).text)).length;
    const score = punctuation * 0.6 - spread - (widths.at(-1) < maxWidth * 0.2 ? 1 : 0);
    if (score > bestScore + 1e-9) { best = trial; bestScore = score; }
  }
  return best || lines;
}

// Pages in time order. Each page keeps its last words on screen until the next page starts.
export function layoutPages(cues, { measure, maxWidth, maxLines }) {
  const pages = [];
  for (const cue of cues) {
    const lines = wrap(tokenize(cue), measure, maxWidth);
    for (let i = 0; i < lines.length; i += maxLines) {
      const group = lines.slice(i, i + maxLines), words = group.flat();
      pages.push({ from: words[0].from, to: words.at(-1).to, lines: group, heading: !!cue.item.heading, level: cue.item.level || 0 });
    }
  }
  pages.forEach((page, i) => {
    const next = pages[i + 1];
    page.show = i === 0 ? 0 : Math.max(0, page.from - 0.06);
    page.hide = next ? Math.max(page.to, next.from - 0.06) : page.to + 0.5;
  });
  return pages;
}
export const pageAt = (pages, t) => pages.find(page => t >= page.show && t < page.hide) || null;
export function wordState(token, t) { return t >= token.to ? 'done' : t >= token.from ? 'now' : 'next'; }
export const approximateWidth = (text, size = 1) => [...text].reduce((sum, ch) => sum + (WIDE.test(ch) ? 1 : /\s/.test(ch) ? 0.3 : 0.55) * size, 0);
