import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('failed refreshes restore the last successful posts for the same feed', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const previousFeed = \{\s*mode: state\.feedMode,\s*targetFid: Number\(state\.feedTargetFid\),\s*casts: state\.casts,/);
  assert.match(source, /const sameFeed = previousFeed\.mode === state\.feedMode && previousFeed\.targetFid === Number\(state\.feedTargetFid\);[\s\S]*?state\.casts = previousFeed\.casts;[\s\S]*?Showing the posts already loaded/);
});
