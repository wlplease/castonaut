import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRepeatedCasts } from '../src/feed-groups.js';

function cast(fid, text, timestamp, embeds = []) {
  return { data: { fid, timestamp, castAddBody: { text, embeds } } };
}

test('groups matching links while keeping the newest post first and unique posts visible', () => {
  const messages = [
    cast(12, 'I voted to stay https://example.com/vote?utm_source=feed', 30),
    cast(13, 'Here is my vote https://www.example.com/vote', 20),
    cast(14, 'A different link https://example.com/other', 10),
  ];
  const groups = groupRepeatedCasts(messages);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].reason, 'link');
  assert.deepEqual(groups[0].messages, messages.slice(0, 2));
  assert.deepEqual(groups[1].messages, [messages[2]]);
});

test('groups identical long text when there is no single shared link', () => {
  const text = 'I just voted to stay and build a techno-optimist community with the Network School Farcaster core team.';
  const groups = groupRepeatedCasts([cast(1, text, 20), cast(2, `  ${text}  `, 10)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'text');
  assert.equal(groups[0].messages.length, 2);
});

test('does not collapse short generic posts or posts with different links', () => {
  const groups = groupRepeatedCasts([
    cast(1, 'gm', 30),
    cast(2, 'gm', 20),
    cast(3, 'Read this https://example.com/a and https://example.com/b', 10),
    cast(4, 'Read this https://example.com/a and https://example.com/c', 5),
  ]);
  assert.equal(groups.length, 4);
});

test('detects links stored as embeds even when cast text differs', () => {
  const groups = groupRepeatedCasts([
    cast(1, 'First take', 20, [{ url: 'https://example.com/story#section' }]),
    cast(2, 'Another take', 10, [{ url: 'https://example.com/story/' }]),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'link');
});
