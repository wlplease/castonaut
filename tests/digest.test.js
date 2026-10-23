import test from 'node:test';
import assert from 'node:assert/strict';
import digest from '../api/digest.js';

function invoke({ method = 'POST', body = { posts: [{ text: 'A short public cast.' }] }, headers = {}, ip = '192.0.2.20' } = {}) {
  const req = { method, body, headers: { host: 'castonaut.example', origin: 'https://castonaut.example', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: ip } };
  const res = {
    headers: {}, code: 200, payload: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  return digest(req, res).then(() => res);
}

test('digest endpoint rejects cross-origin and malformed requests', async () => {
  const origin = await invoke({ headers: { origin: 'https://other.example' }, ip: '192.0.2.21' });
  assert.equal(origin.code, 403);
  const method = await invoke({ method: 'GET', ip: '192.0.2.22' });
  assert.equal(method.code, 405);
  const type = await invoke({ headers: { 'content-type': 'text/plain' }, ip: '192.0.2.23' });
  assert.equal(type.code, 415);
  const invalid = await invoke({ body: { posts: Array(21).fill({ text: 'post' }) }, ip: '192.0.2.24' });
  assert.equal(invalid.code, 400);
});

test('digest endpoint requires server key and reports rate limiting', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const noKey = await invoke({ ip: '192.0.2.25' });
    assert.equal(noKey.code, 503);
    assert.equal(noKey.headers['Cache-Control'], 'no-store');
    for (let i = 0; i < 5; i++) await invoke({ ip: '192.0.2.26' });
    const limited = await invoke({ ip: '192.0.2.26' });
    assert.equal(limited.code, 429);
  } finally {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('digest endpoint sends bounded content with a server-only key and sanitizes provider errors', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-server-secret';
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '• A concise summary.' }] } }] }), { status: 200 });
  };
  try {
    const response = await invoke({ body: { posts: [{ text: 'Hello' }, { text: 'World' }] }, ip: '192.0.2.27' });
    assert.equal(response.code, 200);
    assert.equal(response.payload.text, '• A concise summary.');
    assert.equal(captured.options.headers['x-goog-api-key'], 'test-server-secret');
    assert.match(captured.url, /generateContent$/);
    assert.equal(captured.options.redirect, 'error');
    const sent = JSON.parse(captured.options.body);
    assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.equal('temperature' in sent.generationConfig, false);
    assert.equal(captured.options.signal.aborted, false);
    assert.ok(!JSON.stringify(response.payload).includes('test-server-secret'));

    globalThis.fetch = async () => new Response('secret provider detail', { status: 401 });
    const failed = await invoke({ ip: '192.0.2.28' });
    assert.equal(failed.code, 502);
    assert.ok(!JSON.stringify(failed.payload).includes('secret provider detail'));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('digest endpoint bounds and validates the upstream response body', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-server-secret';
  try {
    globalThis.fetch = async () => new Response('x'.repeat(64 * 1024 + 1), { status: 200 });
    const oversized = await invoke({ ip: '192.0.2.29' });
    assert.equal(oversized.code, 502);
    assert.equal(oversized.payload.error, 'Gemini is temporarily unavailable. Try again shortly.');

    globalThis.fetch = async () => new Response('not-json', { status: 200 });
    const malformed = await invoke({ ip: '192.0.2.30' });
    assert.equal(malformed.code, 502);
    assert.equal(malformed.payload.error, 'Gemini is temporarily unavailable. Try again shortly.');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});
