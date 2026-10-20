import test from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'viem';
import { capsuleDateLabel, createTimeCapsule, parseTimeCapsules } from '../src/time-capsules.js';
import { findConnectedPassWallet, formatPassCountdown, PASS_PRICE, BASE_CHAIN_ID, BASE_USDC_ADDRESS } from '../src/time-pass.js';
import { isStationAccessAllowed } from '../src/station-access.js';

test('time capsules retain a bounded local snapshot and restore only valid cast records', () => {
  const message = { data: { fid: 37, timestamp: 1_000, castAddBody: { text: 'A signal', embeds: [{ url: 'https://media.tenor.com/example.gif' }] } } };
  const capsule = createTimeCapsule([message, { data: { fid: 0, castAddBody: { text: 'skip' } } }], {
    date: '2026-10-19', feed: 'following', hashFor: () => `0x${'a'.repeat(40)}`, usernameFor: () => 'pilot', savedAt: 123,
  });
  assert.equal(capsule.count, 1);
  assert.equal(capsule.casts[0].embeds[0].url, 'https://media.tenor.com/example.gif');
  assert.equal(parseTimeCapsules(JSON.stringify([capsule]))[0].casts[0].username, 'pilot');
  assert.equal(parseTimeCapsules('bad json').length, 0);
  assert.equal(capsuleDateLabel('bad-date'), 'Saved day');
});

test('time pass values use native Base USDC and show a per-wallet countdown', () => {
  assert.equal(BASE_CHAIN_ID, 8453);
  assert.equal(BASE_USDC_ADDRESS.toLowerCase(), '0x833589fc d6edb6e08f4c7c32d4f71b54bda02913'.replaceAll(' ', ''));
  assert.equal(PASS_PRICE, 3_700_000n);
  assert.equal(formatPassCountdown(1_800_000_000, 1_799_913_600_000), '1d 00h left');
  assert.equal(formatPassCountdown(1_700_000_000, 1_800_000_000_000), 'Pass expired');
});

test('a saved pass unlock check requires that exact wallet to remain connected', () => {
  const paidWallet = '0xabcd00000000000000000000000000000000abcd';
  const otherWallet = '0x2222222222222222222222222222222222222222';
  assert.equal(findConnectedPassWallet(paidWallet, [otherWallet]), '');
  assert.equal(findConnectedPassWallet(paidWallet, [getAddress(paidWallet)]), getAddress(paidWallet));
  assert.equal(findConnectedPassWallet(paidWallet, null), '');
});

test('the preview stays open until paid checkout is configured', () => {
  const nowMs = 1_800_000_000_000;
  assert.equal(isStationAccessAllowed({ nowMs }), true);
  assert.equal(isStationAccessAllowed({ contestAccess: true, passContractConfigured: true, nowMs }), true);
  assert.equal(isStationAccessAllowed({ passContractConfigured: true, passExpiry: 1_800_000_001, nowMs }), true);
  assert.equal(isStationAccessAllowed({ passContractConfigured: true, passExpiry: 1_800_000_000, nowMs }), false);
  assert.equal(isStationAccessAllowed({ passContractConfigured: true, passExpiry: 1, nowMs }), false);
});
