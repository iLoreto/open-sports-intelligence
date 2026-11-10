import { sharedScan, uncachedScan, type ScanSnapshot, type ScanDatabase } from './scan-cache.ts';
interface Environment { ASSETS: { fetch(request: Request): Promise<Response> }; DB?: ScanDatabase }
type Team = { id: number; full_name: string };
type Game = { id: number; date: string; status: string; home_team: Team; visitor_team: Team; home_team_score: number; visitor_team_score: number };
const NBA_TEAMS: Team[] = [{"id":1,"full_name":"Atlanta Hawks"},{"id":2,"full_name":"Boston Celtics"},{"id":3,"full_name":"Brooklyn Nets"},{"id":4,"full_name":"Charlotte Hornets"},{"id":5,"full_name":"Chicago Bulls"},{"id":6,"full_name":"Cleveland Cavaliers"},{"id":7,"full_name":"Dallas Mavericks"},{"id":8,"full_name":"Denver Nuggets"},{"id":9,"full_name":"Detroit Pistons"},{"id":10,"full_name":"Golden State Warriors"},{"id":11,"full_name":"Houston Rockets"},{"id":12,"full_name":"Indiana Pacers"},{"id":13,"full_name":"LA Clippers"},{"id":14,"full_name":"Los Angeles Lakers"},{"id":15,"full_name":"Memphis Grizzlies"},{"id":16,"full_name":"Miami Heat"},{"id":17,"full_name":"Milwaukee Bucks"},{"id":18,"full_name":"Minnesota Timberwolves"},{"id":19,"full_name":"New Orleans Pelicans"},{"id":20,"full_name":"New York Knicks"},{"id":21,"full_name":"Oklahoma City Thunder"},{"id":22,"full_name":"Orlando Magic"},{"id":23,"full_name":"Philadelphia 76ers"},{"id":24,"full_name":"Phoenix Suns"},{"id":25,"full_name":"Portland Trail Blazers"},{"id":26,"full_name":"Sacramento Kings"},{"id":27,"full_name":"San Antonio Spurs"},{"id":28,"full_name":"Toronto Raptors"},{"id":29,"full_name":"Utah Jazz"},{"id":30,"full_name":"Washington Wizards"}];
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)); }
const NBA_ABBREVIATIONS = ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GS','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NO','NY','OKC','ORL','PHI','PHX','POR','SAC','SA','TOR','UTAH','WSH'];
async function espnComparison(left: number, right: number, sample: number) {
  // ESPN scoreboard rejects large date-range requests (HTTP 400). Query each
  // selected team's season schedule instead, using ESPN's own NBA team IDs.
  const currentYear = new Date().getUTCFullYear();
  type EspnScore = string | number | { value?: number | string; displayValue?: string };
  type EspnCompetitor = { homeAway?: string; score?: EspnScore; team?: { id?: string; abbreviation?: string } };
  type EspnEvent = { id?: string; date?: string; status?: { type?: { completed?: boolean } }; competitions?: { status?: { type?: { completed?: boolean } }; competitors?: EspnCompetitor[] }[] };
  const appTeamToEspnPath = (id: number): string | null => {
    if (!Number.isInteger(id) || id < 1 || id > NBA_ABBREVIATIONS.length) return null;
    return NBA_ABBREVIATIONS[id - 1].toLowerCase();
  };
  const teamPaths = [left, right].map(appTeamToEspnPath).filter((path): path is string => Boolean(path));
  if (teamPaths.length !== 2) throw new Error('Unsupported NBA team ID');
  const seasons = [currentYear + 1, currentYear, currentYear - 1];
  const pages = await Promise.all(teamPaths.flatMap(path => seasons.map(async season => {
    const endpoint = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/' + path + '/schedule?season=' + season;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('ESPN NBA team schedule HTTP ' + response.status);
    const payload = await response.json() as { events?: EspnEvent[] };
    if (!Array.isArray(payload.events)) throw new Error('ESPN NBA schedule response missing events');
    return payload;
  })));
  const ids = new Map<string, number>();
  NBA_ABBREVIATIONS.forEach((abbr, i) => ids.set(abbr, i + 1));
  // Normalize ESPN abbreviations to the app's stable NBA team IDs.
  ids.set('GSW', 10); ids.set('NOP', 19); ids.set('NYK', 20); ids.set('OKC', 21);
  ids.set('SAS', 27); ids.set('UTA', 29); ids.set('WAS', 30);
  const scoreValue = (score: EspnScore | undefined): number => {
    if (typeof score === 'number') return score;
    if (typeof score === 'string') return Number(score);
    if (score && typeof score === 'object') {
      if (typeof score.value === 'number') return score.value;
      if (typeof score.value === 'string') return Number(score.value);
      if (typeof score.displayValue === 'string') return Number(score.displayValue);
    }
    return Number.NaN;
  };
  const games = new Map<string, Game>();
  for (const page of pages) for (const event of page.events || []) {
    const completed = event.status?.type?.completed ?? event.competitions?.[0]?.status?.type?.completed;
    if (!event.id || !event.date || !completed) continue;
    const competitors = event.competitions?.[0]?.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home'), away = competitors.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const homeByAbbreviation = ids.get(home.team?.abbreviation || '');
    const awayByAbbreviation = ids.get(away.team?.abbreviation || '');
    const homeById = Number(home.team?.id);
    const awayById = Number(away.team?.id);
    const homeId = homeByAbbreviation || (Number.isInteger(homeById) && homeById >= 1 && homeById <= 30 ? homeById : undefined);
    const awayId = awayByAbbreviation || (Number.isInteger(awayById) && awayById >= 1 && awayById <= 30 ? awayById : undefined);
    const hs = scoreValue(home.score), as = scoreValue(away.score);
    if (!homeId || !awayId || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
    if (homeId !== left && awayId !== left && homeId !== right && awayId !== right) continue;
    games.set(event.id, { id: Number(event.id), date: event.date.slice(0, 10), status: 'Final', home_team: { id: homeId, full_name: '' }, visitor_team: { id: awayId, full_name: '' }, home_team_score: hs, visitor_team_score: as });
  }
  const all = [...games.values()];
  const a = summarize(all, left, sample), b = summarize(all, right, sample);
  if (!a.games || !b.games) throw new Error('ESPN returned no completed games for one or both selected teams.');
  return { source: 'ESPN NBA scoreboard', fetchedAt: new Date().toISOString(), sample, left: a, right: b, partial: a.games < sample || b.games < sample, note: 'Completed NBA games from ESPN team schedules across recent seasons; available sample sizes may be smaller than requested. No injury or player statistics included.' };
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
      const scanLeagues = ['nba', 'nfl', 'nhl', 'mlb', 'wnba', 'ncaaf', 'ncaam'] as const;
      type ScanLeague = (typeof scanLeagues)[number];
      const selectedLeague = ((url.searchParams.get('league') || 'nba').toLowerCase()) as ScanLeague;
      if (!scanLeagues.includes(selectedLeague)) return json({ error: 'Unsupported league filter' }, 400);
      const inferLeague = (event: string, title: string, ticker: string): ScanLeague | null => {
        const text = (event + ' ' + title + ' ' + ticker).toLowerCase();
        if (/\bwnba\b/.test(text)) return 'wnba';
        if (/\bncaaf\b|college football/.test(text)) return 'ncaaf';
        if (/\bncaam\b|mens college basketball|men\'s college basketball|ncaa basketball|college basketball/.test(text)) return 'ncaam';
        if (/\bnfl\b|super bowl|pro football/.test(text)) return 'nfl';
        if (/\bnhl\b|stanley cup|hockey/.test(text)) return 'nhl';
        if (/\bmlb\b|world series|baseball/.test(text)) return 'mlb';
        if (/\bnba\b|celtics|76ers|lakers|warriors|knicks|bulls|bucks|heat|nets|suns|mavericks|spurs|raptors|cavaliers|nuggets|timberwolves|pelicans|thunder|magic|grizzlies|hawks|hornets|pistons|pacers|rockets|clippers|trail blazers|wizards|jazz|kings|\bbos\b|\bphi\b|boston pro basketball|philadelphia pro basketball/.test(text)) return 'nba';
        if (/wins by over\s+\d+(?:\.\d+)?\s+points/.test(text) && /\b(boston|philadelphia|new york|miami|phoenix|orlando|oklahoma city|san antonio|toronto|utah|washington|chicago|cleveland|dallas|denver|detroit|houston|indiana|memphis|minnesota|new orleans|portland|sacramento|los angeles|milwaukee|atlanta|charlotte)\b/.test(text)) return 'nba';
        return null;
      };
      const leagueLabel = (league: ScanLeague): string => league.toUpperCase();
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
        const isPlainTeamSide = (title: string): boolean => {
          const titleText = title.toLowerCase().trim();
          if (!/^yes\s+[a-z .'-]+$/.test(titleText) && !/^no\s+[a-z .'-]+$/.test(titleText)) return false;
          if (/\b(over|under|spread|total|handicap|points?|yards?|rebounds?|assists?|shots?|goals?|by over|by under)\b/.test(titleText)) return false;
          return true;
        };
        const isMoneylineMarket = (event: string, title: string, ticker: string): boolean => {
          const text = (event + ' ' + title).toLowerCase();
          if (text.includes(',')) return false;
          if (/\b(over|under|spread|total|handicap|alternate line|alt line)\b/.test(text)) return false;
          if (/\b(points?|yards?|rebounds?|assists?|shots?|goals?)\b/.test(text) && /\b(over|under|more|less|at least|to record|by over|by under)\b/.test(text)) return false;
          if (/(?:^|\s)[+-]\d+(?:\.\d+)?(?:\s|$)/.test(text)) return false;
          const matchContext = /\b(at|vs|versus|v)\b/.test(text) || /@/.test(text) || /\b(match|game)\b/.test(text);
          const winnerSignal = /\bwin(?:s|ner)?\b|\bto win\b|\bmoneyline\b|\byes\b/.test(text);
          const simpleTeamSide = isPlainTeamSide(title);
          const tickerSignal = /(?:^|[-_])ml(?:$|[-_])/i.test(ticker);
          return (matchContext && winnerSignal) || simpleTeamSide || tickerSignal;
        };
        const isLeagueOutcomeContract = (event: string, title: string, ticker: string): boolean => {
          if (inferLeague(event, title, ticker) !== selectedLeague) return false;
          const text = (event + ' ' + title).toLowerCase();
          if (text.includes(',')) return false;
          if (/\b(over|under|spread|total|handicap|alternate line|alt line|points?|yards?|rebounds?|assists?|shots?|goals?)\b/.test(text)) return false;
          if (/(?:^|\s)[+-]\d+(?:\.\d+)?(?:\s|$)/.test(text)) return false;
          return isPlainTeamSide(title) || /(?:^|[-_])ml(?:$|[-_])/i.test(ticker);
        };
        const addMarket = (market: Quote & { event_ticker?: string }, event: string, mode: 'strict' | 'fallback' = 'strict') => {
          if (!market.ticker || (market.status && !['open', 'active'].includes(market.status))) return;
          const title = market.title || market.ticker;
          if (mode === 'strict' ? !isMoneylineMarket(event, title, market.ticker) : !isLeagueOutcomeContract(event, title, market.ticker)) return;
          if (seen.has(market.ticker)) return;
          seen.add(market.ticker);
          const quotes = [['YES', market.yes_ask_dollars], ['NO', market.no_ask_dollars]] as const;
          for (const [side, ask] of quotes) {
            if (typeof ask !== 'string' || !/^\d+(?:\.\d+)?$/.test(ask)) continue;
            quotedMarkets++;
            const cents = Math.round(Number(ask) * 100);
            markets.push({ ticker: market.ticker, event,
              title, side, askCents: cents,
              yesBid: market.yes_bid_dollars ?? null, yesAsk: market.yes_ask_dollars ?? null,
              noAsk: market.no_ask_dollars ?? null, last: market.last_price_dollars ?? null,
              volume24h: market.volume_24h_fp ?? null });
          }
        };
        const allSources: { market: Quote & { event_ticker?: string }; event: string }[] = [];
        for (const market of results.flat()) {
          if (!market.event_ticker) continue;
          allSources.push({ market, event: eventTitles.get(market.event_ticker) || market.event_ticker });
        }
        for (const event of sports) {
          if (!event.event_ticker) continue;
          for (const market of event.markets || []) {
            allSources.push({ market, event: event.title || event.event_ticker });
          }
        }
        for (const source of allSources) addMarket(source.market, source.event, 'strict');
        if (markets.length === 0) {
          seen.clear();
          for (const source of allSources) addMarket(source.market, source.event, 'fallback');
        }
        scanSignal.throwIfAborted();
        markets.sort((a, b) => a.askCents - b.askCents || a.event.localeCompare(b.event));
        const modeNote = markets.length ? 'Results prioritize moneyline contracts and may fall back to team-outcome contracts when no moneyline matches are found for the selected league.' : 'No contracts matched the selected league and range in this snapshot.';
        return { source: 'Kalshi public API', provider, scannedAt: new Date().toISOString(),
          sportsEvents, pagesScanned, nestedMarkets, quotedMarkets, fetchedMarkets: results.reduce((n, group) => n + group.length, 0), marketPagesScanned, rateLimited, markets, partialCoverage: Boolean(cursor || marketCursor || rateLimited),
          note: 'Sports-only, on-demand scan. ' + modeNote + ' Quotes are displayed by contract side (YES/NO) at the current ask. Up to five event pages and ten market pages are checked. Coverage is partial when additional pages exist or rate limiting occurs.' };
        };
        const result = env.DB
          ? await sharedScan(env.DB, min, max, fetchSnapshot)
          : uncachedScan(await fetchSnapshot(request.signal), min, max);
        const leagueFiltered = result.markets.filter((market) => inferLeague(market.event, market.title, market.ticker) === selectedLeague);
        return json({ ...result, markets: leagueFiltered, note: result.note + ' League filter: ' + leagueLabel(selectedLeague) + '.' });
      } catch (e) { return json({ error: e instanceof Error ? e.message : 'Kalshi feed unavailable' }, 502); }
    }
    const leagueCompare = new RegExp('^/api/leagues/(nfl|nhl|mlb|wnba|ncaaf|ncaam)/compare$').exec(url.pathname);
    if (leagueCompare) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const league = leagueCompare[1];
      const sportPaths: Record<string, string> = { nfl:'football/nfl', nhl:'hockey/nhl', mlb:'baseball/mlb', wnba:'basketball/wnba', ncaaf:'football/college-football', ncaam:'basketball/mens-college-basketball' };
      const left = url.searchParams.get('left'), right = url.searchParams.get('right');
      const sample = Number(url.searchParams.get('sample') || 5);
      if (!left || !right || left === right || !/^[0-9]+$/.test(left) || !/^[0-9]+$/.test(right) || ![5,10,20].includes(sample)) return json({ error:'Select two different teams and a valid game range.' },400);
      try {
        const now = new Date(); const start = new Date(now.getTime() - (league === 'nfl' || league === 'ncaaf' ? 160 : 210) * 86400000);
        const windows: string[] = [];
        const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
        const fmt = (d: Date) => d.toISOString().slice(0,10).replace(/-/g,'');
        while (cursor <= now) {
          const y=cursor.getUTCFullYear(), m=cursor.getUTCMonth();
          const first = new Date(Math.max(start.getTime(),Date.UTC(y,m,1)));
          const last = new Date(Math.min(now.getTime(),Date.UTC(y,m+1,0)));
          windows.push(fmt(first)+'-'+fmt(last)); cursor.setUTCMonth(cursor.getUTCMonth()+1);
        }
        type Competitor = { homeAway?:string; score?:string; team?:{id?:string} };
        type Event = { id?:string; date?:string; status?:{type?:{completed?:boolean}}; competitions?:{competitors?:Competitor[]}[] };
        const pages = await Promise.all(windows.map(async dates => {
          const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/'+sportPaths[league]+'/scoreboard?dates='+dates+'&limit=500', {signal:AbortSignal.timeout(12000)});
          if (!response.ok) throw new Error('ESPN scoreboard HTTP '+response.status);
          const data = await response.json() as {events?:Event[]};
          if (!Array.isArray(data.events)) throw new Error('ESPN scoreboard schema changed');
          return data.events;
        }));
        const all = new Map<string,{id:string;date:string;home:string;away:string;hs:number;as:number}>();
        for (const event of pages.flat()) {
          if (!event.id || !event.date || !event.status?.type?.completed) continue;
          const competitors=event.competitions?.[0]?.competitors || [];
          const home=competitors.find(c=>c.homeAway==='home'),away=competitors.find(c=>c.homeAway==='away');
          if (!home?.team?.id || !away?.team?.id || !/^\\d+$/.test(String(home.score)) || !/^\\d+$/.test(String(away.score))) continue;
          if (![left,right].includes(home.team.id) && ![left,right].includes(away.team.id)) continue;
          all.set(event.id,{id:event.id,date:event.date,home:home.team.id,away:away.team.id,hs:Number(home.score),as:Number(away.score)});
        }
        const games=[...all.values()].sort((a,b)=>b.date.localeCompare(a.date));
        const summarizeTeam=(id:string)=>{
          const selected=games.filter(g=>g.home===id || g.away===id).slice(0,sample);
          const recent=selected.map(g=>{const home=g.home===id;const scored=home?g.hs:g.as,allowed=home?g.as:g.hs;return {date:g.date.slice(0,10),scored,allowed,win:scored>allowed,tie:scored===allowed};});
          const wins=recent.filter(g=>g.win).length, ties=recent.filter(g=>g.tie).length;
          const average=(key:'scored'|'allowed')=>recent.length?Math.round(recent.reduce((sum,g)=>sum+g[key],0)/recent.length*10)/10:null;
          return {games:recent.length,wins,losses:recent.length-wins-ties,ties,pointsFor:average('scored'),pointsAgainst:average('allowed'),recent};
        };
        const a=summarizeTeam(left),b=summarizeTeam(right);
        const direct=games.filter(g=>(g.home===left&&g.away===right)||(g.home===right&&g.away===left)).slice(0,sample);
        const h2h={games:direct.length,leftWins:direct.filter(g=>(g.home===left?g.hs:g.as)>(g.home===left?g.as:g.hs)).length,rightWins:direct.filter(g=>(g.home===right?g.hs:g.as)>(g.home===right?g.as:g.hs)).length,ties:direct.filter(g=>g.hs===g.as).length,meetings:direct.map(g=>({date:g.date.slice(0,10),leftScore:g.home===left?g.hs:g.as,rightScore:g.home===right?g.hs:g.as}))};
        const metricProfiles:Record<string,{unit:string;formMetrics:string[];advancedMetrics:string[]}>={
          nfl:{unit:'points',formMetrics:['pointsFor','pointsAgainst','wins','losses','ties'],advancedMetrics:['yardsPerPlay','passingYards','rushingYards','turnovers','thirdDownEfficiency']},
          ncaaf:{unit:'points',formMetrics:['pointsFor','pointsAgainst','wins','losses','ties'],advancedMetrics:['yardsPerPlay','passingYards','rushingYards','turnovers','thirdDownEfficiency']},
          nhl:{unit:'goals',formMetrics:['pointsFor','pointsAgainst','wins','losses'],advancedMetrics:['shotsOnGoal','savePercentage','powerPlayPercentage','penaltyKillPercentage']},
          mlb:{unit:'runs',formMetrics:['pointsFor','pointsAgainst','wins','losses'],advancedMetrics:['hits','earnedRunAverage','whip','onBasePercentage','bullpenEra']},
          wnba:{unit:'points',formMetrics:['pointsFor','pointsAgainst','wins','losses'],advancedMetrics:['fieldGoalPercentage','rebounds','assists','turnovers']},
          ncaam:{unit:'points',formMetrics:['pointsFor','pointsAgainst','wins','losses'],advancedMetrics:['fieldGoalPercentage','rebounds','assists','turnovers','offensiveEfficiency']}
        };
        const profile=metricProfiles[league];
        if (!a.games || !b.games) return json({error:'Insufficient completed games returned by ESPN for one or both teams.'},502);
        return json({source:'ESPN public scoreboard',league,fetchedAt:new Date().toISOString(),sample,left:a,right:b,h2h,metricProfile:{unit:profile.unit,available:profile.formMetrics,unavailable:profile.advancedMetrics},partial:a.games<sample||b.games<sample,note:'Completed games within the available date window. Public ESPN date ranges may be truncated; historical coverage is not guaranteed.'});
      } catch(e) { return json({error:e instanceof Error?e.message:'ESPN comparison unavailable'},502); }
    }
    if (url.pathname.startsWith('/api/leagues/')) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const match = new RegExp('^/api/leagues/(nfl|nhl|mlb|wnba|ncaaf|ncaam)/teams$').exec(url.pathname);
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
      try {
        if (url.pathname === '/api/nba/compare') {
          const left = Number(url.searchParams.get('left')), right = Number(url.searchParams.get('right'));
          const sample = Number(url.searchParams.get('sample') || 10);
          if (!Number.isInteger(left) || !Number.isInteger(right) || left <= 0 || right <= 0 || left === right || ![5,10,20].includes(sample)) return json({ error: 'Select two different teams and a valid sample.' }, 400);
          return json(await espnComparison(left, right, sample));
        }
        if (url.pathname === '/api/nba/games') return json({ error: 'Dated game listings are not yet implemented with ESPN.' }, 501);
      } catch (e) { return json({ message: e instanceof Error ? e.message : 'ESPN NBA provider unavailable' }, 502); }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  }
};
