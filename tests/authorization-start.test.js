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
  assert.match(flow, /Keep requestFid unset until Castonaut has its own registered app FID/);
  assert.match(flow, /Authorization could not start\. Reload and try again\./);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /CASTONAUT · THIS BROWSER/);
  assert.match(html, /Limited social key for Castonaut/);
  assert.match(html, /Authorize Castonaut/);
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
