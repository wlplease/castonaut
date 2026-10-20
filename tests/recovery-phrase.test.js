import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupportedRecoveryPhraseLength, takeRecoveryPhrase } from '../src/recovery-phrase.js';
import { readFile } from 'node:fs/promises';

test('taking a recovery phrase normalizes and clears the field immediately', () => {
  const field = { value: '  ALPHA   BRAVO\nCHARLIE  ' };
  assert.equal(takeRecoveryPhrase(field), 'alpha bravo charlie');
  assert.equal(field.value, '');
});

test('supported phrase lengths are checked without retaining or transmitting phrase data', () => {
  for (const size of [12, 15, 18, 21, 24]) assert.equal(isSupportedRecoveryPhraseLength(Array(size).fill('word').join(' ')), true);
  for (const size of [0, 1, 11, 13, 25]) assert.equal(isSupportedRecoveryPhraseLength(Array(size).fill('word').join(' ')), false);
});

test('active recovery flow does not store or transmit the phrase and clears the derived account on dialog close', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const headers = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(source, /let phrase = takeRecoveryPhrase\(phraseField\);/);
  assert.match(source, /phrase = '';/);
  const helper = await readFile(new URL('../src/recovery-phrase.js', import.meta.url), 'utf8');
  assert.match(helper, /if \(field\) field\.value = ''/);
  assert.doesNotMatch(source, /localStorage\.(?:setItem|getItem)\([^\n]*(?:phrase|mnemonic)/i);
  assert.doesNotMatch(source, /indexedDB[^\n]*(?:phrase|mnemonic)/i);
  assert.doesNotMatch(source, /JSON\.stringify\([^\n]*(?:phrase|mnemonic)/i);
  assert.match(source, /function clearRecoveryImport\(\)\s*\{\s*pendingRecoveryAccount = null;/);
  assert.match(source, /addEventListener\('close', \(\) => \{ clearRecoveryImport\(\);/);
  assert.match(source, /if \(recoveryAccount\) clearRecoveryImport\(\);/);
  assert.match(source, /finally\s*\{[\s\S]*?if \(recoveryAccount\) clearRecoveryImport\(\);/);
  assert.match(source, /addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'hidden'\) clearRecoveryImport\(\); \}\)/);
  assert.match(source, /addEventListener\('pagehide', clearRecoveryImport\)/);
  assert.match(source, /addEventListener\('beforeunload', clearRecoveryImport\)/);
  assert.match(source, /readContract\(\{ address: ID_REGISTRY_ADDRESS[\s\S]*?args: \[account\.address\]/);
  assert.match(source, /await storeSigner\(\{ fid, publicKey, custodyAddress, privateKey, signedKeyAdd:/);
  assert.match(source, /const safeMessage = error\?\.message === 'That phrase could not be imported/);
  assert.doesNotMatch(source, /Could not check the account on Optimism: \$\{error\.message\}/);
  assert.doesNotMatch(source, /fetch\([^\n]*(?:phrase|mnemonic)/i);
  const warningIndex = html.indexOf('Only continue on a deployment you control');
  const fieldIndex = html.indexOf('id="recovery-phrase"');
  assert.ok(warningIndex >= 0 && fieldIndex > warningIndex, 'warning appears before the phrase input');
  assert.match(html.slice(fieldIndex - 100, fieldIndex + 450), /type="password"[\s\S]*autocomplete="new-password"/);
  assert.match(html, /Read-only browsing never needs your recovery phrase/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//i, 'setup page has no remote script tags');
  const csp = headers.headers.flatMap((entry) => entry.headers).find((header) => header.key === 'Content-Security-Policy')?.value || '';
  assert.match(csp, /script-src 'self'; script-src-attr 'none'/);
  assert.match(csp, /style-src 'self'; style-src-attr 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /connect-src[^;]*https:\/\/mainnet\.optimism\.io[^;]*https:\/\/mainnet\.base\.org[^;]*https:\/\/api\.giphy\.com/);
  assert.match(csp, /media-src 'self' https:/);
  assert.match(source, /function enableAnalytics\(\)[\s\S]*?disableAutoTrack: true/);
  assert.match(source, /if \(analyticsEnabled\) pageview\(/);
  assert.match(source, /if \(event\.currentTarget\.checked\) \{ enableAnalytics\(\); pageview\(/);
});
