import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('managed session restores before a saved browser key and does not downgrade silently', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function restoreSession()');
  const end = source.indexOf('\nasync function clearLocalSigner()', start);
  const restore = source.slice(start, end);
  assert.ok(start >= 0 && end > start, 'session restoration flow is present');
  assert.ok(restore.indexOf("managedAuthRequest('me')") < restore.indexOf('saved = await loadSigner()'), 'managed preference is checked before restoring a browser key');
  assert.match(restore, /preferredMode === 'neynar'[\s\S]*?Your managed Farcaster session expired or was revoked/);
  assert.match(restore, /Could not verify your managed Farcaster session/);
});

test('sign-in mode is remembered and Forget this browser clears both sign-in paths', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /localStorage\.setItem\(SIGN_IN_MODE_STORAGE, 'neynar'\)/);
  assert.match(source, /localStorage\.setItem\(SIGN_IN_MODE_STORAGE, 'browser'\)/);
  const start = source.indexOf('async function clearLocalSigner()');
  const end = source.indexOf('\nfunction updatePrimaryNav', start);
  const logout = source.slice(start, end);
  assert.match(logout, /managedAuthRequest\('logout'/);
  assert.match(logout, /const cleared = await removeStoredSigner\(\)/);
  assert.match(logout, /localStorage\.removeItem\(SIGN_IN_MODE_STORAGE\)/);
});
