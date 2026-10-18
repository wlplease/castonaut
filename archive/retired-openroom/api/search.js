module.exports = async function search(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Farcaster API is not configured yet' });
  const q = String(req.query?.q || '').trim().replace(/^@/, '').slice(0, 60);
  if (q.length < 2) return res.status(400).json({ error: 'Type at least two characters' });
  try {
    const url = new URL('https://api.neynar.com/v2/farcaster/user/search/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    const response = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'People search is temporarily unavailable' });
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ users: Array.isArray(data.result?.users) ? data.result.users : (Array.isArray(data.users) ? data.users : []) });
  } catch {
    return res.status(502).json({ error: 'People search is temporarily unavailable' });
  }
};
