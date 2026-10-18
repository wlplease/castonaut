const { getSession, issueSession, clearSession, isSameOrigin } = require('../lib/auth');

module.exports = async function signer(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, POST, DELETE'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (req.method !== 'GET' && !isSameOrigin(req)) return res.status(403).json({ error: 'Request origin could not be verified' });
  if (req.method === 'GET' && !req.query?.me && !req.query?.signer_uuid) return res.status(400).json({ error: 'Invalid sign-in request' });
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Farcaster sign-in is not configured yet' });

  if (req.method === 'DELETE') {
    clearSession(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    try {
      const response = await fetch('https://api.neynar.com/v2/farcaster/signer/', {
        method: 'POST', headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok || !data.signer_uuid || !data.signer_approval_url) return res.status(502).json({ error: 'Could not start Farcaster sign-in' });
      return res.status(200).json({ signer_uuid: data.signer_uuid, approval_url: data.signer_approval_url, status: data.status });
    } catch {
      return res.status(502).json({ error: 'Sign-in service is temporarily unavailable' });
    }
  }

  if (req.method === 'GET') {
    const session = getSession(req);
    if (req.query?.me === '1') {
      if (!session) return res.status(401).json({ error: 'Not signed in' });
      return res.status(200).json({ fid: session.fid });
    }
    const signerUuid = String(req.query?.signer_uuid || '');
    if (!/^[0-9a-f-]{36}$/i.test(signerUuid)) return res.status(400).json({ error: 'Invalid sign-in request' });
    try {
      const url = new URL('https://api.neynar.com/v2/farcaster/signer/');
      url.searchParams.set('signer_uuid', signerUuid);
      const response = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (!response.ok) return res.status(502).json({ error: 'Could not check sign-in status' });
      if (data.status === 'approved' && Number.isInteger(data.fid)) {
        try { issueSession(res, { fid: data.fid, signerUuid }); }
        catch { return res.status(503).json({ error: 'SESSION_SECRET must be configured with at least 32 characters before sign-in can finish' }); }
      }
      return res.status(200).json({ status: data.status, fid: data.fid || null });
    } catch {
      return res.status(502).json({ error: 'Sign-in service is temporarily unavailable' });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
};
