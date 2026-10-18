const { getSession, isSameOrigin } = require('../lib/auth');

module.exports = async function cast(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Request origin could not be verified' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Connect your Farcaster account to post' });
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Farcaster API is not configured yet' });
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || [...text].length > 320) return res.status(400).json({ error: 'Posts must be between 1 and 320 characters' });
  const payload = { signer_uuid: session.signerUuid, text };
  if (typeof req.body?.parent === 'string' && /^0x[0-9a-f]{8,64}$/i.test(req.body.parent)) payload.parent = req.body.parent;
  if (typeof req.body?.channel_id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(req.body.channel_id)) payload.channel_id = req.body.channel_id;
  try {
    const response = await fetch('https://api.neynar.com/v2/farcaster/cast/', {
      method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status === 403 ? 403 : 502).json({ error: data.message || 'Farcaster did not accept this post' });
    return res.status(200).json(data);
  } catch {
    return res.status(502).json({ error: 'Posting service is temporarily unavailable' });
  }
};
