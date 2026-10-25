import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress, consumeWindow } from '../api/request-security.js';
import { getManagedSession, setManagedSession } from '../api/neynar-session.js';

test('client address accepts a valid edge address and rejects malformed forwarded values', () => {
  assert.equal(clientAddress({ headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }), '203.0.113.8');
  assert.equal(clientAddress({ headers: { 'x-forwarded-for': 'x'.repeat(100) }, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientAddress({ headers: {}, socket: {} }), 'unknown');
});

test('in-memory rate windows enforce limits and cap attacker-controlled keys', () => {
  const map = new Map();
  assert.equal(consumeWindow(map, 'client-a', { limit: 2, windowMs: 60_000, maxEntries: 2 }), true);
  assert.equal(consumeWindow(map, 'client-a', { limit: 2, windowMs: 60_000, maxEntries: 2 }), true);
  assert.equal(consumeWindow(map, 'client-a', { limit: 2, windowMs: 60_000, maxEntries: 2 }), false);
  consumeWindow(map, 'client-b', { limit: 2, windowMs: 60_000, maxEntries: 2 });
  consumeWindow(map, 'client-c', { limit: 2, windowMs: 60_000, maxEntries: 2 });
  assert.equal(map.size, 2);
  assert.equal(map.has('client-a'), false);
});

test('production managed sessions use signed, host-only secure cookies and reject tampering', () => {
  const previousSecret = process.env.CASTONAUT_SESSION_SECRET;
  const previousMode = process.env.NODE_ENV;
  process.env.CASTONAUT_SESSION_SECRET = 'unit-test-only-secret-with-at-least-32-characters';
  process.env.NODE_ENV = 'production';
  try {
    const headers = new Map();
    const res = { getHeader: (key) => headers.get(key), setHeader: (key, value) => headers.set(key, value) };
    const req = { headers: { 'x-forwarded-proto': 'https' } };
    const signerUuid = '12345678-1234-1234-1234-123456789012';
    setManagedSession(res, req, { fid: 123, signerUuid });
    const cookieHeader = headers.get('Set-Cookie')[0];
    assert.match(cookieHeader, /^__Host-castonaut_managed_session=/);
    assert.match(cookieHeader, /; HttpOnly;/);
    assert.match(cookieHeader, /; Secure/);
    assert.match(cookieHeader, /; SameSite=Lax;/);
    assert.match(cookieHeader, /; Path=\//);
    assert.doesNotMatch(cookieHeader, /; Domain=/i);
    const cookie = cookieHeader.split(';')[0];
    const session = getManagedSession({ headers: { cookie } });
    assert.deepEqual({ fid: session.fid, signerUuid: session.signerUuid }, { fid: 123, signerUuid });
    const [name, value] = cookie.split('=');
    assert.equal(getManagedSession({ headers: { cookie: `${name}=${value.slice(0, -1)}x` } }), null);
  } finally {
    if (previousSecret === undefined) delete process.env.CASTONAUT_SESSION_SECRET;
    else process.env.CASTONAUT_SESSION_SECRET = previousSecret;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});
