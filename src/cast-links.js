const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(String(value)).length;
}

function validHttpsUrl(value, maxBytes) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || byteLength(url.href) > maxBytes) return '';
    return url.href;
  } catch { return ''; }
}

/** Build a small, deduplicated set of URL embeds for links in the cast and attached media. */
export function castEmbedUrls(text, attachedUrls = [], { limit = 4, maxUrlBytes = 256 } = {}) {
  const urls = [];
  const seen = new Set();
  const add = (candidate) => {
    const url = validHttpsUrl(String(candidate || ''), maxUrlBytes);
    if (!url || seen.has(url) || urls.length >= limit) return;
    seen.add(url);
    urls.push(url);
  };

  for (const url of attachedUrls) add(url);
  for (const match of String(text || '').matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
    // Sentence punctuation commonly follows a URL in prose; keep it in the cast text.
    add(match[0].replace(/[),.!?:;\]}]+$/g, ''));
  }
  return urls;
}
