import { createHash } from 'node:crypto';
import { handleUpload, handleUploadPresigned } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { clientAddress } from './request-security.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 12;
const ONE_YEAR = 60 * 60 * 24 * 365;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const RATE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
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

function configuration() {
  const blobMode = process.env.BLOB_STORE_ID && process.env.BLOB_WEBHOOK_PUBLIC_KEY
    ? 'presigned'
    : process.env.BLOB_READ_WRITE_TOKEN ? 'token' : null;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || '';
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!blobMode || !redisUrl || !redisToken) return null;
  try {
    const redis = new URL(redisUrl);
    if (redis.protocol !== 'https:' || !/(^|\.)upstash\.io$/i.test(redis.hostname) || redis.username || redis.password || redis.port || redis.search || redis.hash) return null;
    return { blobMode, redisUrl: redis.toString().replace(/\/$/, ''), redisToken };
  } catch { return null; }
}

async function checkUploadLimit(config, req) {
  const addressHash = createHash('sha256').update(clientAddress(req)).digest('hex').slice(0, 24);
  const bucket = Math.floor(Date.now() / RATE_WINDOW_MS);
  const response = await fetch(config.redisUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.redisToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(['EVAL', RATE_SCRIPT, '1', `castonaut:blob-upload:${addressHash}:${bucket}`, String(RATE_WINDOW_MS * 2)]),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('The upload rate limiter is unavailable.');
  const result = await response.json();
  const count = Number(result?.result);
  if (!Number.isSafeInteger(count)) throw new Error('The upload rate limiter returned an invalid response.');
  return count <= RATE_LIMIT;
}

function validPathname(pathname) {
  return typeof pathname === 'string' && /^casts\/[a-z0-9-]{12,96}\.(?:jpg|jpeg|png|gif|webp)$/i.test(pathname);
}

async function authorize(pathname) {
  if (!validPathname(pathname)) throw new Error('Choose an image file using Castonaut.');
}

export default async function uploadImage(req, res) {
  const config = configuration();
  if (req.method === 'GET') {
    return send(res, 200, { enabled: Boolean(config), mode: config?.blobMode || null, maxBytes: MAX_IMAGE_BYTES });
  }
  if (req.method !== 'POST') { res.setHeader('allow', 'GET, POST'); return send(res, 405, { error: 'Use GET or POST.' }); }
  if (!config) return send(res, 503, { error: 'Photo uploads need a connected public Vercel Blob store and the shared Upstash rate limiter.' });

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
    return send(res, 400, { error: 'The upload request is not valid.' });
  }

  try {
    if (body.type === 'blob.generate-client-token' || body.type === 'blob.generate-presigned-url') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Photo uploads must come from Castonaut.' });
      if (!await checkUploadLimit(config, req)) return send(res, 429, { error: 'Upload limit reached. Try again in 15 minutes.' });
    }

    const result = config.blobMode === 'presigned'
      ? await handleUploadPresigned({
        body,
        request: req,
        getSignedToken: async (pathname) => {
          await authorize(pathname);
          const validUntil = Date.now() + 10 * 60 * 1000;
          const token = await issueSignedToken({ pathname, operations: ['put'], allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_IMAGE_BYTES, validUntil });
          return { token, urlOptions: { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_IMAGE_BYTES, addRandomSuffix: true, cacheControlMaxAge: ONE_YEAR } };
        },
      })
      : await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname) => {
          await authorize(pathname);
          return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_IMAGE_BYTES, validUntil: Date.now() + 10 * 60 * 1000, addRandomSuffix: true, cacheControlMaxAge: ONE_YEAR };
        },
      });
    return send(res, 200, result);
  } catch (error) {
    console.error('Castonaut photo upload authorization failed:', error instanceof Error ? error.name : 'unknown error');
    return send(res, 400, { error: 'Could not authorize this photo upload. Check the image and try again.' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };
