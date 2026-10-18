const { getSession } = require('../lib/auth');

module.exports = async function conversation(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Farcaster API is not configured yet' });
  const hash = String(req.query?.hash || '');
  if (!/^0x[0-9a-f]{8,64}$/i.test(hash)) return res.status(400).json({ error: 'Invalid cast' });
  try {
    const url = new URL('https://api.neynar.com/v2/farcaster/cast/conversation/');
    url.searchParams.set('identifier', hash); url.searchParams.set('type', 'hash'); url.searchParams.set('reply_depth', '2'); url.searchParams.set('sort_type', 'chron');
    const session = getSession(req);
    if (session) url.searchParams.set('viewer_fid', String(session.fid));
    const response = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'Conversation is temporarily unavailable' });
    const casts = [];
    const walk = (cast, depth = 0) => {
      if (!cast || depth > 2 || casts.length >= 60) return;
      casts.push(cast);
      for (const reply of cast.direct_replies || []) walk(reply, depth + 1);
    };
    walk(data.conversation?.cast);
    return res.status(200).json({ casts });
  } catch { return res.status(502).json({ error: 'Conversation is temporarily unavailable' }); }
};
