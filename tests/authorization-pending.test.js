import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('node calls and signer confirmation stay bounded and explain recovery after approval', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const requestStart = source.indexOf('async function nodeRequest(');
  const requestEnd = source.indexOf('\nfunction asFid(', requestStart);
  const request = source.slice(requestStart, requestEnd);
  assert.match(request, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
  assert.match(request, /signed key is saved in this browser/i);

  const waitStart = source.indexOf('async function waitForSigner(');
  const waitEnd = source.indexOf('\nasync function authorizeSigner', waitStart);
  const wait = source.slice(waitStart, waitEnd);
  assert.match(wait, /tries = 6/);
  assert.match(wait, /catch \{/);
  assert.match(wait, /onProgress\(i \+ 1, tries\)/);

  const authStart = source.indexOf('async function authorizeSigner(');
  const authEnd = source.indexOf('\nasync function checkSavedSigner', authStart);
  const auth = source.slice(authStart, authEnd);
  assert.match(auth, /Waiting for confirmation · \$\{attempt\}\/\$\{total\}/);
  assert.match(auth, /Check again in a moment/);
});
