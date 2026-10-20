const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|mc_cid|mc_eid|ref_src)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function cleanUrl(value) {
  const candidate = String(value || '').replace(/[),.!?;:]+$/g, '');
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '');
  } catch { return null; }
}

function linksFor(message) {
  const body = message?.data?.castAddBody || {};
  const values = [...String(body.text || '').matchAll(URL_PATTERN)].map((match) => match[0]);
  for (const embed of body.embeds || []) if (embed?.url) values.push(embed.url);
  return [...new Set(values.map(cleanUrl).filter(Boolean))].sort();
}

function repeatedContentKey(message, links) {
  if (links.length === 1) return { key: `link:${links[0]}`, reason: 'link' };

  const text = String(message?.data?.castAddBody?.text || '')
    .normalize('NFKC')
    .replace(URL_PATTERN, (url) => cleanUrl(url) || url.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
  if (text.length < 48) return null;
  return { key: `text:${text}`, reason: 'text' };
}

/** Group exact repeated links, preserving the first (newest) post as the visible card. */
export function groupRepeatedCasts(messages) {
  const groups = [];
  const byKey = new Map();
  for (const message of messages) {
    const links = linksFor(message);
    const repeated = repeatedContentKey(message, links);
    const existing = repeated && byKey.get(repeated.key);
    if (existing) existing.messages.push(message);
    else {
      const group = { messages: [message], reason: repeated?.reason || null };
      groups.push(group);
      if (repeated) byKey.set(repeated.key, group);
    }
  }
  return groups;
}
