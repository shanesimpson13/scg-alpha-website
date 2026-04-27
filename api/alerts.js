// SCG Alpha — Member-gated alerts proxy
// Lives on Vercel at https://scgalpha.com/api/alerts
// Validates the caller's API key against SCG_MEMBER_KEYS env var,
// then proxies through to the EC2 API for the data.

const UPSTREAM = 'https://api.scgalpha.com/api/alerts';

function getValidKeys() {
  const raw = process.env.SCG_MEMBER_KEYS || '';
  return new Set(
    raw
      .split(',')
      .map(k => k.trim())
      .filter(Boolean)
  );
}

module.exports = async function handler(req, res) {
  // CORS — same-origin only on prod, but allow OPTIONS preflight cleanly
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Pull key from header (preferred) or query (fallback for testing)
  const key =
    req.headers['x-api-key'] ||
    req.headers['X-API-Key'] ||
    (req.query && req.query.key) ||
    '';

  if (!key) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const valid = getValidKeys();
  if (valid.size === 0) {
    // Env not configured — fail closed so we don't leak data by default.
    res.status(503).json({ error: 'Auth not configured' });
    return;
  }

  if (!valid.has(key)) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // Authed — fetch upstream and pass through
  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { 'User-Agent': 'scgalpha-proxy/1.0' },
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    // Short cache so we don't hammer EC2 if 100 members refresh at once
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: 'Upstream unavailable' });
  }
};
