import test from 'node:test';
import assert from 'node:assert/strict';
import { lineOfOffset, markdownChunks, markdownSpeech, readingPlan } from '../src/markdown/speech-source.js';

const spoken = source => markdownChunks(source).map(c => c.text);
const spans = source => markdownChunks(source).map(c => source.slice(c.start, c.end));

test('frontmatter, code, math, comments and embeds are never read', () => {
  const source = '---\ntitle: 秘密\n---\n正文一。\n```js\nconst x = 1;\n```\n$$\nE=mc^2\n$$\n%% 私人 %%正文二<!-- 隐藏 -->。![[a.png]]![alt](b.png)';
  assert.deepEqual(spoken(source), ['正文一。', '正文二。']);
});
test('links read their display text and URLs, tags and footnotes are skipped', () => {
  const source = '见[[folder/笔记A|别名]]与[[笔记B#小节]]，[官网](https://a.com) https://b.com #待办 注[^1]。\n\n[^1]: 脚注';
  assert.deepEqual(spoken(source), ['见别名与笔记B 小节，官网 注。']);
});
test('headings, list items, tasks, quotes and callouts become separate sentences', () => {
  const source = '# 标题\n- [ ] 任务\n1. 第一\n> [!tip] 提示\n> 引用内容';
  assert.deepEqual(spoken(source), ['标题', '任务', '第一', '提示', '引用内容']);
});
test('emphasis markers are dropped but snake_case and escaped symbols remain', () => {
  assert.deepEqual(spoken('**粗体** ==高亮== ~~删除~~ *斜体* snake_case \\*星号'), ['粗体 高亮 删除 斜体 snake_case *星号']);
});
test('hard-wrapped paragraphs read as one sentence; offsets point at the source words', () => {
  const source = 'Hard wrapped English\nsentence ends here. Next one.';
  const chunks = markdownChunks(source);
  assert.equal(chunks[0].text, 'Hard wrapped English sentence ends here.');
  assert.equal(source.slice(chunks[0].start, chunks[0].end), 'Hard wrapped English\nsentence ends here.');
  assert.equal(source.slice(chunks[1].start, chunks[1].end), 'Next one.');
});
test('every chunk span begins and ends on real source characters', () => {
  const source = '# 题\n\n这是**第一句**。第二句[[链接|别名]]结束！\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  for (const span of spans(source)) assert.match(span, /^\S[\s\S]*\S$|^\S$/u);
  assert.deepEqual(spans(source).slice(0, 3), ['题', '这是**第一句**。', '第二句[[链接|别名]]结束！']);
});
test('from skips sentences before the cursor; base offsets selection chunks', () => {
  const source = '第一句。第二句。第三句。';
  assert.deepEqual(markdownChunks(source, { from: 5 }).map(c => c.text), ['第二句。', '第三句。']);
  const selected = markdownChunks('第二句。', { base: 4 });
  assert.deepEqual([selected[0].start, selected[0].end], [4, 8]);
});
test('local-model clause chunking stays within limits and keeps offsets', () => {
  const source = '一二三四五，六七八九十；甲乙丙丁戊。';
  const chunks = markdownChunks(source, { limit: 40, clauses: true });
  assert.deepEqual(chunks.map(c => c.text), ['一二三四五，', '六七八九十；', '甲乙丙丁戊。']);
  for (const c of chunks) assert.equal(source.slice(c.start, c.end), c.text);
});
test('map length equals text length; empty and symbol-only notes give nothing', () => {
  const { text, map } = markdownSpeech('# A\n\n**b** [[c]]');
  assert.equal(text.length, map.length);
  assert.deepEqual(spoken(''), []);
  assert.deepEqual(spoken('---\n\n***\n\n| --- |'), []);
  assert.equal(lineOfOffset('a\nb\nc', 4), 2);
});
test('unclosed fences and comments do not leak hidden text', () => {
  assert.deepEqual(spoken('可读。\n```\n代码'), ['可读。']);
  assert.deepEqual(spoken('可读。%% 开始\n还在注释\n%%后面'), ['可读。', '后面']);
});

test('explicit cursor restart begins at the requested character inside formatted text', () => {
  const source = '第一句。这里有**指定起点**和[可见文字](https://hidden.invalid)。最后一句。';
  const offset = source.indexOf('指定'), plan = readingPlan(source, { offset, exact: true });
  assert.equal(plan.index, 1);
  assert.equal(plan.items[plan.index].text, '指定起点和可见文字。');
  assert.equal(plan.items[plan.index].start, offset);
  assert.equal(plan.items[0].text, '第一句。');
  assert.equal(readingPlan(source, { offset }).items[1].text, '这里有指定起点和可见文字。');
});

test('cursor in hidden Markdown advances to readable text; EOF never restarts the note', () => {
  const source = '---\ntitle: private\n---\n开头。\n```js\nsecret\n```\n后面。';
  for (const word of ['private', 'secret']) {
    const plan = readingPlan(source, { offset: source.indexOf(word), exact: true });
    assert.equal(plan.items[plan.index].text, word === 'private' ? '开头。' : '后面。');
  }
  assert.equal(readingPlan(source, { offset: source.length, exact: true }).index, -1);
  assert.equal(readingPlan('最后一句。', { offset: 4, exact: true }).index, -1);
});
