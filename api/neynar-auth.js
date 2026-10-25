import {
  clearManagedCookies, getManagedSession, isSameOrigin, managedAuthConfigured,
} from './neynar-session.js';

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

async function neynar(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.neynar.com${path}`, {
    method,
    headers: { 'x-api-key': process.env.NEYNAR_API_KEY, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 502 : response.status >= 500 ? 502 : response.status;
    throw Object.assign(new Error(response.status >= 500 ? 'Neynar sign-in is temporarily unavailable.' : 'Neynar could not complete managed sign-in. Check the app configuration and try again.'), { status });
  }
  return data;
}

async function signerStatus(signerUuid) {
  const url = new URL('https://api.neynar.com/v2/farcaster/signer/');
  url.searchParams.set('signer_uuid', signerUuid);
  return neynar(`${url.pathname}${url.search}`);
}

export default async function neynarAuth(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || '';
  if (url.searchParams.getAll('action').length > 1) return send(res, 400, { error: 'Invalid managed sign-in request.' });

  if (action === 'start') return send(res, 410, { error: 'New Neynar managed sign-ins are not currently available.' });
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'Method not allowed.' }); }
  if (req.method === 'POST' && !isSameOrigin(req)) return send(res, 403, { error: 'Request origin could not be verified.' });
  if (req.method === 'POST' && action === 'logout') {
    clearManagedCookies(res, req);
    return send(res, 200, { ok: true });
  }
  if (!managedAuthConfigured()) return send(res, 503, { error: 'Neynar managed sign-in is not configured on this deployment yet.' });

  try {
    if (req.method === 'GET' && action === 'me') {
      const session = getManagedSession(req);
      if (!session) return send(res, 200, { signedIn: false });
      const signer = await signerStatus(session.signerUuid);
      if (signer.status !== 'approved' || Number(signer.fid) !== session.fid) {
        clearManagedCookies(res, req);
        return send(res, 200, { signedIn: false });
      }
      return send(res, 200, { signedIn: true, fid: session.fid });
    }
    return send(res, 404, { error: 'Unknown managed sign-in action.' });
  } catch (error) {
    const status = Number(error?.status) || 502;
    return send(res, status, { error: status >= 500 ? 'Neynar sign-in is temporarily unavailable. Check the server configuration and try again.' : 'Neynar could not complete managed sign-in. Check the request and try again.' });
  }
}
