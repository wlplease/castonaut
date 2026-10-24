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

test('replying from a profile opens the addressed reply composer and retains the parent cast', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /if \(button\.dataset\.action === 'reply'\) \{[\s\S]{0,300}state\.parent = \{ fid: targetFid, hash: button\.dataset\.hash \};[\s\S]{0,300}\$\('#composer'\)\.hidden = false/);
  assert.match(source, /\(state\.feedMode === 'profile' && !state\.parent\)/);
  assert.match(source, /if \(parent\) body\.parentCastId = \{ fid: Number\(parent\.fid\), hash:/);
});

test('profile photos load automatically with the IP privacy tradeoff disclosed', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(source, /const avatarUrl = safeImageUrl\(profile\.avatar\)/);
  assert.doesNotMatch(source, /Show profile photo|data-enable-remote-media/);
  assert.match(html, /Profile photos load automatically · hosts can see your IP/);
});
