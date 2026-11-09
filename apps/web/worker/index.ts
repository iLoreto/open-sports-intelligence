interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BALLDONTLIE_API_KEY?: string;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ status: 'ok', activeSports: ['nba', 'tennis'], backgroundScanning: false });
    if (url.pathname === '/api/tennis/status') return json({ message: 'Tennis provider not configured. Challenger/ITF coverage and latency must be verified before activation.', configured: false }, 503);
    if (url.pathname === '/api/nba/games') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (!env.BALLDONTLIE_API_KEY) return json({ message: 'BALLDONTLIE_API_KEY is not configured as a Worker secret.' }, 503);
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return json({ error: 'Invalid date; expected YYYY-MM-DD' }, 400);
      try {
        const upstream = await fetch('https://api.balldontlie.io/v1/games?dates[]=' + encodeURIComponent(date) + '&per_page=100', {
          headers: { Authorization: env.BALLDONTLIE_API_KEY }, signal: AbortSignal.timeout(10000)
        });
        if (!upstream.ok) return json({ message: 'BALLDONTLIE request failed', upstreamStatus: upstream.status }, 502);
        const body = await upstream.json() as { data?: unknown[] };
        return json({ source: 'BALLDONTLIE NBA API', fetchedAt: new Date().toISOString(), games: Array.isArray(body.data) ? body.data : [] });
      } catch { return json({ message: 'BALLDONTLIE unavailable or timed out' }, 502); }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  }
};
