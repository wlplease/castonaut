import { isIP } from 'node:net';

// Vercel replaces x-forwarded-for at its edge. Ignore malformed values and
// bound all in-memory limiter keys so spoofed headers cannot grow the map.
export function clientAddress(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded.length <= 64 && isIP(forwarded)) return forwarded;
  const remote = String(req.socket?.remoteAddress || '').trim();
  if (remote.length <= 64 && isIP(remote)) return remote;
  return 'unknown';
}

export function consumeWindow(map, key, { limit, windowMs, maxEntries = 4096 }) {
  const now = Date.now();
  for (const [entryKey, record] of map) {
    if (now - record.start >= windowMs) map.delete(entryKey);
  }
  let record = map.get(key);
  if (!record || now - record.start >= windowMs) {
    if (map.size >= maxEntries) map.delete(map.keys().next().value);
    record = { start: now, count: 0 };
    map.set(key, record);
  }
  if (record.count >= limit) return false;
  record.count++;
  return true;
}
