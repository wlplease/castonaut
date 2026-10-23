import test from 'node:test';
import assert from 'node:assert/strict';
import { CAST_ATTRIBUTION, CAST_LIMIT, CAST_USER_LIMIT, withCastonautAttribution } from '../src/cast-attribution.js';

test('new casts carry the clean Castonaut site attribution within the protocol limit', () => {
  const attributed = withCastonautAttribution('Hello Farcaster!');
  assert.equal(attributed, `Hello Farcaster!${CAST_ATTRIBUTION}`);
  assert.ok([...attributed].length <= CAST_LIMIT);
  assert.equal([...withCastonautAttribution('x'.repeat(CAST_USER_LIMIT))].length, CAST_LIMIT);
});

test('casts that cannot fit the attribution are rejected before signing', () => {
  assert.throws(() => withCastonautAttribution('x'.repeat(CAST_USER_LIMIT + 1)), /Shorten this cast/);
});
