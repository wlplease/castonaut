import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('feed avatars, author handles, and suggested identities open profile routes', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const avatar = document\.createElement\('button'\); avatar\.type = 'button'; avatar\.className = 'post-avatar'; avatar\.dataset\.openProfile = String\(fid\)/);
  assert.match(source, /className = 'post-handle post-handle-link'; handle\.dataset\.openProfile = String\(fid\)/);
  assert.match(source, /className = 'suggested-avatar profile-open-button'; avatar\.dataset\.openProfile = String\(suggestion\.fid\)/);
  assert.match(source, /className = 'suggested-identity profile-open-button'; identity\.dataset\.openProfile = String\(suggestion\.fid\)/);
  assert.match(source, /if \(currentArea !== 'feed'\) navigate\('feed', \{ preserveHash: true \}\)/);
});

test('a profile page offers a clear path to compose a standalone cast', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /compose\.dataset\.composeCast = 'true'; compose\.textContent = 'Write a cast'/);
  assert.match(source, /if \(!state\.signerReady\) \{ openConnectDialog\(\); return; \}[\s\S]{0,240}await loadFeed\(state\.fid, 'following'\)/);
  assert.match(source, /composer\?\.focus\(\{ preventScroll: true \}\)/);
});

test('profile photos offer an explicit opt-in with the IP privacy tradeoff', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /showPhoto\.textContent = 'Show profile photo'/);
  assert.match(source, /profile image host, which can see your IP address/);
  assert.match(source, /control\.checked = true;\s+control\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});
