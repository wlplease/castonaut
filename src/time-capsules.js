import { CAST_EMBED_LIMIT, CAST_EMBED_URL_LIMIT, CAST_LIMIT, truncateUtf8, utf8ByteLength } from './cast-attribution.js';

const CAPSULE_LIMIT = 14;
const CAPSULE_CAST_LIMIT = 30;
const HASH_PATTERN = /^0x[\da-f]{40,64}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createTimeCapsule(messages, { date, feed, usernameFor, hashFor, savedAt = Date.now() } = {}) {
  if (!DATE_PATTERN.test(String(date || ''))) throw new Error('Choose a valid capsule date.');
  const casts = (Array.isArray(messages) ? messages : []).slice(0, CAPSULE_CAST_LIMIT).map((message) => {
    const fid = Number(message?.data?.fid);
    const hash = String(hashFor?.(message) || '').toLowerCase();
    let text = truncateUtf8(message?.data?.castAddBody?.text || '', CAST_LIMIT);
    const embeds = [...(message?.data?.castAddBody?.embeds || []), ...(message?.data?.castAddBody?.embedsDeprecated || [])]
      .filter((embed) => typeof embed?.url === 'string' && /^https:\/\//i.test(embed.url) && utf8ByteLength(embed.url) <= CAST_EMBED_URL_LIMIT).slice(0, CAST_EMBED_LIMIT).map((embed) => ({ url: embed.url }));
    if (!Number.isSafeInteger(fid) || fid <= 0 || !HASH_PATTERN.test(hash) || (!text.trim() && !embeds.length)) return null;
    if (!text.trim()) text = 'GIF / image signal';
    return { fid, hash, text, username: String(usernameFor?.(fid) || `fid-${fid}`).slice(0, 32), timestamp: Number(message?.data?.timestamp) || 0, embeds };
  }).filter(Boolean);
  return { date, feed: String(feed || 'following').slice(0, 24), savedAt: Number(savedAt) || Date.now(), count: casts.length, casts };
}

export function parseTimeCapsules(raw) {
  let values;
  try { values = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(values)) return [];
  return values.filter((capsule) => capsule && DATE_PATTERN.test(String(capsule.date || '')) && Array.isArray(capsule.casts))
    .slice(0, CAPSULE_LIMIT).map((capsule) => ({
      date: capsule.date,
      feed: String(capsule.feed || 'following').slice(0, 24),
      savedAt: Number(capsule.savedAt) || 0,
      casts: capsule.casts.slice(0, CAPSULE_CAST_LIMIT).filter((cast) => cast && Number.isSafeInteger(Number(cast.fid)) && Number(cast.fid) > 0 && HASH_PATTERN.test(String(cast.hash || '')))
        .map((cast) => ({ fid: Number(cast.fid), hash: cast.hash.toLowerCase(), text: truncateUtf8(cast.text || '', CAST_LIMIT), username: String(cast.username || '').slice(0, 32), timestamp: Number(cast.timestamp) || 0, embeds: Array.isArray(cast.embeds) ? cast.embeds.slice(0, CAST_EMBED_LIMIT).filter((embed) => typeof embed?.url === 'string' && /^https:\/\//i.test(embed.url) && utf8ByteLength(embed.url) <= CAST_EMBED_URL_LIMIT).map((embed) => ({ url: embed.url })) : [] })),
    }));
}

export function capsuleDateLabel(date, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!DATE_PATTERN.test(String(date || ''))) return 'Saved day';
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`));
}
