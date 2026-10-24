import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('desktop profile covers are selectable, restorable, and local to this device', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /\['platinum', 'Spacebar Silver'\]/);
  assert.match(source, /'blueberry', 'graphite'\]\s*\.includes\(cover\)/);
  assert.match(source, /profile cover shown only on this device/);
  assert.match(styles, /\.profile-cover\[data-cover="platinum"\]/);
  assert.match(styles, /\.profile-cover\[data-cover="blueberry"\]/);
  assert.match(styles, /\.profile-cover\[data-cover="graphite"\]/);
});

test('active profile media and the first feed cards load promptly while later cards stay lazy', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /image\.loading = priority \? 'eager' : 'lazy'/);
  assert.match(source, /image\.fetchPriority = 'high'/);
  assert.match(source, /setRemoteAvatar\(avatar, avatarUrl, \{ priority: true \}\)/);
  assert.match(source, /makeRemoteImage\(bannerUrl, 'profile-cover-image', \{ priority: true \}\)/);
  assert.match(source, /function renderCast\(message, \{ priority = false \} = \{\}\)/);
  assert.match(source, /groups\.forEach\(\(group, index\) => \{\s*const priority = index < 3/);
  assert.match(source, /makeRemoteImage\(mediaUrl\.href, 'post-image', \{ priority \}\)/);
});

test('feed shows loading placeholders for profiles and images, with open-original link cards', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /container\.classList\.add\('avatar-loading'\)/);
  assert.match(source, /className = 'post-image-frame';[\s\S]*?setAttribute\('aria-busy', 'true'\)/);
  assert.match(source, /mediaCaption\.append\(mediaKind, mediaOpen\)/);
  assert.match(source, /domain\.textContent = isMiniApp \? 'Farcaster Mini App' : previewUrl\.hostname\.replace\(\/\^www\\\.\/i, ''\)/);
  assert.match(source, /isFarcasterMiniAppLink\(previewUrl\)/);
  assert.match(styles, /\.post-image-frame\.is-loading::after[\s\S]*?Loading image/);
  assert.match(styles, /\.post-avatar\.avatar-loading/);
});

test('post media is on by default and its privacy control lives in the user profile', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /savedMediaPreference === null \|\| savedMediaPreference === 'true'/);
  assert.match(source, /if \(isOwnProfile\) \{[\s\S]*?profile-media-option[\s\S]*?Load GIFs and post images[\s\S]*?Media hosts can see your IP address/);
  assert.match(source, /document\.addEventListener\('change', \(event\) => \{\s*if \(!event\.target\.matches\('#external-images'\)\) return;/);
  assert.doesNotMatch(html, /id="media-toggle"|id="external-images"/);
  assert.match(styles, /\.profile-media-option/);
});

test('profile links are restricted to valid handles and opened without opener access', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /function originalProfileUrl\(profile\)[\s\S]*?\^\[a-z\\d\._-\]\{1,32\}\$[\s\S]*?https:\/\/farcaster\.xyz/);
  assert.match(source, /openOriginal\.rel = 'noopener noreferrer'/);
});

test('profile timelines load the last month and keep earlier history available by cursor', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const profileFeed = await readFile(new URL('../src/profile-feed.js', import.meta.url), 'utf8');
  assert.match(source, /fetchProfilePages\(/);
  assert.match(source, /const messages = state\.feedMode === 'profile' \? newestFirst : newestFirst\.slice\(0, 30\)/);
  assert.match(source, /state\.profileNextPageToken = castGroups\[0\]\?\.nextPageToken \|\| ''/);
  assert.match(source, /startTimestamp: state\.profileWindowStart/);
  assert.match(source, /stopTimestamp: state\.profileWindowStart/);
  assert.match(source, /pageSize: 100, reverse: true/);
  assert.match(source, /state\.profileSeenPageTokens\.has\(nextPageToken\)/);
  assert.match(source, /More from this month/);
  assert.match(source, /Load earlier posts/);
  assert.match(source, /state\.feedMode === 'profile' \? loadOlderProfilePosts\(\) : loadMoreFollowed\(\)/);
  assert.match(source, /Number\(b\.data\.timestamp \|\| 0\) - Number\(a\.data\.timestamp \|\| 0\)/);
  assert.match(profileFeed, /PROFILE_RECENT_DAYS = 30/);
  assert.match(profileFeed, /PROFILE_INITIAL_PAGE_LIMIT = 5/);
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
  assert.match(source, /READ_CACHE_TTL = \{ info: 10_000, casts: 8_000, replies: 8_000, links: 30_000, castById: 30_000, reactionsByCast: 20_000, userData: 60_000, username: 60_000 \}/);
  assert.match(source, /DEVICE_READ_CACHE_TTL = \{ casts: 120_000, replies: 60_000, links: 900_000/);
  assert.match(source, /deviceReadCache\.get\(cacheKey\)/);
  assert.match(source, /loadFeed\(fidValue = state\.fid, mode = state\.feedMode, \{ fresh = false \} = \{\}\)/);
  assert.match(source, /clearSnapchainReadCache\(\)/);
  assert.match(cache, /maxEntries = 32, maxBytes = 2_000_000/);
  assert.match(cache, /expiresAt <= this\.now\(\)/);
});
