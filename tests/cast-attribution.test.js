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

test('the installed Farcaster SDK accepts short and long casts through 1,024 bytes', async () => {
  // @farcaster/core initializes a few old Faker fixtures at import time.
  await import('../src/faker-compat.js');
  const { CastType, FarcasterNetwork, makeCastAddData } = await import('@farcaster/core');
  const makeBody = (text) => ({
    text,
    type: castTypeForText(text, CastType),
    embeds: [],
    embedsDeprecated: [],
    mentions: [],
    mentionsPositions: [],
  });
  const options = { fid: 1, network: FarcasterNetwork.MAINNET };
  assert.equal((await makeCastAddData(makeBody('x'.repeat(320)), options)).isOk(), true);
  assert.equal((await makeCastAddData(makeBody('x'.repeat(321)), options)).isOk(), true);
  assert.equal((await makeCastAddData(makeBody(withCastonautAttribution('x'.repeat(CAST_USER_LIMIT))), options)).isOk(), true);
});
