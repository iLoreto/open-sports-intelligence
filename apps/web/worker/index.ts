interface Environment { ASSETS: { fetch(request: Request): Promise<Response> }; BALLDONTLIE_API_KEY?: string }
type Team = { id: number; full_name: string };
type Game = { id: number; date: string; status: string; home_team: Team; visitor_team: Team; home_team_score: number; visitor_team_score: number };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)); }
async function bdl(path: string, key: string): Promise<{ data: unknown[]; meta?: { next_cursor?: number | null } }> {
  const response = await fetch('https://api.balldontlie.io/v1/' + path, { headers: { Authorization: key }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('BALLDONTLIE returned HTTP ' + response.status);
  const body = await response.json() as { data?: unknown[]; meta?: { next_cursor?: number | null } };
  if (!Array.isArray(body.data)) throw new Error('Unexpected BALLDONTLIE response');
  return { data: body.data, meta: body.meta };
}
function summarize(games: Game[], id: number, sample: number) {
  const played = games.filter(g => (g.home_team.id === id || g.visitor_team.id === id) && (g.status === 'Final' || g.status.startsWith('Final')) && Number.isFinite(g.home_team_score) && Number.isFinite(g.visitor_team_score))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, sample);
  const rows = played.map(g => { const home = g.home_team.id === id; const scored = home ? g.home_team_score : g.visitor_team_score; const allowed = home ? g.visitor_team_score : g.home_team_score; return { scored, allowed, win: scored > allowed, date: g.date }; });
  const avg = (field: 'scored' | 'allowed') => rows.length ? Math.round(rows.reduce((sum, r) => sum + r[field], 0) / rows.length * 10) / 10 : null;
  return { games: rows.length, wins: rows.filter(r => r.win).length, losses: rows.filter(r => !r.win).length, pointsFor: avg('scored'), pointsAgainst: avg('allowed'), recent: rows };
}
export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ status: 'ok', activeSports: ['nba', 'tennis'], backgroundScanning: false });
    if (url.pathname === '/api/tennis/status') return json({ message: 'Tennis data provider not configured. Challenger and ITF coverage must be verified.', configured: false }, 503);

    if (url.pathname === '/api/markets/scan') {
      if (request.method !== 'POST') return json({ error: 'Use the Scan button to initiate a POST request.' }, 405);
      const provider = url.searchParams.get('provider') || 'kalshi';
      if (provider === 'novig') return json({ error: 'Novig public market-data integration is not configured yet.' }, 501);
      if (provider !== 'kalshi') return json({ error: 'Unsupported provider' }, 400);
      const min = Number(url.searchParams.get('min') ?? '55');
      const max = Number(url.searchParams.get('max') ?? '70');
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 99 || min > max)
        return json({ error: 'Specify a valid price range from 1 to 99 cents, minimum not exceeding maximum.' }, 400);
      try {
        // Deliberately bounded, on-demand only. No cron, D1 writes, or implicit polling.
        const endpoint = 'https://external-api.kalshi.com/trade-api/v2';
        type Quote = { ticker?: string; title?: string; status?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; no_ask_dollars?: string; last_price_dollars?: string; volume_24h_fp?: string };
        type Event = { event_ticker?: string; title?: string; category?: string; markets?: Quote[] };
        const markets: Array<{ ticker: string; event: string; title: string; side: 'YES' | 'NO'; askCents: number; yesBid: string | null; yesAsk: string | null; noAsk: string | null; last: string | null; volume24h: string | null }> = [];
        let cursor = ''; let pagesScanned = 0; let sportsEvents = 0; let nestedMarkets = 0; let quotedMarkets = 0;
        const sports: Event[] = [];
        // Collect sports events first. Event listings are not guaranteed to contain usable quote data.
        for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
          const query = new URLSearchParams({ status: 'open', limit: '200', with_nested_markets: 'true' });
          if (cursor) query.set('cursor', cursor);
          const response = await fetch(endpoint + '/events?' + query.toString(), {
            headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(13000)
          });
          if (!response.ok) throw new Error('Kalshi events HTTP ' + response.status);
          const page = await response.json() as { events?: Event[]; cursor?: string };
          if (!Array.isArray(page.events)) throw new Error('Unexpected Kalshi event response');
          pagesScanned++;
          for (const event of page.events) {
            if (event.category?.trim().toLowerCase() !== 'sports' || !event.event_ticker) continue;
            sportsEvents++;
            sports.push(event);
            nestedMarkets += event.markets?.length || 0;
          }
          const next = page.cursor || '';
          if (!next || next === cursor) { cursor = ''; break; }
          cursor = next;
        }
        // Request actual market quotes from the markets endpoint rather than relying on
        // potentially incomplete event-nested quote snapshots. Batch event tickers (max 10).
        const eventTitles = new Map(sports.map(e => [e.event_ticker!, e.title || e.event_ticker!]));
        const groups: string[][] = [];
        for (let i = 0; i < sports.length; i += 10) groups.push(sports.slice(i, i + 10).map(e => e.event_ticker!));
        const results = await Promise.all(groups.map(async tickers => {
          const collected: (Quote & { event_ticker?: string })[] = [];
          let marketCursor = '';
          for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
            const query = new URLSearchParams({ status: 'open', limit: '1000', event_ticker: tickers.join(',') });
            if (marketCursor) query.set('cursor', marketCursor);
            const response = await fetch(endpoint + '/markets?' + query.toString(), {
              headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(13000)
            });
            if (!response.ok) throw new Error('Kalshi markets HTTP ' + response.status);
            const page = await response.json() as { markets?: (Quote & { event_ticker?: string })[]; cursor?: string };
            if (!Array.isArray(page.markets)) throw new Error('Unexpected Kalshi markets response');
            collected.push(...page.markets);
            const next = page.cursor || '';
            if (!next || next === marketCursor) break;
            marketCursor = next;
          }
          return collected;
        }));
        const seen = new Set<string>();
        for (const market of results.flat()) {
          if (!market.ticker || !market.event_ticker || !eventTitles.has(market.event_ticker) || (market.status && !['open', 'active'].includes(market.status))) continue;
          if (seen.has(market.ticker)) continue;
          seen.add(market.ticker);
          const quotes = [['YES', market.yes_ask_dollars], ['NO', market.no_ask_dollars]] as const;
          for (const [side, ask] of quotes) {
            if (typeof ask !== 'string' || !/^\d+(?:\.\d+)?$/.test(ask)) continue;
            quotedMarkets++;
            const cents = Math.round(Number(ask) * 100);
            if (cents < min || cents > max) continue;
            markets.push({ ticker: market.ticker, event: eventTitles.get(market.event_ticker) || market.event_ticker,
              title: market.title || market.ticker, side, askCents: cents,
              yesBid: market.yes_bid_dollars ?? null, yesAsk: market.yes_ask_dollars ?? null,
              noAsk: market.no_ask_dollars ?? null, last: market.last_price_dollars ?? null,
              volume24h: market.volume_24h_fp ?? null });
          }
        }
        markets.sort((a, b) => a.askCents - b.askCents || a.event.localeCompare(b.event));
        return json({ source: 'Kalshi public API', provider, scannedAt: new Date().toISOString(),
          min, max, sportsEvents, pagesScanned, nestedMarkets, quotedMarkets, markets, partialCoverage: Boolean(cursor),
          note: 'Sports-only, on-demand scan. Quotes are displayed by contract side (YES/NO) at the current ask. Up to five event pages are checked; prices are retrieved from the markets endpoint. Additional pages may exist.' });
      } catch (e) { return json({ error: e instanceof Error ? e.message : 'Kalshi feed unavailable' }, 502); }
    }
    if (url.pathname.startsWith('/api/nba/')) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (!env.BALLDONTLIE_API_KEY) return json({ message: 'BALLDONTLIE_API_KEY Worker secret is missing.' }, 503);
      try {
        if (url.pathname === '/api/nba/teams') {
          const data = await bdl('teams', env.BALLDONTLIE_API_KEY);
          return json({ source: 'BALLDONTLIE NBA API', fetchedAt: new Date().toISOString(), teams: data.data });
        }
        if (url.pathname === '/api/nba/games') {
          const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
          if (!validDate(date)) return json({ error: 'Invalid date' }, 400);
          const data = await bdl('games?dates[]=' + encodeURIComponent(date) + '&per_page=100', env.BALLDONTLIE_API_KEY);
          return json({ source: 'BALLDONTLIE NBA API', fetchedAt: new Date().toISOString(), games: data.data });
        }
        if (url.pathname === '/api/nba/compare') {
          const left = Number(url.searchParams.get('left')), right = Number(url.searchParams.get('right'));
          const sample = Number(url.searchParams.get('sample') || 10);
          if (!Number.isInteger(left) || !Number.isInteger(right) || left <= 0 || right <= 0 || left === right || ![5,10,20].includes(sample)) return json({ error: 'Select two different teams and a valid sample.' }, 400);
          const end = new Date(), start = new Date(end.getTime() - 180 * 86400000);
          const query = (id: number) => 'games?team_ids[]=' + id + '&start_date=' + start.toISOString().slice(0,10) + '&end_date=' + end.toISOString().slice(0,10) + '&per_page=100';
          const [a,b] = await Promise.all([bdl(query(left), env.BALLDONTLIE_API_KEY), bdl(query(right), env.BALLDONTLIE_API_KEY)]);
          const leftGames = a.data as Game[], rightGames = b.data as Game[];
          const leftStats = summarize(leftGames, left, sample), rightStats = summarize(rightGames, right, sample);
          return json({ source: 'BALLDONTLIE NBA API', fetchedAt: new Date().toISOString(), sample, left: leftStats, right: rightStats, partial: Boolean(a.meta?.next_cursor || b.meta?.next_cursor), note: 'Completed games in the last 180 days. Results limited to the first 100 provider records per team; coverage may be incomplete. No injury or player statistics included.' });
        }
      } catch (e) { return json({ message: e instanceof Error ? e.message : 'NBA provider unavailable' }, 502); }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  }
};
