export const CAST_SHORT_LIMIT = 320;
export const CAST_LIMIT = 1024;
export const CAST_EMBED_LIMIT = 2;
export const CAST_EMBED_URL_LIMIT = 256;
export const CAST_ATTRIBUTION = '\n\nCasted from Castonaut · https://castonaut.vercel.app';

const encoder = new TextEncoder();

export function utf8ByteLength(value = '') {
  return encoder.encode(String(value)).length;
}

export const CAST_USER_LIMIT = CAST_LIMIT - utf8ByteLength(CAST_ATTRIBUTION);

export function truncateUtf8(value = '', maxBytes = CAST_USER_LIMIT) {
  let result = '';
  let used = 0;
  for (const character of String(value)) {
    const size = utf8ByteLength(character);
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

export function withCastonautAttribution(text = '') {
  const content = String(text).trim();
  const attributed = `${content}${CAST_ATTRIBUTION}`;
  if (utf8ByteLength(attributed) > CAST_LIMIT) {
    throw new Error(`Shorten this cast to ${CAST_USER_LIMIT} UTF-8 bytes so the Castonaut link fits.`);
  }
  return attributed;
}

export function castTypeForText(text, castTypes) {
  return utf8ByteLength(text) > CAST_SHORT_LIMIT ? castTypes.LONG_CAST : castTypes.CAST;
}
