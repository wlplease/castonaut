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
