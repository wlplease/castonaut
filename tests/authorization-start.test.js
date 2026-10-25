import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('authorization catches protocol chunk loading failures and reports a recoverable state', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /function clientErrorText\(error\)[\s\S]*?This Castonaut tab is out of date\. Refresh the page and try again/);
  const start = source.indexOf('async function authorizeSigner(');
  const end = source.indexOf('\nasync function checkSavedSigner', start);
  assert.ok(start >= 0 && end > start, 'authorization flow is present');
  const flow = source.slice(start, end);
  assert.ok(flow.indexOf('  try {') < flow.indexOf("await import('./protocol.js')"), 'protocol import runs inside the guarded flow');
  assert.match(flow, /Preparing Castonaut’s limited browser-key authorization/);
  assert.match(flow, /Authorize Castonaut’s limited browser key/);
  assert.match(flow, /requestFid defaults to this user's FID/);
  assert.match(flow, /Authorization could not start\. Reload and try again\./);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /CASTONAUT · THIS BROWSER/);
  assert.match(html, /Separate Farcaster social signer/);
  assert.match(html, /Three steps: identify your account[\s\S]*register a separate limited social key/);
});

test('saved authorization can be resumed without entering the recovery phrase again', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('async function resumeSavedKeyAdd(');
  const end = source.indexOf('\nfunction beginSignerRefresh()', start);
  assert.ok(start >= 0 && end > start, 'saved request recovery flow is present');
  const flow = source.slice(start, end);
  assert.match(flow, /saved\.signedKeyAdd/);
  assert.match(flow, /submitEncodedMessage\(encoded\)/);
  assert.doesNotMatch(flow, /connectWithRecoveryPhrase|createBrowserSigner|ViemLocalEip712Signer/);
  assert.match(html, /id="resume-signer"[^>]*>Resume saved request/);
  assert.match(source, /\$\('#resume-signer'\)\.addEventListener\('click', \(\) => resumeSavedKeyAdd\(\)\)/);
  const catchFlow = flow.slice(flow.lastIndexOf('} catch (error) {'));
  assert.match(catchFlow, /const rejected = error\?\.status[\s\S]*?state\.hasPendingKeyAdd = true/);
  assert.doesNotMatch(catchFlow, /await clearPendingRegistration\(\)/);
});

test('linked-wallet sign-in proceeds directly to the wallet authorization prompt after account lookup', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function beginWalletConnection(');
  const end = source.indexOf('\nasync function connectWithRecoveryPhrase', start);
  assert.ok(start >= 0 && end > start, 'wallet connection flow is present');
  const flow = source.slice(start, end);
  assert.match(flow, /Farcaster account found · FID \$\{fid\}\. Review the limited app-key request in your wallet/);
  assert.match(flow, /await authorizeSigner\(null, pendingWalletAccount\)/);
});
