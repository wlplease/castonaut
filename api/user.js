const { getSession } = require('../lib/auth');

module.exports = async function user(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Farcaster API is not configured yet' });
  const requestedFid = Number(req.query?.fid);
  const username = String(req.query?.username || '').trim().replace(/^@/, '').toLowerCase();
  if (Number.isSafeInteger(requestedFid) && requestedFid > 0) {
    try {
      const url = new URL('https://api.neynar.com/v2/farcaster/user/bulk/');
      url.searchParams.set('fids', String(requestedFid));
      const response = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (!response.ok) return res.status(502).json({ error: 'Profile lookup failed' });
      const profile = data.users?.[0];
      if (!profile) return res.status(404).json({ error: 'User not found' });
      const castUrl = new URL('https://api.neynar.com/v2/farcaster/feed/user/casts/');
      castUrl.searchParams.set('fid', String(requestedFid)); castUrl.searchParams.set('limit', '20');
      const castResponse = await fetch(castUrl, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const castData = castResponse.ok ? await castResponse.json() : { casts: [] };
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.status(200).json({ profile, casts: Array.isArray(castData.casts) ? castData.casts : [], viewer: getSession(req)?.fid || null });
    } catch { return res.status(502).json({ error: 'Profile service is temporarily unavailable' }); }
  }
  if (!/^[a-z0-9_.-]{1,40}$/.test(username)) return res.status(400).json({ error: 'Enter a valid Farcaster username' });
  const headers = { 'x-api-key': apiKey, accept: 'application/json' };
  try {
    const u = new URL('https://api.neynar.com/v2/farcaster/user/by_username/');
    u.searchParams.set('username', username);
    const userResponse = await fetch(u, { headers, signal: AbortSignal.timeout(8000) });
    if (!userResponse.ok) return res.status(userResponse.status === 404 ? 404 : 502).json({ error: userResponse.status === 404 ? 'User not found' : 'Profile lookup failed' });
    const userData = await userResponse.json();
    const profile = userData.user;
    if (!profile?.fid) return res.status(404).json({ error: 'User not found' });
    const castUrl = new URL('https://api.neynar.com/v2/farcaster/feed/user/casts/');
    castUrl.searchParams.set('fid', String(profile.fid));
    castUrl.searchParams.set('limit', '20');
    const castsResponse = await fetch(castUrl, { headers, signal: AbortSignal.timeout(8000) });
    const castData = castsResponse.ok ? await castsResponse.json() : { casts: [] };
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ profile, casts: Array.isArray(castData.casts) ? castData.casts : [], viewer: getSession(req)?.fid || null });
  } catch {
    return res.status(502).json({ error: 'Profile service is temporarily unavailable' });
  }
};
