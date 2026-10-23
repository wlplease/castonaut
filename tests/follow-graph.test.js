import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFollowGraph } from '../src/follow-graph.js';

const link = (fid) => ({ data: { linkBody: { targetFid: fid } } });

test('loads all connected follows across Snapchain cursor pages', async () => {
  const calls = [];
  const pages = new Map([
    ['', { messages: [link(1), link(2), link(2)], nextPageToken: 'page-2' }],
    ['page-2', { messages: [link(3), link(4)] }],
  ]);
  const result = await loadFollowGraph(async (params) => {
    calls.push(params);
    return pages.get(params.pageToken || '');
  }, { ownFid: 1 });

  assert.deepEqual(result, { fids: [2, 3, 4], complete: true, scanned: 5 });
  assert.deepEqual(calls, [
    { pageSize: 100, reverse: true },
    { pageSize: 100, reverse: true, pageToken: 'page-2' },
  ]);
});

test('stops safely on a repeated cursor and reports incomplete graph', async () => {
  let calls = 0;
  const result = await loadFollowGraph(async () => {
    calls += 1;
    return { messages: [link(calls + 10)], nextPageToken: 'same' };
  }, { ownFid: 1 });

  assert.equal(calls, 2);
  assert.equal(result.complete, false);
  assert.deepEqual(result.fids, [11, 12]);
});
