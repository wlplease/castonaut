const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TAG_PATTERN = /#[\p{L}\p{N}_]{2,40}/gu;

export function castBody(message) { return message?.data?.castAddBody || {}; }
export function hasLinkEmbed(message) {
  const body = castBody(message);
  return [...(Array.isArray(body.embeds) ? body.embeds : []), ...(Array.isArray(body.embedsDeprecated) ? body.embedsDeprecated : [])]
    .some((embed) => typeof embed?.url === 'string' && /^https:\/\//i.test(embed.url));
}
export function isImageEmbedUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    if (/\.(?:apng|avif|bmp|gif|jpe?g|png|webp)$/i.test(url.pathname)) return true;
    return /(?:^|\.)(?:imagedelivery\.net|media\.tenor\.com)$/i.test(url.hostname)
      || (url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/'))
      || (url.hostname === 'res.cloudinary.com' && /\/image\//.test(url.pathname));
  } catch { return false; }
}
export function isGifEmbedUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    return /\.gif$/i.test(url.pathname)
      || (url.hostname === 'media.tenor.com' && /\.(?:gif|webp)$/i.test(url.pathname));
  } catch { return false; }
}
export function isVideoEmbedUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    return /\.(?:m4v|mov|mp4|webm)$/i.test(url.pathname);
  } catch { return false; }
}
export function hasMedia(message) {
  const body = castBody(message);
  return [...(Array.isArray(body.embeds) ? body.embeds : []), ...(Array.isArray(body.embedsDeprecated) ? body.embedsDeprecated : [])]
    .some((embed) => {
      if (typeof embed?.url !== 'string') return false;
      try {
        const url = new URL(embed.url);
        if (url.protocol !== 'https:') return false;
        if (/\.(?:apng|avif|bmp|gif|jpe?g|m4a|m4v|mov|mp3|mp4|ogg|png|webm|webp|wav)(?:$)/i.test(url.pathname)) return true;
        return /(?:^|\.)(?:imagedelivery\.net|media\.tenor\.com)$/i.test(url.hostname)
          || (url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/'))
          || (url.hostname === 'res.cloudinary.com' && /\/(?:image|video|raw)\//.test(url.pathname));
      } catch { return false; }
    });
}
export function isReply(message) {
  const parent = castBody(message).parentCastId;
  return !!parent && Number(parent.fid) > 0 && !!parent.hash;
}
export function topicsForCast(message) {
  const body = castBody(message);
  const topics = new Set([...String(body.text || '').matchAll(TAG_PATTERN)].map(([tag]) => tag.toLocaleLowerCase()));
  const urls = [...String(body.text || '').matchAll(URL_PATTERN)].map(([url]) => url);
  for (const embed of body.embeds || []) if (embed?.url) urls.push(embed.url);
  for (const raw of urls) {
    try {
      const url = new URL(raw.replace(/[),.!?;:]+$/g, ''));
      if (url.protocol === 'https:') topics.add(`site:${url.hostname.replace(/^www\./i, '').toLowerCase()}`);
    } catch { /* Invalid links are not mute topics. */ }
  }
  return [...topics].slice(0, 12);
}
export function visibleByFeedOptions(message, options = {}) {
  if (options.repliesOnly && !isReply(message)) return false;
  if (options.mediaOnly && !hasMedia(message)) return false;
  if (options.appsOnly && !hasLinkEmbed(message)) return false;
  if (options.mutedTopics?.size && topicsForCast(message).some((topic) => options.mutedTopics.has(topic))) return false;
  return true;
}
