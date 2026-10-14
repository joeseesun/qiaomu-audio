import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownChunks } from '../src/markdown/speech-source.js';
import { exportScopes, exportItems, outline } from '../src/core/share/scope.js';

test('bold and highlighted words are reported as emphasis ranges in chunk text', () => {
  const [chunk] = markdownChunks('一句 **重点词** 与 ==高亮== 结束。');
  assert.equal(chunk.text, '一句 重点词 与 高亮 结束。');
  assert.deepEqual(chunk.strong.map(([a, b]) => chunk.text.slice(a, b)), ['重点词', '高亮']);
  assert.equal(markdownChunks('没有强调。')[0].strong, undefined);
  assert.equal(markdownChunks('**未闭合\n\n下一段。')[1].strong, undefined);
});

const NOTE = '---\ntitle: x\n---\n# 总标题\n导语。\n## 方法\n第一步。\n### 细节\n细节内容。\n## 结果\n```\n# 不是标题\n```\n结果内容。\n';

test('outline finds headings, ignores code fences and frontmatter, and nests sections by level', () => {
  const list = outline(NOTE);
  assert.deepEqual(list.map(h => [h.level, h.title]), [[1, '总标题'], [2, '方法'], [3, '细节'], [2, '结果']]);
  assert.equal(NOTE.slice(list[1].start, list[1].end), '## 方法\n第一步。\n### 细节\n细节内容。\n');
  assert.equal(NOTE.slice(list[2].start, list[2].end), '### 细节\n细节内容。\n');
  assert.equal(list[0].end, NOTE.length);
});

test('scopes: selection wins, note and cursor ranges, current section and chosen sections', () => {
  const at = NOTE.indexOf('第一步');
  const scopes = exportScopes(NOTE, { selection: null, cursor: at });
  assert.deepEqual(scopes.map(s => s.id), ['note', 'cursor', 'section', 'sections']);
  assert.equal(scopes.find(s => s.id === 'section').title, '方法');
  const withSelection = exportScopes(NOTE, { selection: { from: 0, to: 5 }, cursor: 0 });
  assert.equal(withSelection[0].id, 'selection');
  assert.deepEqual(exportScopes('没有标题。', { selection: null, cursor: 2 }).map(s => s.id), ['note', 'cursor']);
});

test('export items keep order, mark headings and carry emphasis for the chosen ranges', () => {
  const list = outline(NOTE);
  const items = exportItems(NOTE, [{ from: list[3].start, to: list[3].end }, { from: list[1].start, to: list[1].end }]);
  assert.deepEqual(items.map(i => i.text), ['结果', '结果内容。', '方法', '第一步。', '细节', '细节内容。']);
  assert.deepEqual(items.map(i => !!i.heading), [true, false, true, false, true, false]);
  assert.equal(items[0].range, 0); assert.equal(items[2].range, 1);
  const bold = exportItems('说 **重点** 吧。', [{ from: 0, to: 9 }]);
  assert.deepEqual(bold[0].strong, [[2, 4]]);
});
