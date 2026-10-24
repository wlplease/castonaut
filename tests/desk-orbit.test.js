import assert from 'node:assert/strict';
import test from 'node:test';
import { recentOrbitCasts, summarizeOrbitActivity } from '../src/desk-orbit.js';

function cast(fid, timestamp, reply = false) {
  return { data: { fid, timestamp, castAddBody: { text: `cast ${timestamp}`, ...(reply ? { parentCastId: { fid: 99, hash: '0xabc' } } : {}) } } };
}

test('Desk Orbit shows newest original posts from pinned people only', () => {
  const older = cast(7, 10);
  const newest = cast(7, 30);
  const result = recentOrbitCasts([older, cast(7, 40, true), cast(8, 50), newest], [7], 2);
  assert.deepEqual(result, [newest, older]);
});

test('Desk Orbit handles empty pins and caps the requested list size', () => {
  const casts = Array.from({ length: 12 }, (_, index) => cast(7, index));
  assert.deepEqual(recentOrbitCasts(casts, []), []);
  assert.equal(recentOrbitCasts(casts, [7], 40).length, 8);
});

test('Desk pulse summarizes only loaded original posts from pinned people', () => {
  const now = Date.UTC(2026, 9, 23, 12);
  const nowFarcaster = Math.floor(now / 1000) - 1_609_459_200;
  const result = summarizeOrbitActivity([
    cast(7, nowFarcaster),
    cast(7, nowFarcaster - 10 * 86_400),
    cast(7, nowFarcaster, true),
    cast(8, nowFarcaster),
  ], [7], now);
  assert.equal(result.loaded, 2);
  assert.equal(result.thisWeek, 1);
  assert.equal(result.activePeople, 1);
  assert.equal(result.dailyPosts.reduce((sum, day) => sum + day.count, 0), 1);
});
