export const CAST_LIMIT = 320;
export const CAST_ATTRIBUTION = '\n\nCasted from Castonaut · https://castonaut.vercel.app';
export const CAST_USER_LIMIT = CAST_LIMIT - [...CAST_ATTRIBUTION].length;

export function withCastonautAttribution(text = '') {
  const content = String(text).trim();
  const attributed = `${content}${CAST_ATTRIBUTION}`;
  if ([...attributed].length > CAST_LIMIT) {
    throw new Error(`Shorten this cast to ${CAST_USER_LIMIT} characters so the Castonaut link fits.`);
  }
  return attributed;
}
