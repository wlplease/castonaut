import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('authorization catches protocol chunk loading failures and reports a recoverable state', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function authorizeSigner(');
  const end = source.indexOf('\nasync function checkSavedSigner', start);
  assert.ok(start >= 0 && end > start, 'authorization flow is present');
  const flow = source.slice(start, end);
  assert.ok(flow.indexOf('  try {') < flow.indexOf("await import('./protocol.js')"), 'protocol import runs inside the guarded flow');
  assert.match(flow, /Preparing secure app-key authorization/);
  assert.match(flow, /Authorization could not start\. Reload and try again\./);
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
