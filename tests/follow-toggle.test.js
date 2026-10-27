import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('unknown follow status is explicit and never presents an unverified toggle state', () => {
  assert.match(source, /function updateFollowButton\(button, fid\)[\s\S]*?const statusUnknown = !state\.following\.has\(targetFid\) \|\| state\.followStatusUnknown\.has\(targetFid\);/);
  assert.match(source, /statusUnknown \? `Check @\$\{profile\?\.username/);
  assert.match(source, /if \(statusUnknown\) button\.removeAttribute\('aria-pressed'\);\s*else button\.setAttribute\('aria-pressed', String\(following\)\);/);
  assert.match(source, /className = 'button button-outline suggested-follow'[\s\S]*?updateFollowButton\(follow, suggestion\.fid\)/);
  assert.doesNotMatch(source, /follow\.disabled = state\.following\.get\(suggestion\.fid\)/);
});

test('a follow click refreshes unknown or stale state before it can follow or unfollow', () => {
  assert.match(source, /const previousStatusKnown = state\.following\.has\(targetFid\) && !state\.followStatusUnknown\.has\(targetFid\);/);
  assert.match(source, /if \(!previousStatusKnown \|\| previousFollowing !== following\)[\s\S]*?setFollowState\(targetFid, following\);[\s\S]*?Tap again to \$\{following \? 'unfollow' : 'follow'\}/);
});

test('like and recast are not shown as inactive until the node confirms their state', () => {
  const start = source.indexOf("const like = document.createElement('button')");
  const end = source.indexOf("const reply = document.createElement('button')", start);
  const initializers = source.slice(start, end);
  assert.match(initializers, /dataset\.reactionState = Number\(state\.fid\) > 0 \? 'loading' : 'unknown'/);
  assert.match(initializers, /setAttribute\('aria-busy', 'true'\)/);
  assert.doesNotMatch(initializers, /setAttribute\('aria-pressed', 'false'\)/);
  const paintStart = source.indexOf('function paintReactionButtonState(');
  const paintEnd = source.indexOf('\nfunction paintEngagementCount(', paintStart);
  const paint = source.slice(paintStart, paintEnd);
  assert.ok(paint.includes("active ? '♥' : '♡'"));
  assert.ok(paint.includes("active ? '✓' : '⟳'"));
  assert.ok(paint.includes("setAttribute('aria-pressed', String(active))"));
  assert.match(source, /button\.dataset\.reactionState = 'unavailable';[\s\S]*?button\.removeAttribute\('aria-pressed'\)/);
});

test('Desk and Saved post controls expose their current state', () => {
  assert.match(source, /deskSignal\.textContent = signalSaved \? '▣' : '⌑'[\s\S]*?deskSignal\.setAttribute\('aria-pressed', String\(signalSaved\)\)/);
  assert.match(source, /flightLog\.textContent = saved \? '★ Saved' : '☆ Save'[\s\S]*?flightLog\.setAttribute\('aria-pressed', String\(saved\)\)/);
});

test('follow and unfollow sign the matching protocol message and update visible controls', () => {
  assert.match(source, /protocol\.makeLinkRemove\(\{ type: 'follow', targetFid \}/);
  assert.match(source, /protocol\.makeLinkAdd\(\{ type: 'follow', targetFid \}/);
  assert.match(source, /signAndRelayRemoval\(message, 'linkById', params/);
  assert.match(source, /signAndRelay\(message, 'linkById', params/);
  assert.ok(source.includes('updateFollowButton(item, targetFid);'));
});
