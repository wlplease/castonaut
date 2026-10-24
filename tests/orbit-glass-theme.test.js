import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, html, css] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('duplicate Orbit Glass theme is removed and old saved preferences migrate to Spacebar', () => {
  assert.doesNotMatch(html, /value="orbit-glass"/);
  assert.match(main, /const validThemes = \['atlas', 'soft-reset', 'night-radio'\]/);
  assert.match(main, /theme === 'orbit-glass'[\s\S]*?setItem\(THEME_STORAGE, 'atlas'\)/);
  assert.match(main, /\['atlas', 'soft-reset', 'night-radio', 'orbit-glass'\]/); // Keep older exported backups importable.
  assert.doesNotMatch(css, /data-theme="orbit-glass"/);
});

test('Desk notepad saves locally and only copies into the composer after a deliberate click', () => {
  assert.match(html, /id="desk-notepad-text" maxlength="4000"/);
  assert.match(main, /localStorage\.setItem\(DESK_NOTEPAD_STORAGE, deskNotepad\.value\.slice\(0, 4000\)\)/);
  assert.match(main, /desk-note-to-cast.*addEventListener\('click'/);
  assert.match(main, /Copied to the composer\. Review it before posting\./);
  assert.ok(!main.includes('DESK_NOTEPAD_STORAGE, deskNotepad.value);\n    void nodeRequest'));
});
