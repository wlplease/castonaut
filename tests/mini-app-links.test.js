import test from 'node:test';
import assert from 'node:assert/strict';
import { isFarcasterMiniAppLink } from '../src/mini-app-links.js';

test('recognizes canonical Farcaster Mini App links only', () => {
  assert.equal(isFarcasterMiniAppLink('https://farcaster.xyz/miniapps/abc123/my-app'), true);
  assert.equal(isFarcasterMiniAppLink('https://farcaster.xyz/miniapps/abc123/my-app/leaderboard?week=1'), true);
  assert.equal(isFarcasterMiniAppLink('https://farcaster.xyz/miniapps/abc123/my-app?ref=cast'), true);
  assert.equal(isFarcasterMiniAppLink('https://example.com/miniapps/abc123/my-app'), false);
  assert.equal(isFarcasterMiniAppLink('http://farcaster.xyz/miniapps/abc123/my-app'), false);
  assert.equal(isFarcasterMiniAppLink('https://farcaster.xyz/miniapps/abc123'), false);
  assert.equal(isFarcasterMiniAppLink('javascript:alert(1)'), false);
  assert.equal(isFarcasterMiniAppLink('not a URL'), false);
});
