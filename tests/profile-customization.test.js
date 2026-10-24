import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Macintosh profile cover is selectable, restorable, and local to this device', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /\['platinum', 'Platinum Mac'\]/);
  assert.match(source, /'dusk', 'platinum'\]\.includes\(cover\)/);
  assert.match(source, /profile cover shown only on this device/);
  assert.match(styles, /\.profile-cover\[data-cover="platinum"\]/);
});

test('profile links are restricted to valid handles and opened without opener access', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /function originalProfileUrl\(profile\)[\s\S]*?\^\[a-z\\d\._-\]\{1,32\}\$[\s\S]*?https:\/\/farcaster\.xyz/);
  assert.match(source, /openOriginal\.rel = 'noopener noreferrer'/);
});

test('profile timelines prioritize the last week and keep earlier history available by cursor', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const profileFeed = await readFile(new URL('../src/profile-feed.js', import.meta.url), 'utf8');
  assert.match(source, /state\.feedMode === 'profile' \? 100 : 10/);
  assert.match(source, /const messages = state\.feedMode === 'profile' \? newestFirst : paceByAuthor\(newestFirst\)\.slice\(0, 30\)/);
  assert.match(source, /state\.profileNextPageToken = castGroups\[0\]\?\.nextPageToken \|\| ''/);
  assert.match(source, /startTimestamp: state\.profileWindowStart/);
  assert.match(source, /stopTimestamp: state\.profileWindowStart/);
  assert.match(source, /pageSize: 100, reverse: true/);
  assert.match(source, /state\.profileSeenPageTokens\.has\(nextPageToken\)/);
  assert.match(source, /More from this week/);
  assert.match(source, /Load earlier posts/);
  assert.match(source, /state\.feedMode === 'profile' \? loadOlderProfilePosts\(\) : loadMoreFollowed\(\)/);
  assert.match(source, /Number\(b\.data\.timestamp \|\| 0\) - Number\(a\.data\.timestamp \|\| 0\)/);
  assert.match(profileFeed, /PROFILE_RECENT_DAYS = 7/);
});

test('profile lookups retry after transient or empty responses instead of memoizing placeholders', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /if \(existing\?\.profileLoaded && !fresh\) return existing/);
  assert.match(source, /catch \{ return existing \|\| \{ fid, name: `Farcaster \$\{fid\}`/);
  assert.match(source, /if \(!messages\.length\) return existing \|\| \{ fid, name: `Farcaster \$\{fid\}`/);
  assert.match(source, /profileLoaded: true/);
});

test('public profile and post reads use a bounded short cache with an explicit fresh path', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const cache = await readFile(new URL('../src/read-cache.js', import.meta.url), 'utf8');
  assert.match(source, /READ_CACHE_TTL = \{ info: 10_000, casts: 8_000, replies: 8_000, castById: 30_000, userData: 60_000, username: 60_000 \}/);
  assert.match(source, /loadFeed\(fidValue = state\.fid, mode = state\.feedMode, \{ fresh = false \} = \{\}\)/);
  assert.match(source, /clearSnapchainReadCache\(\)/);
  assert.match(cache, /maxEntries = 32, maxBytes = 2_000_000/);
  assert.match(cache, /expiresAt <= this\.now\(\)/);
});
