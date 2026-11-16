import { getNationsScoreboard } from './nations-scoreboard.ts';
import { moneyPuckComparison } from './moneypuck.ts';
import { sharedScan, uncachedScan, type ScanSnapshot, type ScanDatabase } from './scan-cache.ts';
interface Environment { ASSETS: { fetch(request: Request): Promise<Response> }; DB?: ScanDatabase }
type Team = { id: number; full_name: string };
type Game = { id: number; date: string; status: string; home_team: Team; visitor_team: Team; home_team_score: number; visitor_team_score: number };
const NBA_TEAMS: Team[] = [{"id":1,"full_name":"Atlanta Hawks"},{"id":2,"full_name":"Boston Celtics"},{"id":3,"full_name":"Brooklyn Nets"},{"id":4,"full_name":"Charlotte Hornets"},{"id":5,"full_name":"Chicago Bulls"},{"id":6,"full_name":"Cleveland Cavaliers"},{"id":7,"full_name":"Dallas Mavericks"},{"id":8,"full_name":"Denver Nuggets"},{"id":9,"full_name":"Detroit Pistons"},{"id":10,"full_name":"Golden State Warriors"},{"id":11,"full_name":"Houston Rockets"},{"id":12,"full_name":"Indiana Pacers"},{"id":13,"full_name":"LA Clippers"},{"id":14,"full_name":"Los Angeles Lakers"},{"id":15,"full_name":"Memphis Grizzlies"},{"id":16,"full_name":"Miami Heat"},{"id":17,"full_name":"Milwaukee Bucks"},{"id":18,"full_name":"Minnesota Timberwolves"},{"id":19,"full_name":"New Orleans Pelicans"},{"id":20,"full_name":"New York Knicks"},{"id":21,"full_name":"Oklahoma City Thunder"},{"id":22,"full_name":"Orlando Magic"},{"id":23,"full_name":"Philadelphia 76ers"},{"id":24,"full_name":"Phoenix Suns"},{"id":25,"full_name":"Portland Trail Blazers"},{"id":26,"full_name":"Sacramento Kings"},{"id":27,"full_name":"San Antonio Spurs"},{"id":28,"full_name":"Toronto Raptors"},{"id":29,"full_name":"Utah Jazz"},{"id":30,"full_name":"Washington Wizards"}];
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
class KalshiRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfter: string | null) {
    super('Kalshi is temporarily rate limiting scans. Please retry shortly.');
    const seconds = retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : Math.ceil((Date.parse(retryAfter ?? '') - Date.now()) / 1000);
    this.retryAfterSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 1;
  }
}
function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)); }
type EspnScore = string | number | { value?: number | string; displayValue?: string };
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
const NBA_ABBREVIATIONS = ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GS','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NO','NY','OKC','ORL','PHI','PHX','POR','SAC','SA','TOR','UTAH','WSH'];
async function espnComparison(left: number, right: number, sample: number) {
  // ESPN scoreboard rejects large date-range requests (HTTP 400). Query each
  // selected team's season schedule instead, using ESPN's own NBA team IDs.
  const currentYear = new Date().getUTCFullYear();
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
    if (url.pathname === '/api/live-monitor/scores') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const day = url.searchParams.get('date') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
      if (!/^20\d{6}$/.test(day)) return json({ error: 'Invalid date' }, 400);
      const sources = [{league:'nba',path:'basketball/nba'},{league:'nhl',path:'hockey/nhl'},{league:'soccer',path:'soccer/uefa.nations'}];
      const responses = await Promise.all(sources.map(async ({league,path}) => {
        try {
          const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/'+path+'/scoreboard?dates='+day+'&limit=100',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
          if (!response.ok) throw new Error('ESPN HTTP '+response.status);
          const data = await response.json() as {events?:unknown[]};
          if (!Array.isArray(data.events)) throw new Error('Missing ESPN events');
          return {league,events:data.events,error:null};
        } catch(error) {return {league,events:[],error:error instanceof Error?error.message:'ESPN unavailable'};}
      }));
      const failed = responses.filter(item=>item.error);
      if (failed.length===responses.length) return json({error:'All ESPN scoreboards unavailable',sources:responses},502);
      return json({source:'ESPN public scoreboards',fetchedAt:new Date().toISOString(),date:day,sources:responses});
    }
    if (url.pathname === '/api/live-monitor/trajectory') {
      if (request.method !== 'GET') return json({error:'Method not allowed'},405);
      const league=url.searchParams.get('league');
      const event=url.searchParams.get('event');
      if (!['nba','nhl','soccer'].includes(league||'') || !event || !/^[0-9]{6,12}$/.test(event)) return json({error:'Invalid league or ESPN event'},400);
      const sport=league==='nba'?'basketball/nba':league==='nhl'?'hockey/nhl':'soccer/uefa.nations';
      try {
        const upstream=await fetch('https://site.api.espn.com/apis/site/v2/sports/'+sport+'/summary?event='+event,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
        if(!upstream.ok) return json({error:'ESPN summary HTTP '+upstream.status},502);
        const payload=await upstream.json() as {plays?:unknown[];scoringPlays?:unknown[];boxscore?:{teams?:unknown[]}};
        const plays=Array.isArray(payload.plays)?payload.plays:Array.isArray(payload.scoringPlays)?payload.scoringPlays:[];
        return json({source:'ESPN',event,league,plays,teams:payload.boxscore?.teams||[],fetchedAt:new Date().toISOString()});
      }catch(error){return json({error:error instanceof Error?error.message:'ESPN summary unavailable'},502)}
    }
    if (url.pathname === '/api/nba/momentum') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const eventId = '401909296';
      try {
        const upstream = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=' + eventId, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000)
        });
        if (!upstream.ok) return json({ error: 'ESPN returned HTTP ' + upstream.status }, 502);
        const payload = await upstream.json() as { plays?: unknown[]; header?: unknown };
        if (!Array.isArray(payload.plays)) return json({ error: 'ESPN play-by-play not available' }, 502);
        return json({ ...payload, fetchedAt: new Date().toISOString(), source: 'ESPN' });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'ESPN request failed' }, 502);
      }
    }
    if (url.pathname === '/api/health') return json({ status: 'ok', activeSports: ['nba', 'tennis'], backgroundScanning: false });
    if (url.pathname === '/api/nhl/xg-comparison') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const left = (url.searchParams.get('left') || '').toUpperCase();
      const right = (url.searchParams.get('right') || '').toUpperCase();
      // NHL season identifiers use the calendar year in which the season starts.
      const now = new Date();
      const season = now.getUTCFullYear() - (now.getUTCMonth() < 8 ? 1 : 0);
      if (!/^[A-Z]{2,4}$/.test(left) || !/^[A-Z]{2,4}$/.test(right) || left === right)
        return json({ error: 'Select two different NHL team abbreviations.' }, 400);
      try { return json(await moneyPuckComparison(left, right, season)); }
      catch (e) { return json({ error: e instanceof Error ? e.message : 'MoneyPuck unavailable' }, 502); }
    }
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
      const scanLeagues = ['nba', 'nfl', 'nhl', 'mlb', 'wnba', 'ncaaf', 'ncaam', 'ncaav'] as const;
      type ScanLeague = (typeof scanLeagues)[number];
      const selectedLeague = ((url.searchParams.get('league') || 'nba').toLowerCase()) as ScanLeague;
      if (!scanLeagues.includes(selectedLeague)) return json({ error: 'Unsupported league filter' }, 400);
      const inferLeague = (event: string, title: string, ticker: string): ScanLeague | null => {
        const text = (event + ' ' + title + ' ' + ticker).toLowerCase();
        if (/kxncaawv/.test(text)) return 'ncaav';
        if (/kxwnba|\bwnba\b/.test(text)) return 'wnba';
        if (/kxncaaf|\bncaaf\b|college football/.test(text)) return 'ncaaf';
        if (/kxncaam|\bncaam\b|mens college basketball|men\'s college basketball|ncaa basketball|college basketball/.test(text)) return 'ncaam';
        if (/kxnfl|\bnfl\b|super bowl|pro football/.test(text)) return 'nfl';
        if (/kxnhl|\bnhl\b|stanley cup|hockey/.test(text)) return 'nhl';
        if (/kxmlb|\bmlb\b|world series|baseball/.test(text)) return 'mlb';
        if (/kxnba|\bnba\b|celtics|76ers|lakers|warriors|knicks|bulls|bucks|heat|nets|suns|mavericks|spurs|raptors|cavaliers|nuggets|timberwolves|pelicans|thunder|magic|grizzlies|hawks|hornets|pistons|pacers|rockets|clippers|trail blazers|wizards|jazz|kings|\bbos\b|\bphi\b|boston pro basketball|philadelphia pro basketball/.test(text)) return 'nba';
        if (/wins by over\s+\d+(?:\.\d+)?\s+points/.test(text) && /\b(boston|philadelphia|new york|miami|phoenix|orlando|oklahoma city|san antonio|toronto|utah|washington|chicago|cleveland|dallas|denver|detroit|houston|indiana|memphis|minnesota|new orleans|portland|sacramento|los angeles|milwaukee|atlanta|charlotte)\b/.test(text)) return 'nba';
        return null;
      };
      const leagueLabel = (league: ScanLeague): string => league.toUpperCase();
      try {
        const fetchSnapshot = async (scanSignal: AbortSignal): Promise<ScanSnapshot> => {
        // On-demand only. A single D1 snapshot is shared across users and price ranges.
        const endpoint = 'https://external-api.kalshi.com/trade-api/v2';
        type Quote = { ticker?: string; title?: string; status?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; no_ask_dollars?: string; last_price_dollars?: string; volume_24h_fp?: string };
        type Event = { event_ticker?: string; series_ticker?: string; title?: string; category?: string; markets?: Quote[] };
        const markets: ScanSnapshot['markets'] = [];
        let pagesScanned = 0; let sportsEvents = 0; let nestedMarkets = 0; let quotedMarkets = 0;
        let rateLimited = false; let incomplete = false;
        const sports: { event: Event; game: ScoreGame }[] = [];
        let marketPagesScanned = 0;
        let retriedRateLimit = false;
        const fetchJson = async <T>(path: string): Promise<T> => {
          const fetchPage = () => fetch(endpoint + path, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.any([scanSignal, AbortSignal.timeout(13000)])
          });
          let response = await fetchPage();
          if (response.status === 429) {
            const error = new KalshiRateLimitError(response.headers.get('Retry-After'));
            await response.body?.cancel();
            // Give transient throttling one retry within the manual scan's time budget.
            if (retriedRateLimit || error.retryAfterSeconds > 2) throw error;
            retriedRateLimit = true;
            await new Promise<void>(resolve => setTimeout(resolve, error.retryAfterSeconds * 1000));
            scanSignal.throwIfAborted();
            response = await fetchPage();
            if (response.status === 429) {
              await response.body?.cancel();
              throw new KalshiRateLimitError(response.headers.get('Retry-After'));
            }
          }
          if (!response.ok) throw new Error('Kalshi HTTP ' + response.status);
          return response.json() as Promise<T>;
        };
        // Use the authoritative scoreboard to limit discovery to the next 12 hours,
        // while retaining games already in progress. Never infer LIVE from kickoff alone.
        type ScoreTeam = { team?: { displayName?: string; shortDisplayName?: string; name?: string; abbreviation?: string; location?: string } };
        type ScoreGame = { id?: string; date?: string; status?: { type?: { state?: string; completed?: boolean } }; competitions?: { competitors?: ScoreTeam[] }[] };
        const espnPaths: Record<ScanLeague, string> = {
          nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
          mlb: 'baseball/mlb', wnba: 'basketball/wnba',
          ncaaf: 'football/college-football', ncaam: 'basketball/mens-college-basketball',
          ncaav: 'volleyball/womens-college-volleyball'
        };
        const gameSeries: Record<ScanLeague, string> = {
          nba: 'KXNBAGAME', nfl: 'KXNFLGAME', nhl: 'KXNHLGAME', mlb: 'KXMLBGAME',
          wnba: 'KXWNBAGAME', ncaaf: 'KXNCAAFGAME', ncaam: 'KXNCAAMBGAME', ncaav: 'KXNCAAWVMATCH'
        };
        const nowMs = Date.now();
        const twelveHours = 12 * 60 * 60 * 1000;
        const day = (offset: number) => new Date(nowMs + offset * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
        const scoreboard = await Promise.all([-1, 0, 1].map(async offset => {
          const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/' +
            espnPaths[selectedLeague] + '/scoreboard?dates=' + day(offset) + '&limit=200' +
              (selectedLeague === 'ncaam' ? '&groups=50' : selectedLeague === 'ncaaf' ? '&groups=80' : ''), {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.any([scanSignal, AbortSignal.timeout(13000)])
            });
          if (!response.ok) throw new Error('ESPN scoreboard HTTP ' + response.status);
          const payload = await response.json() as { events?: ScoreGame[] };
          if (!Array.isArray(payload.events)) throw new Error('Unexpected ESPN scoreboard response');
          return payload.events;
        }));
        const normalize = (value: string) => value.toLowerCase().trim()
          .replace(/\bst\.?$/, 'state').replace(/^st\.?\s+/, 'saint ')
          .replace(/\bse\s+/, 'southeastern ').replace(/[^a-z0-9]/g, '');
        const gameKey = (game: ScoreGame) => game.id || (game.date || '') + ':' +
          (game.competitions?.[0]?.competitors || []).map(({ team }) => normalize(team?.displayName || '')).sort().join(':');
        const eligibleGames = new Map<string, ScoreGame>();
        for (const game of scoreboard.flat()) {
          const start = Date.parse(game.date || '');
          const state = game.status?.type?.state;
          if (!Number.isFinite(start) || game.status?.type?.completed) continue;
          if (state === 'in' || (state === 'pre' && start >= nowMs && start <= nowMs + twelveHours)) {
            eligibleGames.set(gameKey(game), game);
          }
        }
        type Milestone = { start_date?: string; primary_event_tickers?: string[] };
        type EventPage = { events?: Event[]; milestones?: Milestone[]; cursor?: string };
        const matchesTeam = (name: string, { team }: ScoreTeam): boolean => {
          const full = team?.displayName || '';
          const city = full.split(' ').slice(0, -1).join(' ');
          return [full, city, team?.location, team?.name, team?.shortDisplayName, team?.abbreviation]
            .some(alias => alias && (normalize(alias) === name || (alias.length >= 4 && name.includes(normalize(alias)))));
        };
        const seriesTicker = gameSeries[selectedLeague];
        const matchups = new Map<string, Map<string, ScoreGame>>();
        if (eligibleGames.size > 0) {
          // Resolve IDs from the league's game series. The discovery response carries no quotes.
          const query = new URLSearchParams({
            series_ticker: seriesTicker, status: 'open', limit: '200', with_milestones: 'true',
            min_close_ts: String(Math.floor((nowMs - 86400000) / 1000))
          });
          for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
            const page = await fetchJson<EventPage>('/events?' + query);
            if (!Array.isArray(page.events)) throw new Error('Unexpected Kalshi events response');
            pagesScanned++;
            const starts = new Map<string, number>();
            for (const milestone of page.milestones ?? []) {
              const start = Date.parse(milestone.start_date || '');
              if (!Number.isFinite(start)) continue;
              for (const ticker of milestone.primary_event_tickers ?? []) starts.set(ticker, start);
            }
            for (const event of page.events) {
              const ticker = event.event_ticker;
              if (!ticker?.startsWith(seriesTicker + '-')) continue;
              const start = starts.get(ticker);
              const sides = (event.title || '').split(/\s+(?:at|vs\.?|versus|v)\s+|\s*@\s*/i).map(normalize);
              if (start === undefined || sides.length !== 2 || sides.some(side => !side)) continue;
              const matches = [...eligibleGames.values()].filter(game => {
                const teams = game.competitions?.[0]?.competitors || [];
                if (teams.length !== 2 || Math.abs(start - Date.parse(game.date || '')) > 90 * 60_000) return false;
                return (matchesTeam(sides[0], teams[0]) && matchesTeam(sides[1], teams[1])) ||
                  (matchesTeam(sides[0], teams[1]) && matchesTeam(sides[1], teams[0]));
              });
              if (matches.length !== 1) continue;
              const game = matches[0];
              const key = gameKey(game);
              const candidates = matchups.get(key) ?? new Map<string, ScoreGame>();
              candidates.set(ticker, game);
              matchups.set(key, candidates);
            }
            if (!page.cursor) break;
            if (page.cursor === query.get('cursor')) throw new Error('Kalshi event pagination cursor repeated');
            query.set('cursor', page.cursor);
            if (pageNumber === 3) incomplete = true;
          }
        }
        const targets = new Map<string, ScoreGame>();
        for (const candidates of matchups.values()) {
          if (candidates.size !== 1) continue;
          for (const [ticker, game] of candidates) targets.set(ticker, game);
        }
        const tickers = [...targets.keys()];
        if (tickers.length !== eligibleGames.size) incomplete = true;
        // Include quotes only for exact event IDs on the ESPN slate.
        for (let offset = 0; offset < tickers.length; offset += 20) {
          const batch = new Set(tickers.slice(offset, offset + 20));
          const query = new URLSearchParams({ tickers: [...batch].join(','), with_nested_markets: 'true', limit: '200' });
          const page = await fetchJson<EventPage>('/events?' + query).catch(error => {
            if (!(error instanceof KalshiRateLimitError) || nestedMarkets === 0) throw error;
            rateLimited = true;
            return null;
          });
          if (!page) break;
          if (!Array.isArray(page.events)) throw new Error('Unexpected Kalshi quote response');
          marketPagesScanned++;
          for (const event of page.events) {
            const ticker = event.event_ticker;
            if (!ticker || !batch.delete(ticker) || !Array.isArray(event.markets)) continue;
            sports.push({ event, game: targets.get(ticker)! });
            sportsEvents++;
            nestedMarkets += event.markets.length;
          }
          if (page.cursor || batch.size > 0) incomplete = true;
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
          if (/\b(retire(?:ment)?|career|debut|host|champion|championship|playoff drought|qualifier|qualifiers|before(?:\s+the)?\s+\d{4}|through(?:\s+the)?\s+\d{4}|season)\b/.test(text)) return false;
          const matchContext = /\b(at|vs|versus|v)\b/.test(text) || /@/.test(text) || /\b(match|game)\b/.test(text);
          const winnerSignal = /\bwin(?:s|ner)?\b|\bto win\b|\bmoneyline\b|\byes\b/.test(text);
          const simpleTeamSide = isPlainTeamSide(title);
          const tickerSignal = /(?:^|[-_])ml(?:$|[-_])/i.test(ticker);
          return (matchContext && (winnerSignal || simpleTeamSide)) || tickerSignal;
        };
        const isLeagueOutcomeContract = (event: string, title: string, ticker: string): boolean => {
          const text = (event + ' ' + title).toLowerCase();
          const titleText = title.toLowerCase().trim();
          if (text.includes(',')) return false;
          if (/\b(over|under|spread|total|handicap|alternate line|alt line|points?|yards?|rebounds?|assists?|shots?|goals?)\b/.test(text)) return false;
          if (/(?:^|\s)[+-]\d+(?:\.\d+)?(?:\s|$)/.test(text)) return false;
          if (/\b(retire(?:ment)?|career|debut|host|champion|championship|playoff drought|qualifier|qualifiers|before\s+the\s+\d{4}|through\s+the\s+\d{4}|season)\b/.test(text)) return false;
          const gameContext = /\b(at|vs|versus|v)\b/.test(text) || /@/.test(text) || /\b(match|game)\b/.test(text);
          const explicitMl = /(?:^|[-_])ml(?:$|[-_])/i.test(ticker);
          return (gameContext && isPlainTeamSide(titleText)) || explicitMl;
        };
        const addMarket = (market: Quote, event: string, game: ScoreGame, mode: 'strict' | 'fallback' = 'strict') => {
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
            markets.push({ ticker: market.ticker, event, gameStartAt: game.date,
              gameStatus: game.status?.type?.state === 'in' ? 'live' : 'upcoming',
              title, side, askCents: cents,
              yesBid: market.yes_bid_dollars ?? null, yesAsk: market.yes_ask_dollars ?? null,
              noAsk: market.no_ask_dollars ?? null, last: market.last_price_dollars ?? null,
              volume24h: market.volume_24h_fp ?? null });
          }
        };
        for (const mode of ['strict', 'fallback'] as const) {
          for (const { event, game } of sports) {
            for (const market of event.markets ?? []) addMarket(market, event.title || event.event_ticker!, game, mode);
          }
        }
        scanSignal.throwIfAborted();
        markets.sort((a, b) => a.askCents - b.askCents || a.event.localeCompare(b.event));
        const modeNote = rateLimited ? 'Kalshi rate limited the scan. Only quotes fetched before the limit are included.' :
          eligibleGames.size === 0 ? 'ESPN lists no live games or games starting in the next 12 hours.' :
          'Kalshi quotes were requested only for matched ESPN games.';
        return { source: 'Kalshi public API', provider, scannedAt: new Date().toISOString(),
          scheduledGames: eligibleGames.size, sportsEvents, pagesScanned, nestedMarkets, quotedMarkets,
          fetchedMarkets: nestedMarkets, marketPagesScanned, rateLimited, markets, partialCoverage: incomplete || rateLimited,
          note: modeNote };
        };
        const result = env.DB
          ? await sharedScan(env.DB, min, max, fetchSnapshot, { scope: selectedLeague })
          : uncachedScan(await fetchSnapshot(request.signal), min, max);
        const leagueFiltered = result.markets.filter((market) => inferLeague(market.event, market.title, market.ticker) === selectedLeague);
        return json({ ...result, markets: leagueFiltered, note: result.note + ' League filter: ' + leagueLabel(selectedLeague) + '.' });
      } catch (e) {
        if (e instanceof KalshiRateLimitError) {
          const response = json({ error: e.message, rateLimited: true }, 503);
          response.headers.set('Retry-After', String(e.retryAfterSeconds));
          return response;
        }
        return json({ error: e instanceof Error ? e.message : 'Kalshi feed unavailable' }, 502);
      }
    }
    const leagueCompare = new RegExp('^/api/leagues/(nfl|nhl|mlb|wnba|ncaaf|ncaam|ncaav)/compare$').exec(url.pathname);
    if (leagueCompare) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const league = leagueCompare[1];
      const sportPaths: Record<string, string> = { nfl:'football/nfl', nhl:'hockey/nhl', mlb:'baseball/mlb', wnba:'basketball/wnba', ncaaf:'football/college-football', ncaam:'basketball/mens-college-basketball', ncaav:'volleyball/womens-college-volleyball' };
      const left = url.searchParams.get('left'), right = url.searchParams.get('right');
      const sample = Number(url.searchParams.get('sample') || 5);
      if (!left || !right || left === right || !/^[0-9]+$/.test(left) || !/^[0-9]+$/.test(right) || ![5,10,20].includes(sample)) return json({ error:'Select two different teams and a valid game range.' },400);
      try {
        const now = new Date(); const start = new Date(now.getTime() - (league === 'nfl' || league === 'ncaaf' ? 160 : 210) * 86400000);
        const volleyball = league === 'ncaav';
        const paths: string[] = [];
        if (volleyball) {
          // ESPN volleyball scoreboards accept single dates. Use each selected team's season schedule for history.
          for (const season of new Set([start.getUTCFullYear(), now.getUTCFullYear()])) {
            for (const team of [left, right]) paths.push('teams/' + team + '/schedule?season=' + season);
          }
        } else {
          const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
          const fmt = (d: Date) => d.toISOString().slice(0,10).replace(/-/g,'');
          while (cursor <= now) {
            const y=cursor.getUTCFullYear(), m=cursor.getUTCMonth();
            const first = new Date(Math.max(start.getTime(),Date.UTC(y,m,1)));
            const last = new Date(Math.min(now.getTime(),Date.UTC(y,m+1,0)));
            paths.push('scoreboard?dates=' + fmt(first) + '-' + fmt(last) + '&limit=500');
            cursor.setUTCMonth(m+1);
          }
        }
        type Competitor = { homeAway?:string; score?:EspnScore; team?:{id?:string} };
        type EventStatus = { type?: { completed?: boolean } };
        type Event = { id?:string; date?:string; status?:EventStatus; competitions?:{status?:EventStatus; competitors?:Competitor[]}[] };
        const pages = await Promise.all(paths.map(async path => {
          const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/' + sportPaths[league] + '/' + path, {signal:AbortSignal.timeout(12000)});
          if (!response.ok) throw new Error('ESPN history HTTP ' + response.status);
          const data = await response.json() as {events?:Event[]};
          if (!Array.isArray(data.events)) throw new Error('ESPN history schema changed');
          return data.events;
        }));
        const all = new Map<string,{id:string;date:string;home:string;away:string;hs:number;as:number}>();
        for (const event of pages.flat()) {
          const completed = event.status?.type?.completed ?? event.competitions?.[0]?.status?.type?.completed;
          if (!event.id || !event.date || !completed) continue;
          if (volleyball && (Date.parse(event.date) < start.getTime() || Date.parse(event.date) > now.getTime())) continue;
          const competitors=event.competitions?.[0]?.competitors || [];
          const home=competitors.find(c=>c.homeAway==='home'),away=competitors.find(c=>c.homeAway==='away');
          if (!home?.team?.id || !away?.team?.id) continue;
          const hs = volleyball ? scoreValue(home.score) : /^\d+$/.test(String(home.score)) ? Number(home.score) : NaN;
          const as = volleyball ? scoreValue(away.score) : /^\d+$/.test(String(away.score)) ? Number(away.score) : NaN;
          if (!Number.isInteger(hs) || !Number.isInteger(as) || hs < 0 || as < 0) continue;
          if (![left,right].includes(home.team.id) && ![left,right].includes(away.team.id)) continue;
          all.set(event.id,{id:event.id,date:event.date,home:home.team.id,away:away.team.id,hs,as});
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
          ncaav:{unit:'sets',formMetrics:['setsWon','setsLost','wins','losses'],advancedMetrics:['hittingPercentage','kills','digs','blocks']},
          ncaam:{unit:'points',formMetrics:['pointsFor','pointsAgainst','wins','losses'],advancedMetrics:['fieldGoalPercentage','rebounds','assists','turnovers','offensiveEfficiency']}
        };
        const profile=metricProfiles[league];
        if (!a.games || !b.games) return json({error:'Insufficient completed games returned by ESPN for one or both teams.'},502);
        return json({source:volleyball ? 'ESPN team schedules' : 'ESPN public scoreboard',league,fetchedAt:new Date().toISOString(),sample,left:a,right:b,h2h,metricProfile:{unit:profile.unit,available:profile.formMetrics,unavailable:profile.advancedMetrics},partial:a.games<sample||b.games<sample,note:volleyball ? 'Completed matches from ESPN team schedules. Scores are sets won.' : 'Completed games within the available date window. Public ESPN date ranges may be truncated; historical coverage is not guaranteed.'});
      } catch(e) { return json({error:e instanceof Error?e.message:'ESPN comparison unavailable'},502); }
    }
    if (url.pathname.startsWith('/api/leagues/')) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const match = new RegExp('^/api/leagues/(nfl|nhl|mlb|wnba|ncaaf|ncaam|ncaav)/teams$').exec(url.pathname);
      if (!match) return json({ error: 'Unknown league' }, 404);
      const leagues: Record<string, string> = { nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb', wnba: 'basketball/wnba', ncaaf: 'football/college-football', ncaam: 'basketball/mens-college-basketball', ncaav: 'volleyball/womens-college-volleyball' };
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
    if (url.pathname === '/api/nations/scoreboard') {
      if (request.method !== 'GET') return json({error:'Method not allowed'},405);
      try { return json(await getNationsScoreboard()); }
      catch (e) { return json({error:e instanceof Error?e.message:'ESPN Nations League unavailable'},502); }
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
