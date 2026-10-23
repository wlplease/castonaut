import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('search gives profile lookup examples and accurately scopes post search', () => {
  assert.match(html, /id="people-search"[\s\S]*?placeholder="Search @username or paste a profile link"/);
  assert.match(html, /data-profile-example="balajis\.eth"/);
  assert.match(html, /Search posts already loaded in your current feed\./);
  assert.match(main, /async function resolveProfileFid\(rawQuery\)/);
});

test('Desk can add a profile directly and labels its personal sections', () => {
  assert.match(html, /id="desk-add-person"/);
  assert.match(html, /id="desk-people-title">People/);
  assert.match(html, /id="desk-saved-title">Saved posts/);
  assert.match(html, /id="desk-topics-title">Topics/);
  assert.match(main, /async function addDeskPerson\(rawQuery\)/);
  assert.match(main, /await toggleDeskPin\(fid, null\)/);
});
