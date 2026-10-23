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
