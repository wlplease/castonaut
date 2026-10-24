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
