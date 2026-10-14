import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/settings.js';
import { MAX_ACCOUNTS, outroAccounts } from '../src/core/share/brand.js';

test('share settings default to a vertical MP4 on desktop and MP3 on mobile', () => {
  const desktop = normalizeSettings({}, true).share, mobile = normalizeSettings({}, false).share;
  assert.deepEqual([desktop.format, desktop.videos, desktop.speed, desktop.folder], ['mp4', ['portrait'], 1, '']);
  assert.equal(mobile.format, 'mp3');
});
test('invalid share values fall back instead of breaking export', () => {
  const share = normalizeSettings({ share: { format: 'avi', videos: ['square', 'landscape', 'landscape'], speed: 9, name: ' 乔木 ', folder: '  ~/Movies  ', accounts: [{ kind: 'tiktok', handle: 'a'.repeat(200) }, null, 'x'] } }, true).share;
  assert.equal(share.format, 'mp4'); assert.deepEqual(share.videos, ['landscape']); assert.equal(share.speed, 1);
  assert.equal(share.name, '乔木'); assert.equal(share.folder, '~/Movies');
  assert.deepEqual(share.accounts.map(a => [a.kind, a.handle.length]), [['custom', 80]]);
  assert.equal(normalizeSettings({ share: { videos: [] } }, true).share.videos[0], 'portrait');
});
test('speeds snap to 0.05 steps inside 0.75–2×', () => {
  for (const [input, expected] of [[1.23, 1.25], [0.75, 0.75], [2, 2], [0.5, 1], [2.5, 1], ['fast', 1]]) assert.equal(normalizeSettings({ share: { speed: input } }, true).share.speed, expected, String(input));
});
test('mobile never keeps a custom export folder or video format', () => {
  const share = normalizeSettings({ share: { format: 'mp4', folder: '/Users/x/Movies' } }, false).share;
  assert.equal(share.folder, ''); assert.equal(share.format, 'mp3');
});
test('end card rows skip empty handles, cap the count and name custom platforms', () => {
  const label = kind => ({ x: 'X', custom: 'Other' })[kind] || kind;
  const rows = outroAccounts([{ kind: 'x', handle: ' @a ' }, { kind: 'github', handle: '' }, { kind: 'custom', handle: 'b.com', label: '博客' }, { kind: 'custom', handle: 'c.com', label: '' }], label);
  assert.deepEqual(rows.map(r => [r.label, r.handle]), [['X', '@a'], ['博客', 'b.com'], ['Other', 'c.com']]);
  assert.equal(outroAccounts(Array.from({ length: 20 }, () => ({ kind: 'x', handle: 'h' })), label).length, MAX_ACCOUNTS);
});
