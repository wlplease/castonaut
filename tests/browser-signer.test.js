import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { BrowserEd25519Signer } from '../src/browser-signer.js';

test('browser signer marks envelopes Ed25519 and signs message hashes', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const signer = new BrowserEd25519Signer(pair.privateKey, publicKey);
  const hash = new Uint8Array([1, 2, 3, 4]);
  const signatureResult = await signer.signMessageHash(hash);
  const keyResult = await signer.getSignerKey();

  assert.equal(signer.scheme, 1, 'Farcaster SignatureScheme.ED25519 is enum value 1');
  assert.equal(keyResult.isErr(), false);
  assert.deepEqual(keyResult.value, publicKey);
  assert.equal(signatureResult.isErr(), false);
  assert.equal(await webcrypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, signatureResult.value, hash), true);
});
