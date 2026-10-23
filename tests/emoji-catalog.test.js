import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_CATALOG, searchEmojis } from '../src/emoji-catalog.js';

test('emoji search covers a broad local catalog and supports useful word matches', () => {
  assert.ok(EMOJI_CATALOG.length >= 100);
  assert.ok(searchEmojis('rocket').some(([emoji]) => emoji === '🚀'));
  assert.ok(searchEmojis('galaxy').some(([emoji]) => emoji === '🌌'));
  assert.ok(searchEmojis('hello').some(([emoji]) => emoji === '👋'));
  assert.equal(searchEmojis('no such emoji').length, 0);
});
