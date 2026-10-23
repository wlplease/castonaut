import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAST_ATTRIBUTION,
  CAST_LIMIT,
  CAST_SHORT_LIMIT,
  CAST_USER_LIMIT,
  castTypeForText,
  truncateUtf8,
  utf8ByteLength,
  withCastonautAttribution,
} from '../src/cast-attribution.js';

test('casts include Castonaut attribution and use the full long-cast byte limit', () => {
  const attributed = withCastonautAttribution('Hello Farcaster!');
  assert.equal(attributed, `Hello Farcaster!${CAST_ATTRIBUTION}`);
  assert.equal(utf8ByteLength(withCastonautAttribution('x'.repeat(CAST_USER_LIMIT))), CAST_LIMIT);
  assert.equal(CAST_LIMIT, 1024);
});

test('long casts switch protocol type at the short-cast boundary', () => {
  const types = { CAST: 0, LONG_CAST: 1 };
  assert.equal(castTypeForText('x'.repeat(CAST_SHORT_LIMIT), types), types.CAST);
  assert.equal(castTypeForText('x'.repeat(CAST_SHORT_LIMIT + 1), types), types.LONG_CAST);
  assert.equal(castTypeForText('🚀'.repeat(81), types), types.LONG_CAST);
});

test('casts that exceed the attribution-adjusted UTF-8 byte limit are rejected', () => {
  assert.throws(() => withCastonautAttribution('x'.repeat(CAST_USER_LIMIT + 1)), /Shorten this cast/);
  assert.throws(() => withCastonautAttribution(`${'x'.repeat(CAST_USER_LIMIT - 3)}🚀`), /Shorten this cast/);
});

test('truncating by protocol bytes never splits a Unicode code point', () => {
  const text = 'a'.repeat(CAST_USER_LIMIT - 3) + '🚀';
  const truncated = truncateUtf8(text);
  assert.equal(utf8ByteLength(truncated), CAST_USER_LIMIT - 3);
  assert.doesNotMatch(truncated, /\uFFFD/);
});
