import { isIP } from 'node:net';

const COOLDOWN_MS = 60_000;
const GLOBAL_KEY = 'castonaut:giphy:global:v1';
const rateHits = new Map();
const RATE_WINDOW_MS = 60_000;
const CLAIM_SCRIPT = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then return {0, ttl} end
redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return {1, tonumber(ARGV[1])}
`;

async function readLimitedJson(response, maxBytes = 1_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('GIF response was too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return false;
  try {
    const parsed = new URL(origin);
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.host.toLowerCase() === String(host).toLowerCase()
      && (!forwardedProto || parsed.protocol === `${forwardedProto}:`);
  } catch { return false; }
}

function requestKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded.length <= 64 && isIP(forwarded)) return forwarded;
  const remote = String(req.socket?.remoteAddress || '').trim();
  return remote.length <= 64 && isIP(remote) ? remote : 'unknown';
}

function rateLimited(req, scope, limit) {
  const key = `${scope}:${requestKey(req)}`;
  const now = Date.now();
  const current = rateHits.get(key);
  if (!current || now - current.start >= RATE_WINDOW_MS) {
    if (rateHits.size >= 4096) {
      for (const [entryKey, entry] of rateHits) {
        if (now - entry.start >= RATE_WINDOW_MS) rateHits.delete(entryKey);
        if (rateHits.size < 4096) break;
      }
      if (rateHits.size >= 4096) rateHits.delete(rateHits.keys().next().value);
    }
    rateHits.set(key, { start: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function configuration() {
  const apiKey = process.env.GIPHY_APP || process.env.GIPHY_API_KEY || '';
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || '';
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!apiKey || !redisUrl || !redisToken) return null;
  try {
    const url = new URL(redisUrl);
    if (url.protocol !== 'https:' || !/(^|\.)upstash\.io$/i.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash) return null;
    return { apiKey, redisUrl: url.toString().replace(/\/$/, ''), redisToken };
  } catch { return null; }
}

function missingConfiguration() {
  const missing = [];
  if (!(process.env.GIPHY_APP || process.env.GIPHY_API_KEY)) missing.push('GIPHY_APP');
  if (!process.env.UPSTASH_REDIS_REST_URL) missing.push('UPSTASH_REDIS_REST_URL');
  if (!process.env.UPSTASH_REDIS_REST_TOKEN) missing.push('UPSTASH_REDIS_REST_TOKEN');
  return missing;
}

async function redisCommand(config, command, signal) {
  const response = await fetch(config.redisUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.redisToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error('Limiter unavailable');
  const result = await response.json();
  if (result.error) throw new Error('Limiter unavailable');
  return result.result;
}

export default async function giphy(req, res) {
  const missing = missingConfiguration();
  if (missing.length) return send(res, 503, {
    enabled: false,
    error: `GIF search setup is incomplete. Add ${missing.join(', ')} in the Vercel Production environment, then redeploy. Secret values stay server-side.`,
  });
  const config = configuration();
  if (!config) return send(res, 503, { enabled: false, error: 'GIF search settings are invalid. Check the Upstash Redis REST URL; it must be an HTTPS Upstash URL.' });

  if (req.method === 'GET') {
    if (rateLimited(req, 'status', 30)) return send(res, 429, { enabled: false, error: 'Too many GIF status checks. Wait a minute.' }, { 'retry-after': '60' });
    try {
      const remaining = Number(await redisCommand(config, ['PTTL', GLOBAL_KEY], AbortSignal.timeout(3500)));
      return send(res, 200, { enabled: true, retryAfterMs: Math.max(0, remaining) });
    } catch {
      return send(res, 503, { enabled: false, error: 'GIF search is temporarily unavailable. Direct media links still work.' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    return send(res, 405, { error: 'Method not allowed' });
  }
  if (!sameOrigin(req)) return send(res, 403, { error: 'Request origin could not be verified.' });
  if (rateLimited(req, 'claim', 8)) return send(res, 429, { error: 'Too many GIF searches. Wait a minute.', retryAfterMs: COOLDOWN_MS }, { 'retry-after': '60' });
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return send(res, 415, { error: 'Expected a JSON request.' });
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (req.body?.action !== 'search' || query.length < 1 || query.length > 50 || /[\u0000-\u001f\u007f]/.test(query)) {
    return send(res, 400, { error: 'Enter a GIF search up to 50 characters.' });
  }

  try {
    const result = await redisCommand(config, ['EVAL', CLAIM_SCRIPT, '1', GLOBAL_KEY, String(COOLDOWN_MS)], AbortSignal.timeout(3500));
    if (!Array.isArray(result) || result.length < 2) throw new Error('Invalid limiter response');
    const accepted = Number(result[0]) === 1;
    const retryAfterMs = Math.max(0, Math.min(COOLDOWN_MS, Number(result[1]) || 0));
    if (!accepted) return send(res, 429, { error: 'Someone just searched. Try again when the timer clears.', retryAfterMs }, { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) });
    const searchUrl = new URL('https://api.giphy.com/v1/gifs/search');
    searchUrl.searchParams.set('api_key', config.apiKey);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('limit', '16');
    searchUrl.searchParams.set('offset', '0');
    searchUrl.searchParams.set('rating', 'pg');
    searchUrl.searchParams.set('lang', 'en');
    const upstream = await fetch(searchUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) return send(res, 502, { error: 'GIPHY could not complete that search. Try again when the shared timer clears.', retryAfterMs });
    const payload = await readLimitedJson(upstream);
    if (!Array.isArray(payload?.data)) return send(res, 502, { error: 'GIPHY returned an unreadable response.', retryAfterMs });
    const data = payload.data.slice(0, 16).map((item) => ({
      title: typeof item?.title === 'string' ? item.title.slice(0, 100) : 'GIF',
      images: {
        original: { url: item?.images?.original?.url },
        fixed_width_small: { url: item?.images?.fixed_width_small?.url },
        preview_gif: { url: item?.images?.preview_gif?.url },
      },
    }));
    return send(res, 200, { data, retryAfterMs });
  } catch {
    return send(res, 503, { error: 'GIF search is temporarily unavailable. Direct media links still work.' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };
