import test from 'node:test';
import assert from 'node:assert/strict';
import { hasLinkEmbed, hasMedia, isGifEmbedUrl, isImageEmbedUrl, isReply, isVideoEmbedUrl, topicsForCast, visibleByFeedOptions, visibleInProfileView } from '../src/feed-curation.js';

const cast = (text, options = {}) => ({ data: { fid: 4, castAddBody: { text, ...options } } });

test('detects reply and media posts from cast data', () => {
  assert.equal(isReply(cast('reply', { parentCastId: { fid: 3, hash: '0xabc' } })), true);
  assert.equal(isReply(cast('original post')), false);
  assert.equal(hasMedia(cast('photo', { embeds: [{ url: 'https://cdn.example/photo.jpg' }] })), true);
  assert.equal(hasMedia(cast('link', { embeds: [{ url: 'https://example.com/article' }] })), false);
  assert.equal(hasMedia(cast('video', { embeds: [{ url: 'https://cdn.example/clip.mp4?token=1' }] })), true);
  assert.equal(hasLinkEmbed(cast('mini app', { embeds: [{ url: 'https://game.example' }] })), true);
  assert.equal(isImageEmbedUrl('https://imagedelivery.net/abc/def/public'), true);
  assert.equal(isImageEmbedUrl('https://cdn.example/photo.png?size=large'), true);
  assert.equal(isImageEmbedUrl('https://media.tenor.com/abc/loop.gif'), true);
  assert.equal(isGifEmbedUrl('https://media.tenor.com/abc/loop.gif'), true);
  assert.equal(isGifEmbedUrl('https://media.tenor.com/abc/loop.webp'), true);
  assert.equal(isGifEmbedUrl('https://example.com/photo.jpg'), false);
  assert.equal(isVideoEmbedUrl('https://cdn.example/clip.mp4?token=1'), true);
  assert.equal(isVideoEmbedUrl('https://example.com/watch/123'), false);
  assert.equal(isImageEmbedUrl('https://example.com/article'), false);
  assert.equal(hasLinkEmbed(cast('plain text')), false);
  assert.equal(hasMedia(cast('just text')), false);
});

test('profile Posts excludes replies and gives replies their own view', () => {
  const post = cast('original post');
  const reply = cast('reply', { parentCastId: { fid: 3, hash: '0xabc' } });
  const mediaReply = cast('reply with image', { parentCastId: { fid: 3, hash: '0xabc' }, embeds: [{ url: 'https://cdn.example/photo.jpg' }] });
  assert.equal(visibleInProfileView(post, 'posts'), true);
  assert.equal(visibleInProfileView(reply, 'posts'), false);
  assert.equal(visibleInProfileView(reply, 'replies'), true);
  assert.equal(visibleInProfileView(post, 'replies'), false);
  assert.equal(visibleInProfileView(mediaReply, 'media'), true);
  assert.equal(visibleInProfileView(reply, 'media'), false);
});

test('extracts safe local mute topics from hashtags and link domains', () => {
  assert.deepEqual(topicsForCast(cast('A #Solana note https://www.example.com/story')), ['#solana', 'site:example.com']);
  assert.deepEqual(topicsForCast(cast('javascript:alert(1)')), []);
});

test('applies reply, media, app-link, and muted-topic filters independently', () => {
  const message = cast('reply #cats', { parentCastId: { fid: 3, hash: '0xabc' }, embeds: [{ url: 'https://example.com/cat.jpg' }] });
  assert.equal(visibleByFeedOptions(message, { repliesOnly: true, mediaOnly: true, appsOnly: true }), true);
  assert.equal(visibleByFeedOptions(message, { repliesOnly: true, mutedTopics: new Set(['#cats']) }), false);
  assert.equal(visibleByFeedOptions(cast('link', { embeds: [{ url: 'https://example.com/app' }] }), { appsOnly: true }), true);
  assert.equal(visibleByFeedOptions(cast('text'), { appsOnly: true }), false);
  assert.equal(visibleByFeedOptions(cast('text'), { repliesOnly: true }), false);
});
