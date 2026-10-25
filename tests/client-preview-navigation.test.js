import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('first-run actions connect the account or scroll to the sample feed', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(html, /id="hero-connect">Connect your account/);
  assert.match(source, /\$\('#hero-connect'\)\?\.addEventListener\('click', openConnectDialog\)/);
  assert.match(html, /href="#client-preview" data-scroll-to="client-preview">Browse sample feed/);
  assert.match(source, /destination === 'client-preview' \? 'feed' : 'desk'/);
  assert.match(source, /navigate\(destination === 'people-search'[\s\S]*?\{ preserveHash: true, restoreScroll: false \}\)/);
  assert.match(source, /target\?\.scrollIntoView\(\{ behavior: window\.matchMedia/);
});
