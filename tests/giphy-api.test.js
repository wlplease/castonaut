import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import giphy from '../api/giphy.js';

const oldEnv = {
  app: process.env.GIPHY_APP,
  key: process.env.GIPHY_API_KEY,
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
};
const previousFetch = globalThis.fetch;
after(() => {
  for (const [name, value] of Object.entries({ GIPHY_APP: oldEnv.app, GIPHY_API_KEY: oldEnv.key, UPSTASH_REDIS_REST_URL: oldEnv.url, UPSTASH_REDIS_REST_TOKEN: oldEnv.token })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  globalThis.fetch = previousFetch;
});

function response() {
  return {
    statusCode: 200, headers: {}, payload: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.payload = JSON.parse(value); },
  };
}
function request({ method = 'GET', body, headers = {} } = {}) {
  return { method, body, url: '/api/giphy', headers: { host: 'castonaut.example', ...headers } };
}
async function call(options) {
  const res = response();
  await giphy(request(options), res);
  return res;
}
function configure() {
  process.env.GIPHY_APP = 'public-test-app-key';
  delete process.env.GIPHY_API_KEY;
  process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'server-only-test-token';
}

test('GIF gate fails closed when shared limiter configuration is missing', async () => {
  delete process.env.GIPHY_API_KEY;
  delete process.env.GIPHY_APP;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const result = await call();
  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.enabled, false);
});

test('status returns app-owned GIPHY key and shared cooldown without caching', async () => {
  configure();
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer server-only-test-token');
    assert.deepEqual(JSON.parse(options.body), ['PTTL', 'castonaut:giphy:global:v1']);
    return Response.json({ result: 24_000 });
  };
  const result = await call();
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.apiKey, 'public-test-app-key');
  assert.equal(result.payload.retryAfterMs, 24_000);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('global claim uses one atomic Redis script and denies a concurrent caller', async () => {
  configure();
  const scripts = [];
  globalThis.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    scripts.push(command);
    return Response.json({ result: [0, 8500] });
  };
  const result = await call({ method: 'POST', body: { action: 'claim' }, headers: {
    origin: 'https://castonaut.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
  } });
  assert.equal(result.statusCode, 429);
  assert.equal(result.payload.retryAfterMs, 8500);
  assert.equal(result.headers['retry-after'], '9');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][0], 'EVAL');
  assert.equal(scripts[0][2], '1');
  assert.equal(scripts[0][3], 'castonaut:giphy:global:v1');
  assert.equal(scripts[0][4], '60000');
});

test('global claim allows one caller and returns the minute countdown', async () => {
  configure();
  globalThis.fetch = async () => Response.json({ result: [1, 60_000] });
  const result = await call({ method: 'POST', body: { action: 'claim' }, headers: {
    origin: 'https://castonaut.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
  } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { allowed: true, retryAfterMs: 60_000 });
});

test('global claim refuses cross-origin requests before calling Redis', async () => {
  configure();
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const result = await call({ method: 'POST', body: { action: 'claim' }, headers: {
    origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json',
  } });
  assert.equal(result.statusCode, 403);
});

test('draft restoration never assigns the invalid negative maxLength', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.maxLength\s*=\s*-\d+/);
});
