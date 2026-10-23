import { isIP } from 'node:net';

const ROUTES = {
  info: { path: '/v1/info', method: 'GET', params: [] },
  casts: { path: '/v1/castsByFid', method: 'GET', params: ['fid', 'pageSize', 'pageToken', 'reverse', 'startTimestamp', 'stopTimestamp'] },
  replies: { path: '/v1/castsByParent', method: 'GET', params: ['fid', 'hash', 'pageSize', 'pageToken', 'reverse'] },
  username: { path: '/v1/userNameProofByName', method: 'GET', params: ['name'] },
  links: { path: '/v1/linksByFid', method: 'GET', params: ['fid', 'link_type', 'pageSize', 'pageToken', 'reverse'] },
  userData: { path: '/v1/userDataByFid', method: 'GET', params: ['fid', 'user_data_type', 'pageSize', 'pageToken', 'reverse'] },
  signers: { path: '/v1/signersByFid', method: 'GET', params: ['fid', 'requesterFids', 'pageSize', 'pageToken'] },
  castById: { path: '/v1/castById', method: 'GET', params: ['fid', 'hash'] },
  linkById: { path: '/v1/linkById', method: 'GET', params: ['fid', 'target_fid', 'link_type'] },
  reactionById: { path: '/v1/reactionById', method: 'GET', params: ['fid', 'target_fid', 'target_hash', 'reaction_type'] },
  submit: { path: '/v1/submitMessage', method: 'POST', params: [] },
};

const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_READS_PER_WINDOW = 240;
const MAX_WRITES_PER_WINDOW = 20;
// A normal authorization uses one nonce read plus up to six confirmation
// polls. Allow a manual retry in the same minute without throttling the owner.
const MAX_SIGNER_CHECKS_PER_WINDOW = 60;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RATE_LIMIT_ENTRIES = 4096;

function rateLimitKey(req) {
  // Vercel overwrites x-forwarded-for with the connecting client IP. Validate
  // it before using it as a key so malformed headers cannot create huge keys.
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded.length <= 64 && isIP(forwarded)) return forwarded;
  const remote = String(req.socket?.remoteAddress || '').trim();
  return remote.length <= 64 && isIP(remote) ? remote : 'unknown';
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return false;
  try {
    const parsed = new URL(origin);
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (forwardedProto && parsed.protocol !== `${forwardedProto}:`) return false;
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host.toLowerCase() === String(host).toLowerCase();
  } catch { return false; }
}

function validateParam(name, value) {
  if (name === 'fid' || name === 'target_fid') return /^[1-9]\d{0,14}$/.test(value);
  if (name === 'name') return /^[\p{L}\p{N}._-]{1,64}$/u.test(value);
  if (name === 'pageSize') return /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100;
  if (name === 'reverse') return value === 'true' || value === 'false' || value === '1' || value === '0';
  if (name === 'startTimestamp' || name === 'stopTimestamp') return /^\d{1,12}$/.test(value);
  if (name === 'hash' || name === 'target_hash') return /^0x[0-9a-f]{40,64}$/i.test(value);
  if (name === 'link_type') return value === 'follow';
  if (name === 'reaction_type') return value === 'Like' || value === 'Recast';
  if (name === 'user_data_type') return /^[A-Z0-9_]{1,48}$/.test(value) || /^\d{1,2}$/.test(value);
  if (name === 'requesterFids') return /^[0-9,]{1,120}$/.test(value);
  // Snapchain cursors may use either URL-safe or standard Base64 encoding.
  if (name === 'pageToken') return value.length <= 2048 && /^[A-Za-z0-9+/_=-]*$/.test(value);
  return false;
}

