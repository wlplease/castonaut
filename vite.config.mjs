import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

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
  reactionsByCast: { path: '/v1/reactionsByCast', method: 'GET', params: ['target_fid', 'target_hash', 'reaction_type', 'pageSize', 'pageToken', 'reverse'] },
  submit: { path: '/v1/submitMessage', method: 'POST', params: [] },
};

function validParam(name, value) {
  if (name === 'fid' || name === 'target_fid') return /^[1-9]\d{0,14}$/.test(value);
  if (name === 'name') return /^[\p{L}\p{N}._-]{1,64}$/u.test(value);
  if (name === 'pageSize') return /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100;
  if (name === 'reverse') return ['true', 'false', '1', '0'].includes(value);
  if (name === 'startTimestamp' || name === 'stopTimestamp') return /^\d{1,12}$/.test(value);
  if (name === 'hash' || name === 'target_hash') return /^0x[0-9a-f]{40,64}$/i.test(value);
  if (name === 'link_type') return value === 'follow';
  if (name === 'reaction_type') return value === 'Like' || value === 'Recast';
  if (name === 'user_data_type') return /^[A-Z0-9_]{1,48}$/.test(value) || /^\d{1,2}$/.test(value);
  if (name === 'requesterFids') return /^[0-9,]{1,120}$/.test(value);
  if (name === 'pageToken') return value.length <= 2048 && /^[A-Za-z0-9+/_=-]*$/.test(value);
  return false;
}

function sameOriginWrite(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return false;
  try {
    const parsed = new URL(origin);
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (forwardedProto && parsed.protocol !== `${forwardedProto}:`) return false;
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host.toLowerCase() === String(host).toLowerCase();
  } catch { return false; }
}

function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

