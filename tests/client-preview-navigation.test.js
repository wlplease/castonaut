import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('See the client opens the feed area and scrolls to its preview', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(html, /href="#client-preview" data-scroll-to="client-preview">See the client/);
  assert.match(source, /destination === 'client-preview' \? 'feed' : 'desk'/);
  assert.match(source, /navigate\(destination === 'people-search'[\s\S]*?\{ preserveHash: true, restoreScroll: false \}\)/);
  assert.match(source, /target\?\.scrollIntoView\(\{ behavior: window\.matchMedia/);
});
