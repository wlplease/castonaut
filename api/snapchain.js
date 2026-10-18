const ROUTES = {
  info: { path: '/v1/info', method: 'GET', params: [] },
  casts: { path: '/v1/castsByFid', method: 'GET', params: ['fid', 'pageSize', 'pageToken', 'reverse', 'startTimestamp', 'stopTimestamp'] },
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
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RATE_LIMIT_ENTRIES = 4096;

function rateLimitKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host.toLowerCase() === String(host).toLowerCase(); } catch { return false; }
}

function validateParam(name, value) {
  if (name === 'fid' || name === 'target_fid') return /^[1-9]\d{0,14}$/.test(value);
  if (name === 'pageSize') return /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100;
  if (name === 'reverse') return value === 'true' || value === 'false' || value === '1' || value === '0';
  if (name === 'startTimestamp' || name === 'stopTimestamp') return /^\d{1,12}$/.test(value);
  if (name === 'hash' || name === 'target_hash') return /^0x[0-9a-f]{40,64}$/i.test(value);
  if (name === 'link_type') return value === 'follow';
  if (name === 'reaction_type') return value === 'Like' || value === 'Recast';
  if (name === 'user_data_type') return /^[A-Z0-9_]{1,48}$/.test(value) || /^\d{1,2}$/.test(value);
  if (name === 'requesterFids') return /^[0-9,]{1,120}$/.test(value);
  if (name === 'pageToken') return value.length <= 2048 && /^[A-Za-z0-9_=-]*$/.test(value);
  return false;
}

function rateLimit(req, write) {
  const key = `${write ? 'w' : 'r'}:${rateLimitKey(req)}`;
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
  const max = write ? MAX_WRITES_PER_WINDOW : MAX_READS_PER_WINDOW;
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
  if (!rateLimit(req, route.method === 'POST')) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });

  const base = process.env.SNAPCHAIN_URL;
  if (!base) return res.status(503).json({ error: 'Snapchain is not configured. Set SNAPCHAIN_URL to your read node HTTP URL.' });
  let target;
  try {
    target = new URL(route.path, base.endsWith('/') ? base : `${base}/`);
    const baseUrl = new URL(base);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error('Invalid Snapchain URL');
  } catch {
    return res.status(500).json({ error: 'SNAPCHAIN_URL must be a valid HTTP or HTTPS origin' });
  }

  for (const [name, value] of url.searchParams.entries()) {
    if (name === 'route') continue;
    if (!route.params.includes(name) || !validateParam(name, value)) return res.status(400).json({ error: `Invalid ${name} parameter` });
    target.searchParams.set(name, value);
  }
  if (route.params.includes('fid') && !target.searchParams.has('fid')) return res.status(400).json({ error: 'fid is required' });
  if (routeName === 'castById' && !target.searchParams.has('hash')) return res.status(400).json({ error: 'hash is required' });
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
    const response = await fetch(target, { method: route.method, headers, body, signal: AbortSignal.timeout(12_000) });
    const raw = await readResponse(response);
    let result;
    try { result = raw ? JSON.parse(raw) : {}; } catch { result = { error: 'Snapchain returned an unreadable response' }; }
    res.setHeader('Cache-Control', 'no-store');
    if (response.status >= 400) {
      const message = String(result.details || result.error || result.message || 'Snapchain rejected the request').slice(0, 500);
      return res.status(response.status === 404 ? 404 : response.status >= 500 ? 502 : response.status).json({ error: message });
    }
    return res.status(200).json(result);
  } catch (error) {
    const knownLimit = error.message === 'Message is larger than the 64 KB limit' || error.message === 'Snapchain response exceeded the 2 MB limit';
    return res.status(502).json({ error: knownLimit ? error.message : 'Could not reach the configured Snapchain node' });
  }
};

export const config = { api: { bodyParser: false } };
