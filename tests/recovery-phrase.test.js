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
  assert.match(source, /import \{ isSupportedRecoveryPhraseLength, takeRecoveryPhrase \} from '\.\/recovery-phrase\.js';/);
  assert.match(source, /let phrase = takeRecoveryPhrase\(phraseField\);/);
  assert.match(source, /function optimismReadTransport\(fallback, http\)[\s\S]*?https:\/\/mainnet\.optimism\.io[\s\S]*?https:\/\/optimism-rpc\.publicnode\.com/);
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
  assert.match(html.slice(fieldIndex - 100, fieldIndex + 1000), /type="password"[\s\S]*autocomplete="off"[\s\S]*id="recovery-reveal"/);
  assert.match(source, /recovery-phrase'\)\.addEventListener\('keydown',[\s\S]*?event\.key === 'Enter'[\s\S]*?lookupRecoveryAccount\(\)/);
  assert.match(source, /recovery-reveal'\)\.addEventListener\('click'/);
  assert.match(html, /Cleared after the connection attempt/);
  assert.match(html, /Continuing verifies its Farcaster account and creates a browser key for posting, following and reactions/);
  assert.ok(html.indexOf('id="recovery-import"') < html.indexOf('id="wallet-connect"'), 'phrase sign-in is the primary path and wallet is secondary');
  assert.match(source, /await authorizeSigner\(pendingRecoveryAccount\)/);
  assert.match(html, /Read freely\. Connect once to post and follow/);
  assert.match(html, /id="recovery-account-index"[\s\S]*?value="4"/);
  assert.match(source, /mnemonicToAccount\(phrase, \{ accountIndex \}\)/);
  assert.match(source, /lookupButton\.textContent = 'Checking…'/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//i, 'setup page has no remote script tags');
  const csp = headers.headers.flatMap((entry) => entry.headers).find((header) => header.key === 'Content-Security-Policy')?.value || '';
  assert.match(csp, /script-src 'self'; script-src-attr 'none'/);
  assert.match(csp, /style-src 'self'; style-src-attr 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /connect-src[^;]*https:\/\/mainnet\.optimism\.io[^;]*https:\/\/optimism-rpc\.publicnode\.com[^;]*https:\/\/mainnet\.base\.org[^;]*https:\/\/api\.giphy\.com/);
  assert.match(csp, /media-src 'self' https:/);
  assert.match(source, /function enableAnalytics\(\)[\s\S]*?disableAutoTrack: true/);
  assert.match(source, /if \(analyticsEnabled\) pageview\(/);
  assert.match(source, /if \(event\.currentTarget\.checked\) \{ enableAnalytics\(\); pageview\(/);
});
