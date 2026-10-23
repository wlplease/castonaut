import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAddress } from 'viem';

test('Farcaster ID Registry uses its complete canonical Optimism address', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const match = source.match(/const ID_REGISTRY_ADDRESS = '(0x[0-9a-fA-F]+)'/);
  assert.ok(match, 'ID Registry address is defined');
  assert.equal(match[1], '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b');
  assert.equal(match[1].length, 42);
  assert.equal(match[1], getAddress(match[1].toLowerCase()));
});
