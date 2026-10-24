import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('search gives profile lookup examples and accurately scopes post search', () => {
  assert.match(html, /id="people-search"[\s\S]*?placeholder="Search @username or paste a profile link"/);
  assert.match(html, /data-profile-example="balajis\.eth"/);
  assert.match(html, /Search posts already loaded in your current feed\./);
  assert.match(main, /async function resolveProfileFid\(rawQuery\)/);
});

test('Search offers curated Network School and Farcaster profiles plus broader builders', () => {
  assert.match(html, /aria-label="People to follow"/);
  assert.match(html, /Network School · Farcaster/);
  assert.match(html, /directory-network-title[\s\S]*?directory-builders-title/);
  assert.match(styles, /\.directory-groups\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(html, /data-profile-example="balajis\.eth"/);
  assert.match(html, /data-profile-example="farcaster"/);
  assert.match(html, /data-profile-example="quazia"[\s\S]*?@quazia/);
  assert.match(html, /Builders &amp; community/);
  assert.match(html, /data-profile-example="jesse\.base\.eth"/);
  for (const handle of ['linda', 'horsefacts.eth', 'z00', 'zaal', 'trish', 'statuette', 'justin', 'pichi', 'borodutch']) {
    assert.ok(html.includes(`data-profile-example="${handle}"`), `missing curated profile ${handle}`);
  }
  assert.match(main, /\$\('#people-query'\)\.value = button\.dataset\.profileExample;\s*searchProfile\(button\.dataset\.profileExample\)/);
});

test('Desk can add a profile directly and labels its personal sections', () => {
  assert.match(html, /id="desk-add-person"/);
  assert.match(html, /id="desk-people-title">People/);
  assert.match(html, /id="desk-saved-title">Saved posts/);
  assert.match(html, /id="desk-topics-title">Topics/);
  assert.match(main, /async function addDeskPerson\(rawQuery\)/);
  assert.match(main, /await toggleDeskPin\(fid, null\)/);
});

test('Desk saved posts reopen inside Castonaut and topic shortcuts open the filtered feed', () => {
  assert.match(main, /data-open-desk-cast/);
  assert.match(main, /Read in Castonaut/);
  assert.match(main, /const savedCast = event\.target\.closest\('\[data-open-desk-cast\]'\)/);
  assert.match(main, /await openConversation\(savedCast\.dataset\.fid, savedCast\.dataset\.hash\)/);
  assert.match(main, /const deskTopic = event\.target\.closest\('\[data-desk-topic\]'\);[\s\S]*?navigate\('feed'\)/);
});
