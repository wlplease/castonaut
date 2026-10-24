/** True for Farcaster's canonical, published Mini App universal links. */
export function isFarcasterMiniAppLink(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value));
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'farcaster.xyz'
      && /^\/miniapps\/[a-z\d_-]+\/[a-z\d-]+(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}
