import test from 'node:test';
import assert from 'node:assert/strict';
import { FARCASTER_EPOCH_SECONDS, PROFILE_RECENT_DAYS, profileRecentStartTimestamp } from '../src/profile-feed.js';

test('profile timeline starts at the requested recent-window boundary in Farcaster time', () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  const sevenDaysAgo = Math.floor(now / 1000) - PROFILE_RECENT_DAYS * 86_400;
  assert.equal(profileRecentStartTimestamp(now), sevenDaysAgo - FARCASTER_EPOCH_SECONDS);
});

test('profile recent-window timestamp does not go negative near Farcaster launch', () => {
  assert.equal(profileRecentStartTimestamp(Date.UTC(2021, 0, 2)), 0);
});
