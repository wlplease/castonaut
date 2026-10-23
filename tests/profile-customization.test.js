import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Macintosh profile cover is selectable, restorable, and local to this device', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /\['platinum', 'Platinum Mac'\]/);
  assert.match(source, /'dusk', 'platinum'\]\.includes\(cover\)/);
  assert.match(source, /profile cover shown only on this device/);
  assert.match(styles, /\.profile-cover\[data-cover="platinum"\]/);
});

test('profile links are restricted to valid handles and opened without opener access', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /function originalProfileUrl\(profile\)[\s\S]*?\^\[a-z\\d\._-\]\{1,32\}\$[\s\S]*?https:\/\/farcaster\.xyz/);
  assert.match(source, /openOriginal\.rel = 'noopener noreferrer'/);
});
