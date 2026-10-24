import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('follow state uses one accessible toggle and allows unfollowing existing follows', () => {
  assert.match(source, /function updateFollowButton\(button, fid\)[\s\S]*?button\.textContent = isSelf \? 'You' : action;[\s\S]*?button\.setAttribute\('aria-pressed', String\(following\)\);[\s\S]*?button\.disabled = isSelf \|\| !state\.signerReady;/);
  assert.match(source, /className = 'button button-outline suggested-follow'[\s\S]*?updateFollowButton\(follow, suggestion\.fid\)/);
  assert.doesNotMatch(source, /follow\.disabled = state\.following\.get\(suggestion\.fid\)/);
});

test('follow and unfollow sign the matching protocol message and update visible controls', () => {
  assert.match(source, /protocol\.makeLinkRemove\(\{ type: 'follow', targetFid \}/);
  assert.match(source, /protocol\.makeLinkAdd\(\{ type: 'follow', targetFid \}/);
  assert.match(source, /signAndRelayRemoval\(message, 'linkById', params/);
  assert.match(source, /signAndRelay\(message, 'linkById', params/);
  assert.ok(source.includes('updateFollowButton(item, targetFid);'));
});
