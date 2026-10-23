import test from 'node:test';
import assert from 'node:assert/strict';
import { followedFeedSources, paceByAuthor, rankFollowRecommendations } from '../src/feed-ranking.js';

const cast = (fid, timestamp, id = `${fid}-${timestamp}`) => ({ id, data: { fid, timestamp } });
const link = (targetFid) => ({ data: { linkBody: { targetFid } } });

test('paces prolific authors while preserving each author’s newest-first order', () => {
  const source = [cast(1, 9), cast(1, 8), cast(1, 7), cast(2, 6), cast(2, 5), cast(3, 4)];
  const result = paceByAuthor(source);
  assert.deepEqual(result.map((item) => item.data.fid), [1, 1, 2, 3, 1, 2]);
  for (const fid of [1, 2, 3]) {
    const times = result.filter((item) => item.data.fid === fid).map((item) => item.data.timestamp);
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  }
});

test('does not reorder a feed with only one author', () => {
  const source = [cast(1, 3), cast(1, 2), cast(1, 1)];
  assert.deepEqual(paceByAuthor(source), source);
});

test('Following sources are unique and never include the signed-in account', () => {
  assert.deepEqual(followedFeedSources(1, [link(1), link(2), link(2), link(3)]), [2, 3]);
});

test('suggests people supported by multiple followed accounts and excludes self/follows', () => {
  const groups = [
    { sourceFid: 10, messages: [link(20), link(21), link(20), link(1)] },
    { sourceFid: 11, messages: [link(20), link(22), link(10)] },
    { sourceFid: 12, messages: [link(21), link(20)] },
  ];
  assert.deepEqual(rankFollowRecommendations(groups, { ownFid: 1, followingFids: [10, 11, 12], limit: 3 }), [
    { fid: 20, mutualCount: 3 },
    { fid: 21, mutualCount: 2 },
    { fid: 22, mutualCount: 1 },
  ]);
});
