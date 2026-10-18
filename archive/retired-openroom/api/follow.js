const { getSession, isSameOrigin } = require('../lib/auth');

module.exports = async function follow(req, res) {
  if (!['POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, DELETE'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Request origin could not be verified' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Connect your Farcaster account to follow people' });
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Farcaster API is not configured yet' });
  const fid = Number(req.body?.fid);
  if (!Number.isSafeInteger(fid) || fid < 1 || fid === session.fid) return res.status(400).json({ error: 'Invalid Farcaster user' });
  try {
    const response = await fetch('https://api.neynar.com/v2/farcaster/user/follow/', {
      method: req.method, headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ signer_uuid: session.signerUuid, target_fids: [fid] }), signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: data.message || 'Farcaster did not accept the follow' });
    return res.status(200).json(data);
  } catch {
    return res.status(502).json({ error: 'Follow service is temporarily unavailable' });
  }
};
