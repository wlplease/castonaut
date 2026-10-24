import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('node calls and signer confirmation stay bounded and explain recovery after approval', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const requestStart = source.indexOf('async function nodeRequest(');
  const requestEnd = source.indexOf('\nfunction asFid(', requestStart);
  const request = source.slice(requestStart, requestEnd);
  assert.match(request, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
  assert.match(request, /signed key is saved in this browser/i);
  assert.match(request, /error\.status = response\.status/);

  const waitStart = source.indexOf('async function waitForSigner(');
  const waitEnd = source.indexOf('\nasync function authorizeSigner', waitStart);
  const wait = source.slice(waitStart, waitEnd);
  assert.match(wait, /tries = 6/);
  assert.match(wait, /catch \(error\)/);
  assert.match(wait, /Too many requests\|\\\(429\\\)/);
  assert.match(wait, /onProgress\(i \+ 1, tries\)/);

  const authStart = source.indexOf('async function authorizeSigner(');
  const authEnd = source.indexOf('\nasync function checkSavedSigner', authStart);
  const auth = source.slice(authStart, authEnd);
  assert.match(auth, /Waiting for confirmation · \$\{attempt\}\/\$\{total\}/);
  assert.match(auth, /Check again in a moment/);

  const checkStart = source.indexOf('async function checkSavedSigner(');
  const checkEnd = source.indexOf('\nasync function resumeSavedKeyAdd', checkStart);
  const check = source.slice(checkStart, checkEnd);
  assert.match(check, /findSigner\(state\.fid, state\.publicKey\)/);
  assert.match(check, /canRetry: true, canResume: state\.hasPendingKeyAdd, canRefresh: !state\.hasPendingKeyAdd/);
  assert.match(check, /Resume the exact saved request first/);
  assert.doesNotMatch(check, /submitEncodedMessage|replayError/);

  const refreshStart = source.indexOf('async function authorizeSigner(');
  const refreshEnd = source.indexOf('\nasync function checkSavedSigner', refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);
  assert.match(refresh, /if \(refreshSignerFlow\)[\s\S]*?Number\(saved\.fid\) !== Number\(fid\)/);
  assert.match(refresh, /privateKey = saved\.privateKey/);
  assert.match(refresh, /new BrowserEd25519Signer\(privateKey, publicKeyBytes\)/);
  assert.match(refresh, /else \{\s*\(\{ signer, publicKey: publicKeyBytes, privateKey \} = await createBrowserSigner\(\)\)/);
  assert.match(html, /id="refresh-signer"[^>]*>Approve Castonaut key again/);
  assert.match(source, /\$\('#refresh-signer'\)\.addEventListener\('click', beginSignerRefresh\)/);
});

test('restored accounts load the feed after signer confirmation with no payment gate', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const restoreStart = source.indexOf('async function restoreSession()');
  const restoreEnd = source.indexOf('\nasync function clearLocalSigner()', restoreStart);
  const restore = source.slice(restoreStart, restoreEnd);
  assert.match(restore, /await fetchProfile\(state\.fid\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(restore, /if \(state\.signerReady\) await fetchProfile\(state\.fid\)/);
  assert.match(restore, /else \{[\s\S]*?await loadFeed\(state\.fid\)/);
  assert.doesNotMatch(restore, /else if \(passActive\)/);
  assert.doesNotMatch(source, /Time Pass|VITE_PASS_CONTRACT_ADDRESS|buyTimePass|pass-gate|\$3\.70/);

  const identityStart = source.indexOf('function renderIdentity()');
  const identityEnd = source.indexOf('\nasync function restoreSession()', identityStart);
  const identity = source.slice(identityStart, identityEnd);
  assert.match(identity, /const ready = accountReady/);
});

test('startup restores the browser signer before inviting another sign-in', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /indexedDB\.open\(SIGNER_DB, 1\)/);
  assert.match(source, /objectStore\(SIGNER_STORE\)\.put\(\{ \.\.\.record, id: 'active' \}\)/);
  assert.match(source, /objectStore\(SIGNER_STORE\)\.get\('active'\)/);
  assert.match(source, /sessionRestoring: true/);
  assert.match(source, /if \(state\.sessionRestoring\) \{\s*setNotice\('Checking this browser for your saved sign-in/);
  assert.match(source, /restoreSession\(\)\.catch\([\s\S]*?\)\.finally\(\(\) => \{\s*state\.sessionRestoring = false;\s*renderIdentity\(\);\s*applyLocationRoute\(\);/);
  assert.match(source, /\$\('#portal-enter'\)\.disabled = state\.sessionRestoring/);
});
