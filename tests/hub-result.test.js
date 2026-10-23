import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resultOrThrow } from '../src/hub-result.js';

test('unwraps Farcaster hex results before signer, reply, and reaction constructors', async () => {
  // @farcaster/core initializes a few old Faker fixtures at import time.
  await import('../src/faker-compat.js');
  const protocol = await import('../src/protocol.js');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const rawKey = `0x${'ab'.repeat(32)}`;
  const wrappedKey = protocol.hexStringToBytes(rawKey);
  const now = protocol.getFarcasterTime();
  const signer = {
    getGaslessSignedKeyRequestMetadata: async () => ({ value: Uint8Array.of(1), isErr: () => false }),
    signKeyAdd: async () => ({ value: new Uint8Array(65).fill(1), isErr: () => false }),
  };
  const options = { fid: 123n, scopes: [protocol.MessageType.CAST_ADD], ttl: 3600, nonce: 1, deadline: Number(now.value) + 3600 };
  const broken = await protocol.makeKeyAddBody({ ...options, key: wrappedKey }, signer);
  assert.match(broken.error.message, /key must be 32 bytes/);

  const keyBytes = resultOrThrow(wrappedKey, 'Could not prepare the browser app key');
  assert.equal(keyBytes.byteLength, 32);
  const fixed = await protocol.makeKeyAddBody({ ...options, key: keyBytes }, signer);
  assert.doesNotMatch(fixed.error?.message || '', /key must be 32 bytes/);
  assert.match(source, /const appKeyBytes = resultOrThrow\(protocol\.hexStringToBytes\(publicKey\)/);
  assert.match(source, /key: appKeyBytes/);
  assert.match(source, /parentCastId = \{ fid: Number\(parent\.fid\), hash: resultOrThrow\(protocol\.hexStringToBytes\(parent\.hash\)/);
  assert.match(source, /targetCastId: \{ fid: targetFid, hash: resultOrThrow\(protocol\.hexStringToBytes\(hash\)/);
});
