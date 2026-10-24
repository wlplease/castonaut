import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Following renders after the first cursor page without waiting for the account profile lookup', () => {
  const loadStart = source.indexOf('async function loadFeed(');
  const loadEnd = source.indexOf('\nfunction renderFeedMore()', loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.match(load, /fetchFollowGraph\(fid, \{ maxPages: 1, maxFollows: 100 \}/);
  assert.match(load, /state\.feedMode === 'profile' \? fetchProfile\(fid, \{ fresh \}\) : Promise\.resolve\(null\)/);
  assert.match(load, /state\.feedFollowNextPageToken = followGraph\.nextPageToken \|\| ''/);
  assert.match(load, /loadFollowedTimeline\(limitedFids,[\s\S]*?maxSources: 24/);
  assert.match(load, /\.slice\(0, 30\)/);
  assert.match(load, /sort\(\(a, b\) => Number\(b\.data\.timestamp \|\| 0\) - Number\(a\.data\.timestamp \|\| 0\)\)/);
  assert.doesNotMatch(load, /paceByAuthor/);
});

test('Following keeps strict newest first order when more followed accounts are loaded', () => {
  const moreStart = source.indexOf('async function loadMoreFollowed()');
  const moreEnd = source.indexOf('\nfunction renderFeed()', moreStart);
  const loadMore = source.slice(moreStart, moreEnd);
  assert.match(loadMore, /state\.casts\.sort\(\(a, b\) => Number\(b\.data\.timestamp \|\| 0\) - Number\(a\.data\.timestamp \|\| 0\)\)\.slice\(0, 60\)/);
  assert.doesNotMatch(loadMore, /paceByAuthor/);
});

test('Following can continue through cursor pages and offers the user their own posts when quiet', () => {
  assert.match(source, /fetchFollowGraphPage\(state\.fid, state\.feedFollowNextPageToken\)/);
  assert.match(source, /state\.feedSourceOffset < state\.feedSources\.length \|\| !!state\.feedFollowNextPageToken/);
  assert.match(source, /No recent posts in \$\{state\.crewName\}\.[\s\S]*?View your posts/);
  assert.match(source, /Your fixed \$\{state\.crewName\} list[\s\S]*saved Desk topic/);
  assert.match(source, /function renderFocusTopicFilters\(\)/);
});

test('profile feed hides feed navigation controls to keep the profile header focused', () => {
  assert.match(source, /peopleTabs\.hidden = state\.feedMode === 'profile'/);
  assert.match(source, /feedTools\.hidden = state\.feedMode === 'profile'/);
});
