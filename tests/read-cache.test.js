import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadCache } from '../src/read-cache.js';

test('read cache expires values and refreshes least-recently-used entries', () => {
  let now = 100;
  const cache = new ReadCache({ maxEntries: 2, maxBytes: 10_000, now: () => now });
  cache.set('a', { value: 1 }, 20);
  cache.set('b', { value: 2 }, 20);
  assert.deepEqual(cache.get('a'), { value: 1 });
  cache.set('c', { value: 3 }, 20);
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual(cache.get('a'), { value: 1 });
  now += 21;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('c'), undefined);
  assert.equal(cache.entries.size, 0);
});

test('read cache enforces memory bounds and can be cleared for a fresh read', () => {
  const cache = new ReadCache({ maxEntries: 2, maxBytes: 100 });
  cache.set('small', { ok: true }, 1000);
  cache.set('large', 'x'.repeat(100), 1000);
  assert.equal(cache.get('large'), undefined);
  cache.clear();
  assert.equal(cache.entries.size, 0);
  assert.equal(cache.bytes, 0);
});
