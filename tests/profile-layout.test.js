import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('profile identity appears before the compact Posts heading and profile tabs', () => {
  assert.match(html, /id="profile-summary"[\s\S]*?id="profile-timeline-controls"/);
  assert.match(source, /card\.replaceChildren\(cover\);[\s\S]*?timelineControls\?\.replaceChildren\(tabs, pinnedSlot\)/);
  assert.match(styles, /\.feed-window\[data-profile-view="true"\]>\.profile-summary\{order:0/);
  assert.match(styles, /\.feed-window\[data-profile-view="true"\]>\.feed-toolbar\{order:1/);
  assert.match(styles, /\.feed-window\[data-profile-view="true"\]>\.profile-timeline-controls\{order:2/);
});

test('profile view expands to the feed width and removes unrelated feed tools', () => {
  assert.match(source, /profileLayout\.dataset\.profileView = String\(profileView\)/);
  assert.match(source, /discover\.hidden = state\.boardMode !== 'signals' \|\| state\.feedMode === 'profile'/);
  assert.match(styles, /\.feed-layout\[data-profile-view="true"\]>\.right-column\{display:none\}/);
});
