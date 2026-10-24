import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('feed sort, discovery, and saved views stay visible beside the main feed tabs', () => {
  assert.match(html, /class="feed-view-controls"[^>]*aria-label="Feed view and tools"/);
  for (const id of ['show-recent', 'show-popular', 'show-suggested', 'show-flight-log']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /class="feed-extra-menu"|aria-label="More feed options"/);
});

test('feed controls wrap to a touch-friendly grid on small screens', () => {
  assert.match(css, /\.feed-view-controls\s*\{[^}]*display:flex/);
  assert.match(css, /\.feed-toolbar-actions>\.feed-view-controls\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:360px\)\{\s*\.feed-toolbar-actions>\.feed-view-controls\s*\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('quick controls keep the feed broad by default and label filters clearly', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /savedMediaPreference === null \|\| savedMediaPreference === 'true'/);
  assert.match(source, /state\.repliesOnly = options\.repliesOnly === true/);
  assert.match(source, /state\.mediaOnly = options\.mediaOnly === true/);
  assert.match(source, /state\.appsOnly = options\.appsOnly === true/);
  assert.match(html, /<input type="checkbox" data-quick-setting="remoteMediaEnabled" \/>/);
  for (const label of ['Post media', 'Replies only', 'Media only', 'Apps &amp; links only', 'Group repeated links']) {
    assert.ok(html.includes(label), `quick controls show ${label}`);
  }
  assert.match(html, /data-quick-setting="groupRepeats"/);
});
