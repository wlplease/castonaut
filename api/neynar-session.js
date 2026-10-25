import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE = 'castonaut_managed_session';
export const PENDING_COOKIE = 'castonaut_managed_pending';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PENDING_SECONDS = 60 * 20;

function cookieName(req, name) {
  // __Host cookies require Secure, Path=/, and no Domain, which prevents a
  // sibling subdomain from planting or shadowing an authenticated cookie.
  return secureCookie(req) ? `__Host-${name}` : name;
}

function secret() {
  const value = process.env.CASTONAUT_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('Managed sign-in is not configured.');
  return value;
}

function signature(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function seal(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signature(body)}`;
}

function unseal(value) {
  if (typeof value !== 'string') return null;
  const [body, supplied, extra] = value.split('.');
  if (!body || !supplied || extra) return null;
  let expected;
  try { expected = Buffer.from(signature(body)); } catch { return null; }
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

function cookie(req, name) {
  const target = cookieName(req, name);
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === target) {
      try { return decodeURIComponent(value.join('=')); } catch { return ''; }
    }
  }
  return '';
}

function secureCookie(req) {
  return process.env.NODE_ENV === 'production' || String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setCookie(res, req, name, value, seconds) {
  const secure = secureCookie(req) ? '; Secure' : '';
  const current = res.getHeader('Set-Cookie');
  const next = `${cookieName(req, name)}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}; Priority=High${secure}`;
  res.setHeader('Set-Cookie', [...(Array.isArray(current) ? current : current ? [current] : []), next]);
}

export function setPendingSession(res, req, signerUuid) {
  setCookie(res, req, PENDING_COOKIE, seal({ signerUuid, exp: Math.floor(Date.now() / 1000) + PENDING_SECONDS }), PENDING_SECONDS);
}

export function setManagedSession(res, req, { fid, signerUuid }) {
  const numericFid = Number(fid);
  if (!Number.isSafeInteger(numericFid) || numericFid < 1 || !/^[0-9a-f-]{36}$/i.test(String(signerUuid || ''))) throw new Error('Neynar returned an invalid account session.');
  setCookie(res, req, AUTH_COOKIE, seal({ fid: numericFid, signerUuid, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }), SESSION_SECONDS);
  clearCookie(res, req, PENDING_COOKIE);
}

export function getManagedSession(req) {
  const value = unseal(cookie(req, AUTH_COOKIE));
  if (!value || !Number.isSafeInteger(value.fid) || value.fid < 1 || !/^[0-9a-f-]{36}$/i.test(String(value.signerUuid || ''))) return null;
  return value;
}

export function getPendingSession(req) {
  const value = unseal(cookie(req, PENDING_COOKIE));
  return value && /^[0-9a-f-]{36}$/i.test(String(value.signerUuid || '')) ? value : null;
}

export function clearCookie(res, req, name) {
  const secure = secureCookie(req) ? '; Secure' : '';
  const current = res.getHeader('Set-Cookie');
  const next = `${cookieName(req, name)}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Priority=High${secure}`;
  res.setHeader('Set-Cookie', [...(Array.isArray(current) ? current : current ? [current] : []), next]);
}

export function clearManagedCookies(res, req) {
  const secure = secureCookie(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', [AUTH_COOKIE, PENDING_COOKIE].map((name) => `${cookieName(req, name)}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Priority=High${secure}`));
}

export function isSameOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (!origin || !host || (req.headers?.['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return false;
  try {
    const parsed = new URL(origin);
    const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host.toLowerCase() === String(host).toLowerCase() && (!proto || parsed.protocol === `${proto}:`);
  } catch { return false; }
}

export function managedAuthConfigured() {
  return Boolean(process.env.NEYNAR_API_KEY && process.env.CASTONAUT_APP_FID && process.env.CASTONAUT_APP_PRIVATE_KEY && process.env.CASTONAUT_SESSION_SECRET?.length >= 32);
}
