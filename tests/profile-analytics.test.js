import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDays, summarizeProfileActivity } from '../src/profile-analytics.js';

const EPOCH = 1_609_459_200;
const now = Date.UTC(2026, 9, 23, 12);
const recent = Math.floor(now / 1000) - EPOCH - 2 * 86_400;

function cast({ timestamp = recent, text = 'hello', reply = false, media = false } = {}) {
  return { data: { timestamp, castAddBody: { text, ...(reply ? { parentCastId: { fid: 1, hash: '0xabc' } } : {}), ...(media ? { embeds: [{ url: 'https://example.com/image.png' }] } : {}) } } };
}

test('summarizes only supplied profile casts and computes useful activity counts', () => {
  const result = summarizeProfileActivity([
    cast({ text: 'hello there', media: true }),
    cast({ text: 'reply', reply: true }),
    cast({ timestamp: recent - 12 * 86_400, text: 'older post' }),
  ], now);
  const { dailyPosts, ...summary } = result;
  assert.deepEqual(summary, { loaded: 3, posts: 2, replies: 1, media: 1, recent: 2, activeDays: 2, averageLength: 11 });
  assert.equal(dailyPosts.length, 7);
  assert.equal(dailyPosts.reduce((total, day) => total + day.count, 0), 1);
  assert.equal(dailyPosts.at(-1).label, 'Today');
});

test('empty profile activity is zeroed and malformed inputs are ignored', () => {
  const result = summarizeProfileActivity([null, { data: {} }], now);
  const { dailyPosts, ...summary } = result;
  assert.deepEqual(summary, { loaded: 0, posts: 0, replies: 0, media: 0, recent: 0, activeDays: 0, averageLength: 0 });
  assert.equal(dailyPosts.length, 7);
  assert.equal(dailyPosts.every((day) => day.count === 0), true);
});

test('seven-day rhythm uses original posts only and ignores future timestamps', () => {
  const today = Math.floor(now / 1000) - EPOCH;
  const bins = activityDays([cast({ timestamp: today }), cast({ timestamp: today, reply: true }), cast({ timestamp: today + 10_000 })], now);
  assert.equal(bins.at(-1).count, 1);
  assert.equal(bins.reduce((total, day) => total + day.count, 0), 1);
});
