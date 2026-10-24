import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import snapchain from '../api/snapchain.js';

const previousSnapchainUrl = process.env.SNAPCHAIN_URL;
const previousFetch = globalThis.fetch;
process.env.SNAPCHAIN_URL = 'https://snapchain.invalid';

after(() => {
  if (previousSnapchainUrl === undefined) delete process.env.SNAPCHAIN_URL;
  else process.env.SNAPCHAIN_URL = previousSnapchainUrl;
  globalThis.fetch = previousFetch;
});

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

function makeRequest({ url, method = 'GET', headers = {}, ip = '203.0.113.44' }) {
  return {
    url,
    method,
    headers: { host: 'castonaut.example', ...headers },
    socket: { remoteAddress: ip },
    async *[Symbol.asyncIterator]() {},
  };
}

async function callApi(request) {
  const response = makeResponse();
  await snapchain(request, response);
  return response;
}

test('proxy rejects unknown routes and methods before contacting Snapchain', async () => {
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const unknown = await callApi(makeRequest({ url: '/api/snapchain?route=admin' }));
  assert.equal(unknown.statusCode, 404);
  const lookup = await callApi(makeRequest({ url: '/api/snapchain?route=usernameProof&name=alice' }));
  assert.equal(lookup.statusCode, 404);
  const wrongMethod = await callApi(makeRequest({ url: '/api/snapchain?route=submit', method: 'GET' }));
  assert.equal(wrongMethod.statusCode, 405);
});

test('proxy validates FIDs and rejects duplicate or unrecognized query parameters', async () => {
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const badFid = await callApi(makeRequest({ url: '/api/snapchain?route=casts&fid=0x123' }));
  assert.equal(badFid.statusCode, 400);
  const repeated = await callApi(makeRequest({ url: '/api/snapchain?route=casts&fid=12&fid=13' }));
  assert.equal(repeated.statusCode, 400);
  const extra = await callApi(makeRequest({ url: '/api/snapchain?route=casts&fid=12&debug=true' }));
  assert.equal(extra.statusCode, 400);
});

test('proxy forwards standard Base64 Snapchain page cursors', async () => {
  let forwarded;
  globalThis.fetch = async (url) => {
    forwarded = new URL(url);
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  };
  const token = 'abc+/def==';
  const result = await callApi(makeRequest({
    url: `/api/snapchain?route=links&fid=1059075&link_type=follow&pageSize=100&reverse=true&pageToken=${encodeURIComponent(token)}`,
    ip: '203.0.113.48',
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(forwarded.searchParams.get('pageToken'), token);
});

test('public read responses use a brief Vercel edge cache while browser responses stay private', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [] }), { status: 200 });
  const cached = await callApi(makeRequest({ url: '/api/snapchain?route=casts&fid=37&pageSize=10', ip: '203.0.113.49' }));
  assert.equal(cached.statusCode, 200);
  assert.equal(cached.headers['cache-control'], 'no-store');
  assert.match(cached.headers['vercel-cdn-cache-control'], /s-maxage=15/);

  const fresh = await callApi(makeRequest({ url: '/api/snapchain?route=casts&fid=37&pageSize=10&_fresh=1', ip: '203.0.113.50' }));
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.headers['vercel-cdn-cache-control'], undefined);
});

test('reserved fresh-read parameter is validated and never forwarded to Snapchain', async () => {
  let forwarded;
  globalThis.fetch = async (url) => {
    forwarded = new URL(url);
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  };
  const invalid = await callApi(makeRequest({ url: '/api/snapchain?route=casts&fid=37&_fresh=2' }));
  assert.equal(invalid.statusCode, 400);
  const fresh = await callApi(makeRequest({ url: '/api/snapchain?route=casts&fid=37&_fresh=1', ip: '203.0.113.51' }));
  assert.equal(fresh.statusCode, 200);
  assert.equal(forwarded.searchParams.has('_fresh'), false);
});

