import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFollowedTimeline } from '../src/followed-timeline.js';

test('Following scans more accounts in bounded batches until it finds enough posts', async () => {
  const requested = [];
  const result = await loadFollowedTimeline(Array.from({ length: 50 }, (_, index) => index + 1), async (fid) => {
    requested.push(fid);
    return fid >= 13 ? [{ fid, timestamp: fid }] : [];
  }, { minPosts: 3, maxSources: 24, batchSize: 6 });

  assert.equal(result.sourceOffset, 18);
  assert.equal(requested.length, 18);
  assert.deepEqual(result.messages.map((message) => message.fid), [13, 14, 15, 16, 17, 18]);
  assert.deepEqual(result.failedFids, []);
});

test('Following returns partial results when individual accounts cannot be read', async () => {
  const result = await loadFollowedTimeline([1, 2, 3], async (fid) => {
    if (fid === 2) throw new Error('offline');
    return [{ fid, timestamp: fid }];
  }, { minPosts: 10, maxSources: 3, batchSize: 3 });

  assert.equal(result.sourceOffset, 3);
  assert.deepEqual(result.failedFids, [2]);
  assert.deepEqual(result.messages.map((message) => message.fid), [1, 3]);
});
