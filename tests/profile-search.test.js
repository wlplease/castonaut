import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfileSearch } from '../src/profile-search.js';

test('normalizes case-insensitive handles before Snapchain username lookup', () => {
  assert.equal(normalizeProfileSearch('Balajis.eth'), 'balajis.eth');
  assert.equal(normalizeProfileSearch('@BALAJIS.ETH'), 'balajis.eth');
});

test('accepts Farcaster profile links and FIDs', () => {
  assert.equal(normalizeProfileSearch('https://farcaster.xyz/Balajis.eth/0x1234'), 'balajis.eth');
  assert.equal(normalizeProfileSearch('37'), '37');
});

test('rejects profile links from unrelated sites', () => {
  assert.throws(() => normalizeProfileSearch('https://example.com/balajis.eth'), /Farcaster profile link/);
});