function safeRejectionReason(result) {
  // Snapchain's validation messages are useful for fixing signer authorization
  // failures. Keep only its short public error fields; never echo the request,
  // message bytes, headers, credentials, or upstream response wholesale.
  const raw = typeof result?.message === 'string'
    ? result.message
    : typeof result?.error === 'string'
      ? result.error
      : typeof result?.errCode === 'string'
        ? result.errCode
        : '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function rateLimit(req, write, routeName) {
  const authCheck = !write && routeName === 'signers';
  const key = `${authCheck ? 'a' : write ? 'w' : 'r'}:${rateLimitKey(req)}`;
  const now = Date.now();
  const current = hits.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    if (hits.size >= MAX_RATE_LIMIT_ENTRIES) {
      for (const [entryKey, entry] of hits) {
        if (now - entry.start >= WINDOW_MS) hits.delete(entryKey);
        if (hits.size < MAX_RATE_LIMIT_ENTRIES) break;
      }
      if (hits.size >= MAX_RATE_LIMIT_ENTRIES) hits.delete(hits.keys().next().value);
    }
    hits.set(key, { start: now, count: 1 }); return true;
  }
  const max = authCheck ? MAX_SIGNER_CHECKS_PER_WINDOW : write ? MAX_WRITES_PER_WINDOW : MAX_READS_PER_WINDOW;
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Message is larger than the 64 KB limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Snapchain response exceeded the 2 MB limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export default async function snapchain(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const routeName = url.searchParams.get('route');
  const route = ROUTES[routeName];
  if (!route) return res.status(404).json({ error: 'Unknown Snapchain route' });
  if (req.method !== route.method) {
    res.setHeader('Allow', route.method);
    return res.status(405).json({ error: 'Method not allowed for this Snapchain route' });
  }
  if (route.method === 'POST') {
    if (!isSameOrigin(req)) return res.status(403).json({ error: 'Write request origin could not be verified' });
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/octet-stream') return res.status(415).json({ error: 'Snapchain messages must use application/octet-stream' });
  }
  if (!rateLimit(req, route.method === 'POST', routeName)) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });

  const base = process.env.SNAPCHAIN_URL;
  if (!base) return res.status(503).json({ error: 'Snapchain is not configured. Set SNAPCHAIN_URL to your read node HTTP URL.' });
  let target;
  try {
    const baseUrl = new URL(base);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) throw new Error('Invalid Snapchain URL');
    if (Boolean(process.env.SNAPCHAIN_HTTP_USER) !== Boolean(process.env.SNAPCHAIN_HTTP_PASS)) throw new Error('Proxy credentials must be set as a pair');
    target = new URL(route.path, baseUrl);
  } catch {
    return res.status(500).json({ error: 'SNAPCHAIN_URL must be an HTTP or HTTPS origin; proxy credentials must be set as a pair.' });
  }

  const seenParams = new Set();
  if (url.searchParams.getAll('route').length !== 1) return res.status(400).json({ error: 'Exactly one Snapchain route is required' });
  for (const [name, value] of url.searchParams.entries()) {
    if (name === 'route') continue;
    if (seenParams.has(name)) return res.status(400).json({ error: `Duplicate ${name} parameter` });
    seenParams.add(name);
    if (!route.params.includes(name) || !validateParam(name, value)) return res.status(400).json({ error: `Invalid ${name} parameter` });
    target.searchParams.set(name, value);
  }
  if (route.params.includes('fid') && !target.searchParams.has('fid')) return res.status(400).json({ error: 'fid is required' });
  if (routeName === 'castById' && !target.searchParams.has('hash')) return res.status(400).json({ error: 'hash is required' });
  if (routeName === 'replies' && (!target.searchParams.has('fid') || !target.searchParams.has('hash'))) return res.status(400).json({ error: 'parent fid and hash are required' });
  if (routeName === 'linkById' && !target.searchParams.has('target_fid')) return res.status(400).json({ error: 'target_fid is required' });
  if (routeName === 'reactionById' && (!target.searchParams.has('target_fid') || !target.searchParams.has('target_hash') || !target.searchParams.has('reaction_type'))) return res.status(400).json({ error: 'reaction target and type are required' });
  if ((process.env.SNAPCHAIN_HTTP_USER || process.env.SNAPCHAIN_HTTP_PASS) && target.protocol !== 'https:') {
    return res.status(500).json({ error: 'Proxy credentials require an HTTPS Snapchain endpoint.' });
  }

  try {
    const headers = { accept: 'application/json' };
    let body;
    if (route.method === 'POST') {
      body = await readBody(req);
      headers['content-type'] = 'application/octet-stream';
    }
    if (process.env.SNAPCHAIN_HTTP_USER && process.env.SNAPCHAIN_HTTP_PASS) {
      headers.authorization = `Basic ${Buffer.from(`${process.env.SNAPCHAIN_HTTP_USER}:${process.env.SNAPCHAIN_HTTP_PASS}`).toString('base64')}`;
    }
    const response = await fetch(target, { method: route.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(12_000) });
    const raw = await readResponse(response);
    let result;
    try { result = raw ? JSON.parse(raw) : {}; } catch { return res.status(502).json({ error: 'Snapchain returned an unreadable response' }); }
    res.setHeader('Cache-Control', 'no-store');
    if (response.status >= 400) {
      const reason = safeRejectionReason(result);
      // Snapchain 0.14.x may report a missing cast as HTTP 400 "Failed to get cast".
      // The client uses 404 to distinguish an unconfirmed post from a rejected write.
      if (routeName === 'castById' && response.status === 400 && /^failed to get cast(?:$|[:\s])/i.test(reason)) {
        return res.status(404).json({ error: 'Cast not found' });
      }
      // Snapchain 0.14.x reports a missing link (including a follow that
      // does not exist yet) as HTTP 400 "Failed to get link". Expose that as
      // 404 so the client can safely distinguish an absent follow from a
      // rejected write or malformed request.
      if (routeName === 'linkById' && response.status === 400 && /^failed to get link(?:$|[:\s])/i.test(reason)) {
        return res.status(404).json({ error: 'Link not found' });
      }
      const status = response.status >= 500 ? 502 : response.status;
      const message = response.status >= 500
        ? 'Snapchain is temporarily unavailable.'
        : `Snapchain rejected the request (${response.status}).${reason ? ` ${reason}` : ' Check the account or message and try again.'}`;
      return res.status(status).json({ error: message });
    }
    return res.status(200).json(result);
  } catch (error) {
    const knownLimit = error.message === 'Message is larger than the 64 KB limit' || error.message === 'Snapchain response exceeded the 2 MB limit';
    return res.status(502).json({ error: knownLimit ? error.message : 'Could not reach the configured Snapchain node' });
  }
};

export const config = { api: { bodyParser: false } };
