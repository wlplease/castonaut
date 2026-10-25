import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex, hexToBytes } from 'viem';
import { clientAddress, consumeWindow } from './request-security.js';
import {
  clearManagedCookies, getManagedSession, getPendingSession, isSameOrigin,
  managedAuthConfigured, setManagedSession, setPendingSession,
} from './neynar-session.js';

const attempts = new Map();
const UUID = /^[0-9a-f-]{36}$/i;

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function ip(req) {
  return clientAddress(req);
}

function allowStart(req) {
  return consumeWindow(attempts, ip(req), { limit: 4, windowMs: 60 * 60 * 1000 });
}

function safeApprovalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ['warpcast.com', 'farcaster.xyz', 'client.warpcast.com'].includes(url.hostname) ? url.href : '';
  } catch { return ''; }
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

  if (req.method === 'GET' && action === 'config') return send(res, 200, { enabled: managedAuthConfigured() });
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'Method not allowed.' }); }
  if (req.method === 'POST' && !isSameOrigin(req)) return send(res, 403, { error: 'Request origin could not be verified.' });
  if (req.method === 'POST' && action === 'logout') {
    clearManagedCookies(res, req);
    return send(res, 200, { ok: true });
  }
  if (!managedAuthConfigured()) return send(res, 503, { error: 'Neynar managed sign-in is not configured on this deployment yet.' });

  try {
    if (req.method === 'POST' && action === 'start') {
      if (!allowStart(req)) return send(res, 429, { error: 'Too many sign-in attempts. Try again in an hour.' });
      let signerUuid = '';
      let publicKey = '';
      const pending = getPendingSession(req);
      if (pending) {
        const existing = await signerStatus(pending.signerUuid);
        if (existing.status === 'approved' && Number(existing.fid) > 0) {
          setManagedSession(res, req, { fid: Number(existing.fid), signerUuid: pending.signerUuid });
          return send(res, 200, { status: 'approved', fid: Number(existing.fid) });
        }
        const approvalUrl = safeApprovalUrl(existing.signer_approval_url);
        if (existing.status === 'pending_approval') {
          if (!approvalUrl) return send(res, 502, { error: 'Neynar could not restore the existing approval link. Try again shortly.' });
          return send(res, 200, { status: 'pending', approvalUrl });
        }
        if (existing.status === 'generated' && /^0x[0-9a-f]{64}$/i.test(String(existing.public_key || ''))) {
          signerUuid = pending.signerUuid;
          publicKey = String(existing.public_key);
        }
      }
      const appFid = Number(process.env.CASTONAUT_APP_FID);
      if (!Number.isSafeInteger(appFid) || appFid < 1) return send(res, 503, { error: 'The Castonaut app FID is not configured correctly.' });
      const appPrivateKey = String(process.env.CASTONAUT_APP_PRIVATE_KEY || '');
      if (!/^0x[0-9a-f]{64}$/i.test(appPrivateKey)) return send(res, 503, { error: 'The Castonaut app signing key is not configured correctly.' });
      if (!signerUuid) {
        const created = await neynar('/v2/farcaster/signer/', { method: 'POST' });
        signerUuid = String(created.signer_uuid || '');
        publicKey = String(created.public_key || '');
        if (UUID.test(signerUuid)) setPendingSession(res, req, signerUuid);
      }
      if (!UUID.test(signerUuid) || !/^0x[0-9a-f]{64}$/i.test(publicKey)) return send(res, 502, { error: 'Neynar returned an incomplete signer request.' });
      const account = privateKeyToAccount(appPrivateKey);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 60;
      const signature = await account.signTypedData({
        domain: { name: 'Farcaster SignedKeyRequestValidator', version: '1', chainId: 10, verifyingContract: '0x00000000FC700472606ED4fA22623Acf62c60553' },
        types: { SignedKeyRequest: [{ name: 'requestFid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'deadline', type: 'uint256' }] },
        primaryType: 'SignedKeyRequest',
        message: { requestFid: BigInt(appFid), key: publicKey, deadline: BigInt(deadline) },
      });
      const registered = await neynar('/v2/farcaster/signer/signed_key/', {
        method: 'POST',
        body: { app_fid: appFid, deadline, signature: bytesToHex(hexToBytes(signature)), signer_uuid: signerUuid },
      });
      const approvalUrl = safeApprovalUrl(registered.signer_approval_url || registered.signer_approved_url);
      if (!approvalUrl) return send(res, 502, { error: 'Neynar did not return a valid Farcaster approval link.' });
      return send(res, 200, { approvalUrl });
    }
    if (req.method === 'GET' && action === 'status') {
      const pending = getPendingSession(req);
      const existing = getManagedSession(req);
      const signerUuid = pending?.signerUuid || existing?.signerUuid;
      if (!signerUuid) return send(res, 401, { status: 'none' });
      const signer = await signerStatus(signerUuid);
      const status = String(signer.status || 'pending_approval');
      const fid = Number(signer.fid || existing?.fid);
      if (status === 'approved' && Number.isSafeInteger(fid) && fid > 0) {
        setManagedSession(res, req, { fid, signerUuid });
        return send(res, 200, { status: 'approved', fid });
      }
      if (status === 'revoked' || status === 'deleted') {
        clearManagedCookies(res, req);
        return send(res, 200, { status: 'revoked' });
      }
      return send(res, 200, { status: pending ? 'pending' : 'expired' });
    }
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
