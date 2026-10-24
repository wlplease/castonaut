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
  assert.match(result.payload.error, /GIPHY_APP/);
  assert.match(result.payload.error, /UPSTASH_REDIS_REST_URL/);
  assert.match(result.payload.error, /UPSTASH_REDIS_REST_TOKEN/);
  assert.doesNotMatch(result.payload.error, /public-test-app-key|server-only-test-token/);
});

test('GIF setup reports only the missing shared limiter settings when the GIPHY key exists', async () => {
  process.env.GIPHY_APP = 'private-test-value';
  delete process.env.GIPHY_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const result = await call();
  assert.equal(result.statusCode, 503);
  assert.match(result.payload.error, /UPSTASH_REDIS_REST_URL/);
  assert.match(result.payload.error, /UPSTASH_REDIS_REST_TOKEN/);
  assert.doesNotMatch(result.payload.error, /GIPHY_APP|private-test-value/);
});

test('status reports availability without exposing the app key', async () => {
  configure();
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer server-only-test-token');
    assert.deepEqual(JSON.parse(options.body), ['PTTL', 'castonaut:giphy:global:v1']);
    return Response.json({ result: 24_000 });
  };
  const result = await call();
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.apiKey, undefined);
  assert.doesNotMatch(JSON.stringify(result.payload), /public-test-app-key|server-only-test-token/);
  assert.equal(result.payload.retryAfterMs, 24_000);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('status gives a safe hint when Upstash rejects the REST token', async () => {
  configure();
  globalThis.fetch = async () => new Response('{"error":"Unauthorized"}', { status: 401 });
  const result = await call();
  assert.equal(result.statusCode, 503);
  assert.match(result.payload.error, /rejected the REST token/);
  assert.match(result.payload.error, /UPSTASH_REDIS_REST_TOKEN/);
  assert.doesNotMatch(result.payload.error, /server-only-test-token|public-test-app-key/);
});

test('global search uses one atomic Redis script and denies a concurrent caller', async () => {
  configure();
  const scripts = [];
  globalThis.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    scripts.push(command);
    return Response.json({ result: [0, 8500] });
  };
  const result = await call({ method: 'POST', body: { action: 'search', query: 'space' }, headers: {
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

test('global search returns bounded results without exposing the app key', async () => {
  configure();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('upstash.io')) return Response.json({ result: [1, 60_000] });
    return Response.json({ data: [{ title: 'Space cat', images: { original: { url: 'https://media.giphy.com/original.gif' }, fixed_width_small: { url: 'https://media.giphy.com/small.gif' }, fixed_width: { url: 'must-not-return' } } }] });
  };
  const result = await call({ method: 'POST', body: { action: 'search', query: 'space' }, headers: {
    origin: 'https://castonaut.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
  } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.retryAfterMs, 60_000);
  assert.equal(result.payload.data[0].title, 'Space cat');
  assert.equal(result.payload.data[0].images.fixed_width, undefined);
  assert.match(calls[1].url, /api_key=public-test-app-key/);
  assert.match(calls[1].url, /q=space/);
  assert.match(calls[1].url, /limit=24/);
  assert.doesNotMatch(JSON.stringify(result.payload), /public-test-app-key|server-only-test-token|must-not-return/);
});

test('GIF search validates query length and rejects old claim-only requests', async () => {
  configure();
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const missing = await call({ method: 'POST', body: { action: 'claim' }, headers: {
    origin: 'https://castonaut.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
  } });
  const oversized = await call({ method: 'POST', body: { action: 'search', query: 'x'.repeat(51) }, headers: {
    origin: 'https://castonaut.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
  } });
  assert.equal(missing.statusCode, 400);
  assert.equal(oversized.statusCode, 400);
});

test('GIF search refuses cross-origin requests before calling Redis', async () => {
  configure();
  globalThis.fetch = async () => { throw new Error('fetch should not run'); };
  const result = await call({ method: 'POST', body: { action: 'search', query: 'space' }, headers: {
    origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json',
  } });
  assert.equal(result.statusCode, 403);
});

test('draft restoration never assigns the invalid negative maxLength', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.maxLength\s*=\s*-\d+/);
});

test('GIF search controls are not nested forms that browsers discard', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="giphy-search" id="giphy-search-form"/);
  assert.match(html, /data-giphy-query="space"/);
  assert.match(html, /data-giphy-query="celebrate"/);
  assert.doesNotMatch(html, /<form[^>]*id="giphy-search-form"/);
});

test('client sends GIF searches only to the same-origin proxy', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /fetch\('\/api\/giphy'[\s\S]*?action: 'search', query/);
  assert.doesNotMatch(source, /api\.giphy\.com|api_key|apiKey/);
});
