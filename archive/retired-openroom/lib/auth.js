const crypto = require('node:crypto');

const COOKIE = 'openroom_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function cookieValue(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) { try { return decodeURIComponent(value.join('=')); } catch { return ''; } }
  }
  return '';
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueSession(res, { fid, signerUuid }) {
  if (!Number.isSafeInteger(Number(fid)) || Number(fid) < 1 || typeof signerUuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(signerUuid)) throw new Error('Invalid Farcaster session');
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const body = Buffer.from(JSON.stringify({ fid: Number(fid), signerUuid, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url');
  const token = `${body}.${sign(body, secret)}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`);
}

function getSession(req) {
  const secret = process.env.SESSION_SECRET;
  const token = cookieValue(req, COOKIE);
  if (!secret || secret.length < 32 || !token) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isInteger(payload.fid) || !payload.signerUuid || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function isSameOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (!host) return false;
  if (!origin) {
    const referer = req.headers?.referer;
    try { return !!referer && new URL(referer).host.toLowerCase() === String(host).toLowerCase(); }
    catch { return false; }
  }
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

module.exports = { issueSession, clearSession, getSession, isSameOrigin };
