import test from 'node:test';
import assert from 'node:assert/strict';
import { approximateWidth, layoutPages, pageAt, tokenize, wordState } from '../src/core/share/subtitles.js';
import { estimateMarks } from '../src/core/tts/timing.js';

const cueOf = (text, from = 0, to = 4, extra = {}) => ({ item: { text, ...extra }, from, to, marks: estimateMarks(text, to - from, from) });

test('punctuation stays with the word before it and spaces lead the next word', () => {
  const cue = { item: { text: '你好，世界 hello.', strong: [[3, 5]] }, from: 0, to: 3, marks: [{ s: 0, e: 2, from: 0, to: 1 }, { s: 3, e: 5, from: 1, to: 2 }, { s: 6, e: 11, from: 2, to: 3 }] };
  const tokens = tokenize(cue);
  assert.deepEqual(tokens.map(t => t.text), ['你好，', '世界', ' hello.']);
  assert.deepEqual(tokens.map(t => t.strong), [false, true, false]);
});
test('long sentences wrap into lines of at most maxLines per page, timed in order', () => {
  const text = '这是一个比较长的句子，需要被拆成多行显示，而且不能在标点之前换行。';
  const pages = layoutPages([cueOf(text)], { measure: s => approximateWidth(s), maxWidth: 10, maxLines: 2 });
  assert.ok(pages.length >= 2);
  for (const page of pages) {
    assert.ok(page.lines.length <= 2);
    for (const line of page.lines) { assert.ok(approximateWidth(line.map(w => w.text).join('')) <= 10.01); assert.ok(!/^[，。]/.test(line[0].text)); }
  }
  assert.equal(pages.map(p => p.lines.flat().map(w => w.text).join('')).join(''), text);
  assert.ok(pages.every((p, i) => !i || p.from >= pages[i - 1].from));
});
test('pages hand over to each other without gaps and the current word is found by time', () => {
  const pages = layoutPages([cueOf('第一句。', 0, 2), cueOf('第二句。', 2.5, 4.5, { heading: true, level: 2 })], { measure: s => approximateWidth(s), maxWidth: 20, maxLines: 2 });
  assert.equal(pages.length, 2);
  assert.ok(pages[0].hide <= pages[1].from && pages[0].hide > pages[0].to);
  assert.equal(pageAt(pages, 1), pages[0]); assert.equal(pageAt(pages, 3), pages[1]); assert.equal(pageAt(pages, 99), null);
  assert.equal(pages[1].heading, true);
  const words = pages[0].lines[0];
  assert.deepEqual([wordState(words[0], 0.0), wordState(words[0], 99)], ['now', 'done']);
});
test('a word wider than the line is split instead of overflowing', () => {
  const pages = layoutPages([cueOf('https://example.com/a-very-long-address', 0, 2)], { measure: s => approximateWidth(s), maxWidth: 8, maxLines: 5 });
  for (const line of pages.flatMap(p => p.lines)) assert.ok(approximateWidth(line.map(w => w.text).join('')) <= 8.01);
});
test('lines break after punctuation when the line count allows, without a stray last line', () => {
  const text = '每天早上先做最重要的一件事，其他的都可以往后放。';
  const [page] = layoutPages([cueOf(text, 0, 6)], { measure: s => approximateWidth(s), maxWidth: 13.8, maxLines: 3 });
  assert.deepEqual(page.lines.map(line => line.map(w => w.text).join('')), ['每天早上先做最重要的一件事，', '其他的都可以往后放。']);
  const [short] = layoutPages([cueOf('这是一个关于时间管理的小技巧。', 0, 3)], { measure: s => approximateWidth(s), maxWidth: 13.8, maxLines: 3 });
  assert.ok(short.lines.length === 1 || short.lines.at(-1).map(w => w.text).join('').length > 3);
});
