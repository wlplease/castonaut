const NEYNAR_URL = 'https://api.neynar.com/v2/farcaster/feed/channels/';
const ALLOWED_CHANNELS = new Set(['farcaster', 'art', 'design', 'dev']);
const { getSession } = require('../lib/auth');

module.exports = async function feed(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Live feed is not configured yet' });

  const requested = typeof req.query?.channel === 'string' ? req.query.channel : 'farcaster';
  const channel = ALLOWED_CHANNELS.has(requested) ? requested : 'farcaster';
  const session = getSession(req);
  if (req.query?.type === 'following' && !session) return res.status(401).json({ error: 'Connect your Farcaster account to see your following feed' });
  const following = req.query?.type === 'following' && session;
  const upstreamUrl = new URL(following ? 'https://api.neynar.com/v2/farcaster/feed/' : NEYNAR_URL);
  if (following) {
    upstreamUrl.searchParams.set('feed_type', 'following');
    upstreamUrl.searchParams.set('fid', String(session.fid));
  } else {
    upstreamUrl.searchParams.set('channel_ids', channel);
    if (session) upstreamUrl.searchParams.set('viewer_fid', String(session.fid));
  }
  upstreamUrl.searchParams.set('limit', '20');
  upstreamUrl.searchParams.set('with_recasts', 'false');
  if (!following) upstreamUrl.searchParams.set('with_replies', 'true');

  try {
    const response = await fetch(upstreamUrl, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.status(502).json({ error: 'Farcaster feed is temporarily unavailable' });

    const data = await response.json();
    const casts = Array.isArray(data.casts) ? data.casts : [];
    const posts = casts.slice(0, 12).map((cast) => ({
      hash: typeof cast.hash === 'string' ? cast.hash : '',
      text: typeof cast.text === 'string' ? cast.text.slice(0, 1500) : '',
      timestamp: typeof cast.timestamp === 'string' ? cast.timestamp : '',
      author: {
        fid: Number(cast.author?.fid) || null,
        displayName: String(cast.author?.display_name || cast.author?.username || 'Farcaster user').slice(0, 80),
        username: String(cast.author?.username || '').slice(0, 50),
        pfp_url: String(cast.author?.pfp_url || '').slice(0, 500),
      },
      replies: Number(cast.replies?.count) || 0,
      likes: Number(cast.reactions?.likes_count) || 0,
      recasts: Number(cast.reactions?.recasts_count) || 0,
    })).filter((post) => post.hash && post.text);

    res.setHeader('Cache-Control', session ? 'private, no-store' : 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ channel: following ? 'following' : channel, posts });
  } catch {
    return res.status(502).json({ error: 'Farcaster feed is temporarily unavailable' });
  }
};
