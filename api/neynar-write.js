import { getManagedSession, isSameOrigin, clearManagedCookies } from './neynar-session.js';
import { clientAddress, consumeWindow } from './request-security.js';

const limits = new Map();
const UUID = /^[0-9a-f-]{36}$/i;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function rateLimit(req) {
  return consumeWindow(limits, clientAddress(req), { limit: 36, windowMs: 60_000 });
}

async function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function fid(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw Object.assign(new Error('A valid Farcaster account is required.'), { status: 400 });
  return result;
}

function hash(value) {
  const result = String(value || '');
  if (!/^0x[0-9a-f]{40,64}$/i.test(result)) throw Object.assign(new Error('A valid cast hash is required.'), { status: 400 });
  return result;
}

async function neynar(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.neynar.com${path}`, {
    method,
    headers: { 'x-api-key': process.env.NEYNAR_API_KEY, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180) : '';
    throw Object.assign(new Error(message || (response.status >= 500 ? 'Neynar is temporarily unavailable.' : 'Neynar rejected this Farcaster action.')), { status: response.status >= 500 ? 502 : response.status });
  }
  return data;
}

export default async function neynarWrite(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Method not allowed.' }); }
  if (!isSameOrigin(req)) return json(res, 403, { error: 'Request origin could not be verified.' });
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(res, 415, { error: 'Expected a JSON Farcaster action.' });
  if (!process.env.NEYNAR_API_KEY) return json(res, 503, { error: 'Managed Farcaster actions are not configured on this deployment.' });
  const session = getManagedSession(req);
  if (!session) return json(res, 401, { error: 'Your managed signer session has expired. Connect again to continue.' });
  if (!rateLimit(req)) return json(res, 429, { error: 'Too many Farcaster actions. Wait a minute and try again.' });

  try {
    const input = await bodyOf(req);
    const action = String(input.action || '');
    const signerUuid = session.signerUuid;
    const signer = await neynar(`/v2/farcaster/signer/?signer_uuid=${encodeURIComponent(signerUuid)}`);
    if (signer.status !== 'approved' || Number(signer.fid) !== session.fid) {
      clearManagedCookies(res, req);
      return json(res, 401, { error: 'This Farcaster signer is no longer approved. Connect again to continue.' });
    }

    let result;
    if (action === 'cast') {
      const text = String(input.text || '');
      if (!text.trim() || new TextEncoder().encode(text).length > 1024) throw Object.assign(new Error('Casts must contain text and fit within Farcaster’s 1,024-byte limit.'), { status: 400 });
      const embeds = Array.isArray(input.embeds) ? input.embeds.slice(0, 2).map((item) => {
        let parsed;
        try { parsed = new URL(item); } catch { throw Object.assign(new Error('Cast embeds must be valid HTTPS URLs.'), { status: 400 }); }
        if (parsed.protocol !== 'https:' || parsed.href.length > 256) throw Object.assign(new Error('Cast embeds must be HTTPS URLs up to 256 characters.'), { status: 400 });
        return { url: parsed.href };
      }) : [];
      const idem = String(input.idem || '');
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(idem)) throw Object.assign(new Error('The cast retry key is invalid.'), { status: 400 });
      const payload = { signer_uuid: signerUuid, text, embeds, idem };
      if (input.parent) {
        const parent = String(input.parent);
        if (!/^0x[0-9a-f]{40,64}$/i.test(parent) && !/^https:\/\/farcaster\.xyz\/[\w.-]+\/0x[0-9a-f]{40,64}$/i.test(parent)) throw Object.assign(new Error('The reply target is invalid.'), { status: 400 });
        payload.parent = parent;
        payload.parent_author_fid = fid(input.parent_author_fid);
      }
      result = await neynar('/v2/farcaster/cast/', { method: 'POST', body: payload });
    } else if (action === 'follow' || action === 'unfollow') {
      const targetFid = fid(input.target_fid);
      if (targetFid === session.fid) throw Object.assign(new Error('You cannot follow your own account.'), { status: 400 });
      result = await neynar('/v2/farcaster/user/follow/', { method: action === 'follow' ? 'POST' : 'DELETE', body: { signer_uuid: signerUuid, target_fids: [targetFid] } });
    } else if (['like', 'unlike', 'recast', 'unrecast'].includes(action)) {
      const targetFid = fid(input.target_fid);
      const targetHash = hash(input.hash);
      if (targetFid === session.fid) throw Object.assign(new Error('You cannot react to your own cast here.'), { status: 400 });
      const reactionType = action.includes('recast') ? 'recast' : 'like';
      const idem = String(input.idem || '');
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(idem)) throw Object.assign(new Error('The reaction retry key is invalid.'), { status: 400 });
      const payload = { signer_uuid: signerUuid, target: targetHash, target_author_fid: targetFid, reaction_type: reactionType, idem };
      result = await neynar('/v2/farcaster/reaction/', { method: action.startsWith('un') ? 'DELETE' : 'POST', body: payload });
    } else {
      return json(res, 400, { error: 'Unsupported managed Farcaster action.' });
    }
    return json(res, 200, result);
  } catch (error) {
    const status = Number(error?.status) || 502;
    if (status >= 500) return json(res, status, { error: 'Neynar is temporarily unavailable. Your action may not have completed; check the feed before retrying.' });
    return json(res, status, { error: 'Neynar rejected this action. Check the account, permissions, and target, then try again.' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
