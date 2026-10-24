import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('loading states announce progress and provide a visible indicator', () => {
  assert.match(main, /function renderEmpty\(title, copy, action = null\)[\s\S]*?aria-busy/);
  assert.match(main, /className = 'loading-indicator'/);
  assert.match(styles, /\.empty-message\[aria-busy="true"\][\s\S]*?\.loading-indicator/);
});

test('manual refresh and profile search expose their in-progress state', () => {
  assert.match(main, /button\.setAttribute\('aria-busy', 'true'\)[\s\S]*?loadFeed\(state\.feedTargetFid/);
  assert.match(main, /submit\.textContent = 'Searching…'/);
  assert.match(main, /small\?\.setAttribute\('aria-busy', 'true'\)/);
});

test('Desk activity failures clear loading state and leave its retry control available', () => {
  assert.match(main, /async function loadDeskActivity\([\s\S]*?catch \(error\) \{[\s\S]*?state\.deskActivityBusy = false;[\s\S]*?renderDeskActivity\(\);[\s\S]*?Could not load pinned activity/);
});
