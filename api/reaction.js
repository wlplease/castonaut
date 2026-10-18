const { getSession, isSameOrigin } = require('../lib/auth');

module.exports = async function reaction(req, res) {
  if (!['POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, DELETE'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Request origin could not be verified' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Connect your Farcaster account to react' });
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Farcaster API is not configured yet' });
  const target = typeof req.body?.target === 'string' ? req.body.target : '';
  const reactionType = req.body?.reaction_type;
  if (!/^0x[0-9a-f]{8,64}$/i.test(target) || !['like', 'recast'].includes(reactionType)) return res.status(400).json({ error: 'Invalid reaction' });
  try {
    const response = await fetch('https://api.neynar.com/v2/farcaster/reaction/', {
      method: req.method, headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ signer_uuid: session.signerUuid, target, reaction_type: reactionType }), signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: data.message || 'Farcaster did not accept this reaction' });
    return res.status(200).json(data);
  } catch {
    return res.status(502).json({ error: 'Reaction service is temporarily unavailable' });
  }
};
