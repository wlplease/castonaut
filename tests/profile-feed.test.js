import test from 'node:test';
import assert from 'node:assert/strict';
import { FARCASTER_EPOCH_SECONDS, PROFILE_INITIAL_PAGE_LIMIT, PROFILE_PAGE_SIZE, PROFILE_RECENT_DAYS, fetchProfilePages, profileRecentStartTimestamp } from '../src/profile-feed.js';

test('profile timeline starts at the requested recent-window boundary in Farcaster time', () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  const thirtyDaysAgo = Math.floor(now / 1000) - PROFILE_RECENT_DAYS * 86_400;
  assert.equal(PROFILE_RECENT_DAYS, 30);
  assert.equal(profileRecentStartTimestamp(now), thirtyDaysAgo - FARCASTER_EPOCH_SECONDS);
});

test('profile recent-window timestamp does not go negative near Farcaster launch', () => {
  assert.equal(profileRecentStartTimestamp(Date.UTC(2021, 0, 2)), 0);
});

test('busy profile loads several bounded recent pages and preserves the next cursor', async () => {
  const calls = [];
  const result = await fetchProfilePages(async (params) => {
    calls.push(params);
    const index = calls.length;
    return { messages: [{ id: index, data: { castAddBody: {} } }], nextPageToken: `cursor-${index}` };
  }, { fid: 37, startTimestamp: 10 });
  assert.equal(calls.length, PROFILE_INITIAL_PAGE_LIMIT);
  assert.equal(result.messages.length, PROFILE_INITIAL_PAGE_LIMIT);
  assert.equal(calls[0].pageSize, PROFILE_PAGE_SIZE);
  assert.equal(calls[0].startTimestamp, 10);
  assert.equal(calls[0].reverse, true);
  assert.equal(calls[1].pageToken, 'cursor-1');
  assert.equal(result.nextPageToken, `cursor-${PROFILE_INITIAL_PAGE_LIMIT}`);
});

test('profile page loading stops safely if Snapchain repeats a cursor', async () => {
  let calls = 0;
  const result = await fetchProfilePages(async () => {
    calls++;
    return { messages: [{ id: calls, data: { castAddBody: {} } }], nextPageToken: 'repeated' };
  }, { fid: 37, startTimestamp: 10 });
  assert.equal(calls, 2);
  assert.equal(result.nextPageToken, '');
});
