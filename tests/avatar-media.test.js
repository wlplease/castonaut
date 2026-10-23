import test from 'node:test';
import assert from 'node:assert/strict';
import { isVideoAvatarUrl } from '../src/avatar-media.js';

test('detects HTTPS video profile pictures including query strings', () => {
  assert.equal(isVideoAvatarUrl('https://cdn.example/pfp.mp4?size=96'), true);
  assert.equal(isVideoAvatarUrl('https://cdn.example/pfp.webm#frame=1'), true);
});

test('keeps animated image formats as images and rejects unsafe video URLs', () => {
  assert.equal(isVideoAvatarUrl('https://cdn.example/pfp.gif'), false);
  assert.equal(isVideoAvatarUrl('https://cdn.example/pfp.webp'), false);
  assert.equal(isVideoAvatarUrl('http://cdn.example/pfp.mp4'), false);
  assert.equal(isVideoAvatarUrl('javascript:alert(1)'), false);
  assert.equal(isVideoAvatarUrl('not a URL'), false);
});
