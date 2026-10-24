import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shared client header preserves every control required by the app entrypoint', async () => {
  const shell = await readFile(new URL('../src/site-shell.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(shell, /oldHeader\.querySelector\('#command-open'\)/);
  assert.match(shell, /if \(commandButton\) accountTools\.append\(commandButton\)/);
  assert.match(shell, /if \(account\) accountTools\.append\(account\)/);
  assert.match(app, /\$\('#command-open'\)\?\.addEventListener\('click'/);
  assert.match(app, /\$\('#open-account'\)\.addEventListener\('click'/);
});

test('standalone guide, field notes, and legal pages use the client theme palettes', async () => {
  const shell = await readFile(new URL('../src/site-shell.js', import.meta.url), 'utf8');
  const themes = await readFile(new URL('../src/soft-reset.css', import.meta.url), 'utf8');
  for (const theme of ['atlas', 'soft-reset', 'night-radio']) {
    assert.match(shell, new RegExp(`<option value="${theme}">`));
    assert.match(themes, new RegExp(`html\\[data-theme="${theme}"\\]`));
  }
  assert.match(themes, /guide-frame \.security-card/);
  assert.match(themes, /\.legal-shell/);
  assert.match(themes, /\.endorse-shell/);
  assert.match(themes, /--page-accent:var\(--accent\)/);
});

test('mobile client masthead reserves space for the brand mark', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /@media\(max-width:620px\)\{\s*\.site-header--client \.site-brand\{min-width:0;gap:7px\}/);
  assert.match(styles, /\.site-header--client \.site-brand img\{display:block;width:32px;height:32px;min-width:32px;flex:0 0 32px;object-fit:contain\}/);
  assert.match(styles, /\.site-header--client \.site-brand small\{display:none\}/);
});