test('reaction details use the configured Snapchain node and forward bounded pages', async () => {
  let forwarded;
  globalThis.fetch = async (url) => {
    forwarded = new URL(url);
    return new Response(JSON.stringify({ messages: [], nextPageToken: 'next+/=' }), { status: 200 });
  };
  const result = await callApi(makeRequest({
    url: `/api/snapchain?route=reactionsByCast&target_fid=37&target_hash=0x${'a'.repeat(40)}&reaction_type=Like&pageSize=8&reverse=true&pageToken=${encodeURIComponent('abc+/=')}`,
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(forwarded.pathname, '/v1/reactionsByCast');
  assert.equal(forwarded.searchParams.get('target_fid'), '37');
  assert.equal(forwarded.searchParams.get('reaction_type'), 'Like');
  assert.equal(forwarded.searchParams.get('pageSize'), '8');
  assert.equal(forwarded.searchParams.get('pageToken'), 'abc+/=');
});

test('reaction details reject malformed targets and pagination before contacting Snapchain', async () => {
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const missing = await callApi(makeRequest({ url: `/api/snapchain?route=reactionsByCast&target_fid=37&target_hash=0x${'a'.repeat(40)}` }));
  assert.equal(missing.statusCode, 400);
  const oversized = await callApi(makeRequest({ url: `/api/snapchain?route=reactionsByCast&target_fid=37&target_hash=0x${'a'.repeat(40)}&reaction_type=Like&pageSize=101` }));
  assert.equal(oversized.statusCode, 400);
  const localConfig = await (await import('node:fs/promises')).readFile(new URL('../vite.config.mjs', import.meta.url), 'utf8');
  assert.match(localConfig, /reactionsByCast: \{ path: '\/v1\/reactionsByCast', method: 'GET'/);
  assert.match(localConfig, /routeName === 'reactionsByCast' && \(!target\.searchParams\.has\('target_fid'\)/);
});

test('missing reaction from Snapchain 0.14.x is normalized to not found for like toggles', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Failed to get reaction' }), { status: 400 });
  const result = await callApi(makeRequest({
    url: `/api/snapchain?route=reactionById&fid=37&target_fid=18928&target_hash=0x${'a'.repeat(40)}&reaction_type=Like`,
    ip: '203.0.113.73',
  }));
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.payload, { error: 'Reaction not found' });
});

test('local Snapchain adapter accepts standard Base64 page cursors', async () => {
  const config = await (await import('node:fs/promises')).readFile(new URL('../vite.config.mjs', import.meta.url), 'utf8');
  assert.ok(config.includes("if (name === 'pageToken') return value.length <= 2048 && /^[A-Za-z0-9+/_=-]*$/.test(value);"));
});

test('proxy blocks cross-origin writes and non-binary message bodies', async () => {
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const foreign = await callApi(makeRequest({
    url: '/api/snapchain?route=submit', method: 'POST',
    headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/octet-stream' },
  }));
  assert.equal(foreign.statusCode, 403);
  const schemeMismatch = await callApi(makeRequest({
    url: '/api/snapchain?route=submit', method: 'POST',
    headers: { origin: 'http://castonaut.example', 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': 'https', 'content-type': 'application/octet-stream' },
  }));
  assert.equal(schemeMismatch.statusCode, 403);
  const wrongType = await callApi(makeRequest({
    url: '/api/snapchain?route=submit', method: 'POST',
    headers: { origin: 'https://castonaut.example', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
  }));
  assert.equal(wrongType.statusCode, 415);
});

test('proxy refuses a configured URL with credentials or a path', async () => {
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const validBase = process.env.SNAPCHAIN_URL;
  process.env.SNAPCHAIN_URL = 'https://user:secret@snapchain.invalid/path';
  try {
    const result = await callApi(makeRequest({ url: '/api/snapchain?route=info' }));
    assert.equal(result.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(result.payload), /secret/);
  } finally { process.env.SNAPCHAIN_URL = validBase; }
});

test('proxy returns only a short, sanitized Snapchain validation reason', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: `Invalid signer nonce\n${'x'.repeat(300)}`,
    request: 'must not be exposed',
  }), { status: 400, headers: { 'content-type': 'application/json' } });
  const result = await callApi(makeRequest({
    url: '/api/snapchain?route=submit', method: 'POST',
    headers: { origin: 'https://castonaut.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/octet-stream' },
    ip: '203.0.113.47',
  }));
  assert.equal(result.statusCode, 400);
  assert.match(result.payload.error, /Invalid signer nonce/);
  assert.doesNotMatch(result.payload.error, /must not be exposed|\n/);
  assert.ok(result.payload.error.length < 260);
});

test('proxy normalizes Snapchain missing-cast 400 responses to 404 for safe publish retries', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Failed to get cast' }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
  const result = await callApi(makeRequest({ url: `/api/snapchain?route=castById&fid=123&hash=0x${'a'.repeat(40)}` }));
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.payload, { error: 'Cast not found' });
});

test('proxy normalizes Snapchain missing-link 400 responses to 404 for follow checks', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Failed to get link' }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
  const result = await callApi(makeRequest({ url: '/api/snapchain?route=linkById&fid=1059075&target_fid=18928&link_type=follow' }));
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.payload, { error: 'Link not found' });
});

test('proxy preserves other link lookup errors as client errors', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Invalid link type' }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
  const result = await callApi(makeRequest({ url: '/api/snapchain?route=linkById&fid=1059075&target_fid=18928&link_type=follow' }));
  assert.equal(result.statusCode, 400);
  assert.match(result.payload.error, /Invalid link type/);
});

test('read rate limit is enforced per client address', async () => {
  globalThis.fetch = async () => new Response('{"version":"test"}', { status: 200, headers: { 'content-type': 'application/json' } });
  for (let i = 0; i < 240; i++) {
    const response = await callApi(makeRequest({ url: '/api/snapchain?route=info', ip: '203.0.113.45' }));
    assert.equal(response.statusCode, 200);
  }
  const limited = await callApi(makeRequest({ url: '/api/snapchain?route=info', ip: '203.0.113.45' }));
  assert.equal(limited.statusCode, 429);
});

test('signer status checks allow an authorization and a manual confirmation retry per address', async () => {
  globalThis.fetch = async () => new Response('{"messages":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  for (let i = 0; i < 60; i++) {
    const response = await callApi(makeRequest({ url: '/api/snapchain?route=signers&fid=987654', ip: '203.0.113.46' }));
    assert.notEqual(response.statusCode, 429);
  }
  const limited = await callApi(makeRequest({ url: '/api/snapchain?route=signers&fid=987654', ip: '203.0.113.46' }));
  assert.equal(limited.statusCode, 429);
});