function safeRejectionReason(result) {
  const raw = typeof result?.message === 'string'
    ? result.message
    : typeof result?.error === 'string'
      ? result.error
      : typeof result?.errCode === 'string'
        ? result.errCode
        : '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

async function readLimitedText(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Snapchain response exceeded the 2 MB limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function localSnapchainAdapter(serverEnv) {
  return {
    name: 'castonaut-local-snapchain-adapter',
    configureServer(server) {
      server.middlewares.use('/api/snapchain', async (req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const routeName = requestUrl.searchParams.get('route');
        const route = ROUTES[routeName];
        const base = serverEnv.SNAPCHAIN_URL;
        const proxyUrl = serverEnv.SNAPCHAIN_PROXY_URL;
        if (!route) return sendJson(res, 404, { error: 'Unknown Snapchain route' });
        if (!base && !proxyUrl) return sendJson(res, 503, { error: 'No Snapchain route is configured. Set SNAPCHAIN_URL or SNAPCHAIN_PROXY_URL for local development.' });
        if (req.method !== route.method) { res.setHeader('allow', route.method); return sendJson(res, 405, { error: 'Method not allowed' }); }
        const freshParams = requestUrl.searchParams.getAll('_fresh');
        if (freshParams.length > 1 || (freshParams.length === 1 && (freshParams[0] !== '1' || route.method !== 'GET'))) return sendJson(res, 400, { error: 'Invalid refresh parameter' });
        if (route.method === 'POST') {
          if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Write request origin could not be verified' });
          if (req.headers['content-type']?.split(';')[0].trim() !== 'application/octet-stream') return sendJson(res, 415, { error: 'Snapchain messages must use application/octet-stream' });
        }
        try {
          const baseUrl = base ? new URL(base) : null;
          if (baseUrl && (!['https:', 'http:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash)) throw new Error('SNAPCHAIN_URL must be an HTTP or HTTPS origin');
          const proxyTarget = !base && proxyUrl ? new URL(proxyUrl) : null;
          if (proxyTarget && (proxyTarget.protocol !== 'https:' || proxyTarget.username || proxyTarget.password || proxyTarget.pathname !== '/api/snapchain' || proxyTarget.search || proxyTarget.hash)) throw new Error('SNAPCHAIN_PROXY_URL must be an HTTPS /api/snapchain URL');
          if (Boolean(serverEnv.SNAPCHAIN_HTTP_USER) !== Boolean(serverEnv.SNAPCHAIN_HTTP_PASS)) throw new Error('Both proxy credential variables must be set together');
          if (proxyTarget && (serverEnv.SNAPCHAIN_HTTP_USER || serverEnv.SNAPCHAIN_HTTP_PASS)) throw new Error('Node credentials cannot be forwarded through SNAPCHAIN_PROXY_URL.');
          const target = proxyTarget || new URL(route.path, baseUrl);
          if (proxyTarget) target.searchParams.set('route', routeName);
          if ((serverEnv.SNAPCHAIN_HTTP_USER || serverEnv.SNAPCHAIN_HTTP_PASS) && target.protocol !== 'https:') throw new Error('Proxy credentials require an HTTPS Snapchain endpoint.');
          for (const [key, value] of requestUrl.searchParams.entries()) {
            if (key === 'route' || key === '_fresh') continue;
            if (!route.params.includes(key) || !validParam(key, value)) return sendJson(res, 400, { error: `Invalid ${key} parameter` });
            target.searchParams.set(key, value);
          }
          if (route.params.includes('fid') && !target.searchParams.has('fid')) return sendJson(res, 400, { error: 'fid is required' });
          if (routeName === 'castById' && !target.searchParams.has('hash')) return sendJson(res, 400, { error: 'hash is required' });
          if (routeName === 'replies' && (!target.searchParams.has('fid') || !target.searchParams.has('hash'))) return sendJson(res, 400, { error: 'parent fid and hash are required' });
          if (routeName === 'linkById' && !target.searchParams.has('target_fid')) return sendJson(res, 400, { error: 'target_fid is required' });
          if (routeName === 'reactionById' && (!target.searchParams.has('target_fid') || !target.searchParams.has('target_hash') || !target.searchParams.has('reaction_type'))) return sendJson(res, 400, { error: 'reaction target and type are required' });
          if (routeName === 'reactionsByCast' && (!target.searchParams.has('target_fid') || !target.searchParams.has('target_hash') || !target.searchParams.has('reaction_type'))) return sendJson(res, 400, { error: 'reaction target and type are required' });
          if (requestUrl.searchParams.getAll('route').length !== 1) return sendJson(res, 400, { error: 'Exactly one Snapchain route is required' });
          const params = [...requestUrl.searchParams.keys()].filter((key) => key !== 'route' && key !== '_fresh');
          if (new Set(params).size !== params.length) return sendJson(res, 400, { error: 'Duplicate query parameters are not allowed' });
          const headers = { accept: 'application/json' };
          if (proxyTarget && req.method === 'POST') headers.origin = proxyTarget.origin;
          let body;
          if (req.method === 'POST') {
            const chunks = []; let length = 0;
            for await (const chunk of req) { length += chunk.length; if (length > 64 * 1024) throw new Error('Message exceeds the 64 KB local limit'); chunks.push(chunk); }
            body = Buffer.concat(chunks); headers['content-type'] = 'application/octet-stream';
          }
          if (serverEnv.SNAPCHAIN_HTTP_USER && serverEnv.SNAPCHAIN_HTTP_PASS) headers.authorization = `Basic ${Buffer.from(`${serverEnv.SNAPCHAIN_HTTP_USER}:${serverEnv.SNAPCHAIN_HTTP_PASS}`).toString('base64')}`;
          const upstream = await fetch(target, { method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(12_000) });
          const raw = await readLimitedText(upstream, 2 * 1024 * 1024);
          let result;
          try { result = raw ? JSON.parse(raw) : {}; } catch { return sendJson(res, 502, { error: 'Snapchain returned an unreadable response' }); }
          if (upstream.status >= 400) {
            const reason = safeRejectionReason(result);
            if (routeName === 'castById' && upstream.status === 400 && /^failed to get cast(?:$|[:\s])/i.test(reason)) return sendJson(res, 404, { error: 'Cast not found' });
            if (routeName === 'linkById' && upstream.status === 400 && /^failed to get link(?:$|[:\s])/i.test(reason)) return sendJson(res, 404, { error: 'Link not found' });
            if (routeName === 'reactionById' && upstream.status === 400 && /^failed to get reaction(?:$|[:\s])/i.test(reason)) return sendJson(res, 404, { error: 'Reaction not found' });
            const status = upstream.status >= 500 ? 502 : upstream.status;
            return sendJson(res, status, { error: upstream.status >= 500 ? 'Snapchain is temporarily unavailable.' : `Snapchain rejected the request (${upstream.status}).${reason ? ` ${reason}` : ' Check the account or message and try again.'}` });
          }
          return sendJson(res, 200, result);
        } catch (error) {
          const message = error.message.includes('64 KB') || error.message.includes('2 MB') || error.message.includes('SNAPCHAIN_URL') || error.message.includes('credential')
            ? error.message : 'Could not reach the configured Snapchain node.';
          return sendJson(res, 502, { error: message });
        }
      });
    },
  };
}

function localGiphyAdapter(serverEnv) {
  return {
    name: 'castonaut-local-giphy-adapter',
    configureServer(server) {
      server.middlewares.use('/api/giphy', async (req, res) => {
        const proxyUrl = serverEnv.GIPHY_PROXY_URL;
        if (!proxyUrl) return sendJson(res, 503, { enabled: false, error: 'GIF search is not configured.' });
        if (!['GET', 'POST'].includes(req.method)) { res.setHeader('allow', 'GET, POST'); return sendJson(res, 405, { error: 'Method not allowed' }); }
        if (req.method === 'POST' && !sameOriginWrite(req)) return sendJson(res, 403, { error: 'Request origin could not be verified.' });
        try {
          const target = new URL(proxyUrl);
          if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/api/giphy' || target.search || target.hash) throw new Error('GIPHY_PROXY_URL must be an HTTPS /api/giphy URL');
          const headers = { accept: 'application/json' };
          let body;
          if (req.method === 'POST') {
            if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return sendJson(res, 415, { error: 'Expected a JSON request.' });
            const chunks = []; let length = 0;
            for await (const chunk of req) { length += chunk.length; if (length > 1024) return sendJson(res, 413, { error: 'Request is too large.' }); chunks.push(chunk); }
            let parsed;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(res, 400, { error: 'Invalid JSON request.' }); }
            const query = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
            if (parsed?.action !== 'search' || query.length < 1 || query.length > 50 || /[\u0000-\u001f\u007f]/.test(query)) return sendJson(res, 400, { error: 'Invalid GIF search request.' });
            headers['content-type'] = 'application/json';
            headers.origin = target.origin;
            body = JSON.stringify({ action: 'search', query });
          }
          const upstream = await fetch(target, { method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(5000) });
          const raw = await readLimitedText(upstream, 1_000_000);
          let result;
          try { result = raw ? JSON.parse(raw) : {}; } catch { return sendJson(res, 502, { error: 'GIF service returned an unreadable response.' }); }
          return sendJson(res, upstream.status, result, upstream.headers.get('retry-after') ? { 'retry-after': upstream.headers.get('retry-after') } : {});
        } catch (error) {
          return sendJson(res, 502, { enabled: false, error: error.message.includes('GIPHY_PROXY_URL') ? error.message : 'GIF service is temporarily unavailable.' });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite does not put .env values in process.env for config plugins. Read them
  // here, and pass only the server-side Snapchain settings to the adapter.
  const loaded = loadEnv(mode, process.cwd(), '');
  const serverEnv = {
    SNAPCHAIN_URL: process.env.SNAPCHAIN_URL || loaded.SNAPCHAIN_URL || '',
    SNAPCHAIN_PROXY_URL: process.env.SNAPCHAIN_PROXY_URL || loaded.SNAPCHAIN_PROXY_URL || 'https://castonaut.vercel.app/api/snapchain',
    SNAPCHAIN_HTTP_USER: process.env.SNAPCHAIN_HTTP_USER || loaded.SNAPCHAIN_HTTP_USER || '',
    SNAPCHAIN_HTTP_PASS: process.env.SNAPCHAIN_HTTP_PASS || loaded.SNAPCHAIN_HTTP_PASS || '',
    GIPHY_PROXY_URL: process.env.GIPHY_PROXY_URL || loaded.GIPHY_PROXY_URL || 'https://castonaut.vercel.app/api/giphy',
  };

  return {
    plugins: [localSnapchainAdapter(serverEnv), localGiphyAdapter(serverEnv)],
    resolve: {
      alias: [{ find: /^@faker-js\/faker$/, replacement: resolve(process.cwd(), 'src/faker-compat.js') }],
    },
    publicDir: 'public',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          tutorial: resolve(process.cwd(), 'tutorial.html'),
          privacy: resolve(process.cwd(), 'privacy.html'),
          terms: resolve(process.cwd(), 'terms.html'),
          endorsements: resolve(process.cwd(), 'endorsements.html'),
        },
      },
    },
    server: { port: 5175, strictPort: true },
  };
});
