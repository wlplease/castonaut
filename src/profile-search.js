const FARCASTER_PROFILE_HOSTS = new Set(['farcaster.xyz', 'www.farcaster.xyz']);

export function normalizeProfileSearch(rawQuery) {
  let query = String(rawQuery || '').trim();
  if (/^https:\/\//i.test(query)) {
    const url = new URL(query);
    if (!FARCASTER_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error('Paste a Farcaster profile link, or search by @username or FID.');
    }
    query = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '');
  }
  // Snapchain username lookups are case-sensitive; Farcaster handles are not.
  return query.replace(/^@/, '').trim().toLowerCase();
}
