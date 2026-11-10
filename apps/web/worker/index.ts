import { sharedScan, uncachedScan, type ScanSnapshot, type ScanDatabase } from './scan-cache.ts';
interface Environment { ASSETS: { fetch(request: Request): Promise<Response> }; BALLDONTLIE_API_KEY?: string; DB?: ScanDatabase }
type Team = { id: number; full_name: string };
type Game = { id: number; date: string; status: string; home_team: Team; visitor_team: Team; home_team_score: number; visitor_team_score: number };
const NBA_TEAMS: Team[] = [{"id":1,"full_name":"Atlanta Hawks"},{"id":2,"full_name":"Boston Celtics"},{"id":3,"full_name":"Brooklyn Nets"},{"id":4,"full_name":"Charlotte Hornets"},{"id":5,"full_name":"Chicago Bulls"},{"id":6,"full_name":"Cleveland Cavaliers"},{"id":7,"full_name":"Dallas Mavericks"},{"id":8,"full_name":"Denver Nuggets"},{"id":9,"full_name":"Detroit Pistons"},{"id":10,"full_name":"Golden State Warriors"},{"id":11,"full_name":"Houston Rockets"},{"id":12,"full_name":"Indiana Pacers"},{"id":13,"full_name":"LA Clippers"},{"id":14,"full_name":"Los Angeles Lakers"},{"id":15,"full_name":"Memphis Grizzlies"},{"id":16,"full_name":"Miami Heat"},{"id":17,"full_name":"Milwaukee Bucks"},{"id":18,"full_name":"Minnesota Timberwolves"},{"id":19,"full_name":"New Orleans Pelicans"},{"id":20,"full_name":"New York Knicks"},{"id":21,"full_name":"Oklahoma City Thunder"},{"id":22,"full_name":"Orlando Magic"},{"id":23,"full_name":"Philadelphia 76ers"},{"id":24,"full_name":"Phoenix Suns"},{"id":25,"full_name":"Portland Trail Blazers"},{"id":26,"full_name":"Sacramento Kings"},{"id":27,"full_name":"San Antonio Spurs"},{"id":28,"full_name":"Toronto Raptors"},{"id":29,"full_name":"Utah Jazz"},{"id":30,"full_name":"Washington Wizards"}];
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)); }
async function bdl(path: string, key: string): Promise<{ data: unknown[]; meta?: { next_cursor?: number | null } }> {
  const response = await fetch('https://api.balldontlie.io/v1/' + path, { headers: { Authorization: key }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('BALLDONTLIE returned HTTP ' + response.status);
  const body = await response.json() as { data?: unknown[]; meta?: { next_cursor?: number | null } };
  if (!Array.isArray(body.data)) throw new Error('Unexpected BALLDONTLIE response');
  return { data: body.data, meta: body.meta };
}
const NBA_ABBREVIATIONS = ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GS','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NO','NY','OKC','ORL','PHI','PHX','POR','SAC','SA','TOR','UTAH','WSH'];
async function espnComparison(left: number, right: number, sample: number) {
  const now = new Date();
  const start = new Date(now.getTime() - 180 * 86400000);
  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= now) {
    const year = cursor.getUTCFullYear(), month = cursor.getUTCMonth();
    const first = Math.max(start.getTime(), Date.UTC(year, month, 1));
    const last = Math.min(now.getTime(), Date.UTC(year, month + 1, 0));
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
    months.push(fmt(first) + '-' + fmt(last));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  type EspnCompetitor = { homeAway?: string; score?: string; team?: { abbreviation?: string } };
  type EspnEvent = { id?: string; date?: string; status?: { type?: { completed?: boolean } }; competitions?: { competitors?: EspnCompetitor[] }[] };
  const pages = await Promise.all(months.map(async dates => {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=' + dates + '&limit=500', { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('ESPN scoreboard HTTP ' + response.status);
    return response.json() as Promise<{ events?: EspnEvent[] }>;
  }));
  const ids = new Map<string, number>();
  NBA_ABBREVIATIONS.forEach((abbr, i) => ids.set(abbr, i + 1));
  // ESPN uses a few different abbreviations than BALLDONTLIE.
  ids.set('GSW', 10); ids.set('NOP', 19); ids.set('NYK', 20); ids.set('OKC', 21);
  ids.set('SAS', 27); ids.set('UTA', 29); ids.set('WAS', 30);
  const games = new Map<string, Game>();
  for (const page of pages) for (const event of page.events || []) {
    if (!event.id || !event.date || !event.status?.type?.completed) continue;
    const competitors = event.competitions?.[0]?.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home'), away = competitors.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const homeId = ids.get(home.team?.abbreviation || ''), awayId = ids.get(away.team?.abbreviation || '');
    const hs = Number(home.score), as = Number(away.score);
    if (!homeId || !awayId || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
    if (homeId !== left && awayId !== left && homeId !== right && awayId !== right) continue;
    games.set(event.id, { id: Number(event.id), date: event.date.slice(0, 10), status: 'Final', home_team: { id: homeId, full_name: '' }, visitor_team: { id: awayId, full_name: '' }, home_team_score: hs, visitor_team_score: as });
  }
  const all = [...games.values()];
  const a = summarize(all, left, sample), b = summarize(all, right, sample);
  if (!a.games || !b.games) throw new Error('ESPN returned no completed games for one or both selected teams.');
  return { source: 'ESPN NBA scoreboard (public fallback)', fetchedAt: new Date().toISOString(), sample, left: a, right: b, partial: a.games < sample || b.games < sample, note: 'Completed NBA games from the last 180 days. ESPN public scoreboard fallback; available sample sizes may be smaller than requested. No injury or player statistics included.' };
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
    if (url.pathname === '/api/nba/config-status') return json({
      service: 'nba',
      keyConfigured: typeof env.BALLDONTLIE_API_KEY === 'string' && env.BALLDONTLIE_API_KEY.trim().length > 0,
      keyBindingType: typeof env.BALLDONTLIE_API_KEY,
      note: 'Runtime binding check only; no secret value or upstream request is exposed.'
    });
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
        const fetchSnapshot = async (scanSignal: AbortSignal): Promise<ScanSnapshot> => {
        // On-demand only. A single D1 snapshot is shared across users and price ranges.
        const endpoint = 'https://external-api.kalshi.com/trade-api/v2';
        type Quote = { ticker?: string; title?: string; status?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; no_ask_dollars?: string; last_price_dollars?: string; volume_24h_fp?: string };
        type Event = { event_ticker?: string; title?: string; category?: string; markets?: Quote[] };
        const markets: ScanSnapshot['markets'] = [];
        let cursor = ''; let pagesScanned = 0; let sportsEvents = 0; let nestedMarkets = 0; let quotedMarkets = 0;
        const sports: Event[] = [];
        // Collect sports events first. Event listings are not guaranteed to contain usable quote data.
        for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
          const query = new URLSearchParams({ status: 'open', limit: '200', with_nested_markets: 'true' });
          if (cursor) query.set('cursor', cursor);
          const response = await fetch(endpoint + '/events?' + query.toString(), {
            headers: { Accept: 'application/json' }, signal: AbortSignal.any([scanSignal, AbortSignal.timeout(13000)])
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
        // Page through the global markets feed rather than issuing one request per
        // event. This bounds upstream traffic and avoids rate-limit bursts.
        const eventTitles = new Map(sports.map(e => [e.event_ticker!, e.title || e.event_ticker!]));
        const results: (Quote & { event_ticker?: string })[][] = [];
        let marketCursor = '';
        let marketPagesScanned = 0;
        let rateLimited = false;
        for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
          const query = new URLSearchParams({ status: 'open', limit: '1000' });
          if (marketCursor) query.set('cursor', marketCursor);
          const response = await fetch(endpoint + '/markets?' + query.toString(), {
            headers: { Accept: 'application/json' }, signal: AbortSignal.any([scanSignal, AbortSignal.timeout(13000)])
          });
          if (response.status === 429) { rateLimited = true; break; }
          if (!response.ok) throw new Error('Kalshi markets HTTP ' + response.status);
          const page = await response.json() as { markets?: (Quote & { event_ticker?: string })[]; cursor?: string };
          if (!Array.isArray(page.markets)) throw new Error('Unexpected Kalshi markets response');
          marketPagesScanned++;
          results.push(page.markets);
          const next = page.cursor || '';
          if (!next || next === marketCursor) { marketCursor = ''; break; }
          marketCursor = next;
        }
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
            markets.push({ ticker: market.ticker, event: eventTitles.get(market.event_ticker) || market.event_ticker,
              title: market.title || market.ticker, side, askCents: cents,
              yesBid: market.yes_bid_dollars ?? null, yesAsk: market.yes_ask_dollars ?? null,
              noAsk: market.no_ask_dollars ?? null, last: market.last_price_dollars ?? null,
              volume24h: market.volume_24h_fp ?? null });
          }
        }
        scanSignal.throwIfAborted();
        markets.sort((a, b) => a.askCents - b.askCents || a.event.localeCompare(b.event));
        return { source: 'Kalshi public API', provider, scannedAt: new Date().toISOString(),
          sportsEvents, pagesScanned, nestedMarkets, quotedMarkets, fetchedMarkets: results.reduce((n, group) => n + group.length, 0), marketPagesScanned, rateLimited, markets, partialCoverage: Boolean(cursor || marketCursor || rateLimited),
          note: 'Sports-only, on-demand scan. Quotes are displayed by contract side (YES/NO) at the current ask. Up to five event pages and ten market pages are checked. Coverage is partial when additional pages exist or rate limiting occurs.' };
        };
        const result = env.DB
          ? await sharedScan(env.DB, min, max, fetchSnapshot)
          : uncachedScan(await fetchSnapshot(request.signal), min, max);
        return json(result);
      } catch (e) { return json({ error: e instanceof Error ? e.message : 'Kalshi feed unavailable' }, 502); }
    }
    if (url.pathname.startsWith('/api/leagues/')) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const match = /^\\/api\\/leagues\\/(nfl|nhl|mlb|wnba|ncaaf|ncaam)\\/teams$/.exec(url.pathname);
      if (!match) return json({ error: 'Unknown league' }, 404);
      const leagues: Record<string, string> = { nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb', wnba: 'basketball/wnba', ncaaf: 'football/college-football', ncaam: 'basketball/mens-college-basketball' };
      try {
        const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/' + leagues[match[1]] + '/teams?limit=500', { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('ESPN teams HTTP ' + response.status);
        const payload = await response.json() as { sports?: { leagues?: { teams?: { team?: { id?: string; displayName?: string; abbreviation?: string } }[] }[] }[] };
        const entries = payload.sports?.[0]?.leagues?.[0]?.teams;
        if (!Array.isArray(entries)) throw new Error('ESPN teams schema changed');
        const teams = entries.map(item => item.team).filter((team): team is { id: string; displayName: string; abbreviation?: string } => Boolean(team?.id && team.displayName))
          .map(team => ({ id: team.id, full_name: team.displayName, abbreviation: team.abbreviation || '' }));
        if (!teams.length) throw new Error('ESPN returned no teams');
        return json({ source: 'ESPN public team directory', league: match[1], fetchedAt: new Date().toISOString(), teams });
      } catch (e) { return json({ error: e instanceof Error ? e.message : 'ESPN team directory unavailable' }, 502); }
    }
    if (url.pathname.startsWith('/api/nba/')) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (url.pathname === '/api/nba/teams') return json({ source: 'NBA team directory', teams: NBA_TEAMS });
      const hasBdlKey = typeof env.BALLDONTLIE_API_KEY === 'string' && Boolean(env.BALLDONTLIE_API_KEY.trim());
      try {
        if (url.pathname === '/api/nba/games') {
          const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
          if (!validDate(date)) return json({ error: 'Invalid date' }, 400);
          if (!hasBdlKey) return json({ message: 'Dated games endpoint requires BALLDONTLIE; use team comparison for ESPN fallback.' }, 503);
          const data = await bdl('games?dates[]=' + encodeURIComponent(date) + '&per_page=100', env.BALLDONTLIE_API_KEY);
          return json({ source: 'BALLDONTLIE NBA API', fetchedAt: new Date().toISOString(), games: data.data });
        }
        if (url.pathname === '/api/nba/compare') {
          const left = Number(url.searchParams.get('left')), right = Number(url.searchParams.get('right'));
          const sample = Number(url.searchParams.get('sample') || 10);
          if (!Number.isInteger(left) || !Number.isInteger(right) || left <= 0 || right <= 0 || left === right || ![5,10,20].includes(sample)) return json({ error: 'Select two different teams and a valid sample.' }, 400);
          if (!hasBdlKey) return json(await espnComparison(left, right, sample));
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
