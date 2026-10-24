import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('quick controls mirror the existing local feed preferences', () => {
  for (const setting of ['compactMode', 'remoteMediaEnabled', 'repliesOnly', 'mediaOnly', 'appsOnly', 'groupRepeats']) {
    assert.match(html, new RegExp(`data-quick-setting="${setting}"`));
  }
  assert.match(source, /syncQuickControls\(\)/);
  assert.match(source, /setRemoteMediaEnabled\(event\.target\.checked\)/);
  assert.match(html, /id="quick-controls-more"/);
});

test('saved casts support device-local notes and the three Desk labels', () => {
  for (const label of ['Read later', 'Idea', 'Keep']) assert.ok(source.includes(`'${label}'`));
  assert.match(source, /data-desk-cast-note/);
  assert.match(source, /data-desk-cast-label/);
  assert.match(source, /localStorage\.setItem\(DESK_CASTS_STORAGE, JSON\.stringify\(state\.deskCasts\)\)/);
});

test('command launcher includes personal Desk shortcuts and handles deep links', () => {
  assert.match(html, /id="command-personal-items"/);
  assert.match(source, /PINNED PEOPLE/);
  assert.match(source, /SAVED CASTS/);
  assert.match(source, /PINNED TOPICS/);
  assert.match(source, /commandCastFid/);
  assert.match(source, /commandTopic/);
});

test('desktop drag-save keeps the button and supports dropping onto Desk', () => {
  assert.match(source, /deskSignal\.draggable = !matchMedia\('\(pointer: coarse\)'\)\.matches/);
  assert.match(source, /application\/x-castonaut-desk-cast/);
  assert.match(source, /\[data-view="desk"\], #desk-casts/);
  assert.match(source, /Save cast to Desk/);
  assert.match(css, /\.nav-item\[data-view="desk"\]\.is-drop-target/);
});

test('phone layout keeps the feed, composer, profile, and dock inside the viewport', () => {
  assert.match(css, /Unified phone layout: stable header, simple bottom dock/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(0,1fr\)\)/);
  assert.match(css, /\.composer textarea\{width:100%;min-height:102px/);
  assert.match(css, /\.post-actions\{display:flex;flex-wrap:nowrap;justify-content:space-between/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
