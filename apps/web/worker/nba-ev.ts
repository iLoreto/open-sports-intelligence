/**
 * NBA game-winner EV research, deliberately separate from generic Sports.
 * Only exact KXNBAGAME event identifiers and scheduled ESPN STD fixtures may
 * be compared. Quoted asks come from the live series feed, not the stale D1
 * catalog. Figures are model-dependent estimates, not proven betting edges.
 */
import { currentEloSnapshot, forecast, modelMetadata } from './nba-model.ts';
import { numberOrNull, type KalshiMarket } from './markets.ts';

const NBA_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const KALSHI = 'https://external-api.kalshi.com/trade-api/v2';
const SERIES = 'KXNBAGAME';
const HORIZON_DAYS = 7;
const ORDER_SIZE = 100;
const STANDARD_TAKER_RATE = 0.07;
const MAX_MARKET_PAGES = 4;
const MARKET_PAGE_SIZE = 1000;
const CACHE_SECONDS = 300;

interface Team { id?: string; abbreviation?: string; displayName?: string }
interface Competitor { homeAway?: string; team?: Team }
interface NbaFixture {
  id?: string;
  date?: string;
  season?: { type?: number; year?: number };
  status?: { type?: { state?: string } };
  competitions?: Array<{
    type?: { abbreviation?: string };
    status?: { type?: { state?: string } };
    competitors?: Competitor[];
  }>;
}
interface Scoreboard { events?: NbaFixture[] }
interface MarketPage { markets?: KalshiMarket[]; cursor?: string }
interface SeriesReply { series?: { ticker?: string; fee_type?: string; fee_multiplier?: number } }

export interface NbaEvOffer {
  team: string;
  outcome: 'home' | 'away';
  side: 'YES' | 'NO';
  ticker: string;
  yesMarketTeam: string;
  ask: number;
  modelProbability: number;
  grossEdge: number;
  feePerContract: number | null;
  illustrativeNetEv: number | null;
  breakEvenProbability: number | null;
  volume24h: number;
}

export interface NbaEvGame {
  gameId: string;
  eventTicker: string;
  startTime: string;
  away: string;
  home: string;
  modelHomeProbability: number;
  offers: NbaEvOffer[];
}

export interface NbaEvResponse {
  source: 'ESPN NBA schedule, experimental Elo, Kalshi public KXNBAGAME quotes';
  fetchedAt: string;
  horizonDays: number;
  model: { available: boolean; name: string; validationBrier: number; validationGames: number; message: string };
  fees: { feeType: string | null; multiplier: number | null; standardRate: number; illustrativeContracts: number; description: string };
  games: NbaEvGame[];
  offers: Array<NbaEvOffer & { gameId: string; eventTicker: string; away: string; home: string; startTime: string }>;
  unmatched: Array<{ away: string; home: string; startTime: string; reason: string }>;
  counts: { scheduledGames: number; matchedGames: number; comparedOffers: number; marketPages: number; partialMarketCoverage: boolean };
  warnings: string[];
}

const NBA_ALIASES: Record<string, string> = {
  GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', WSH: 'WAS', UTAH: 'UTA'
};

export function teamCode(team: Team): string | null {
  const abbreviation = team.abbreviation?.trim().toUpperCase();
  if (!abbreviation || !/^[A-Z]{2,4}$/.test(abbreviation)) return null;
  return NBA_ALIASES[abbreviation] ?? abbreviation;
}

export function kalshiEventTicker(game: NbaFixture): string | null {
  if (!game.date || !Number.isFinite(Date.parse(game.date))) return null;
  const away = game.competitions?.[0]?.competitors?.find((team) => team.homeAway === 'away')?.team;
  const home = game.competitions?.[0]?.competitors?.find((team) => team.homeAway === 'home')?.team;
  if (!away?.id || !home?.id || away.id === home.id) return null;
  const awayCode = teamCode(away);
  const homeCode = teamCode(home);
  if (!awayCode || !homeCode) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: '2-digit', month: 'short', day: '2-digit'
  }).formatToParts(new Date(game.date));
  const read = (type: string) => parts.find((part) => part.type === type)?.value.toUpperCase() ?? '';
  return `${SERIES}-${read('year')}${read('month')}${read('day')}${awayCode}${homeCode}`;
}

/** Kalshi rounds the total taker fee upward to the next cent. */
export function illustrativeFee(price: number, multiplier: number, contracts = ORDER_SIZE): number | null {
  if (!(price > 0 && price < 1) || !Number.isFinite(multiplier) || multiplier < 0 || !Number.isInteger(contracts) || contracts <= 0) return null;
  if (multiplier === 0) return 0;
  return Math.ceil((STANDARD_TAKER_RATE * multiplier * contracts * price * (1 - price) - 1e-12) * 100) / 100;
}

function validQuote(value: string | undefined): number | null {
  const price = numberOrNull(value);
  return price !== null && price > 0 && price < 1 ? price : null;
}

export function compareGame(game: NbaFixture, markets: KalshiMarket[], homeProbability: number,
  feeMultiplier: number | null): NbaEvGame | null {
  const eventTicker = kalshiEventTicker(game);
  const competitors = game.competitions?.[0]?.competitors ?? [];
  const away = competitors.find((x) => x.homeAway === 'away')?.team;
  const home = competitors.find((x) => x.homeAway === 'home')?.team;
  const awayCode = away && teamCode(away);
  const homeCode = home && teamCode(home);
  if (!game.id || !game.date || !eventTicker || !awayCode || !homeCode || !away || !home ||
    !Number.isFinite(homeProbability) || homeProbability < 0 || homeProbability > 1) return null;
  const eligible = markets.filter((market) => ['open', 'active'].includes(market.status ?? '') && market.event_ticker === eventTicker);
  const byCode = new Map(eligible.map((market) => [market.ticker, market]));
  const awayMarket = byCode.get(`${eventTicker}-${awayCode}`);
  const homeMarket = byCode.get(`${eventTicker}-${homeCode}`);
  // Both outcome contracts must exist, with exact team suffixes. No prop,
  // spread, total, future, in-game or similarly named market is inferred.
  if (!awayMarket || !homeMarket) return null;

  const offers: NbaEvOffer[] = [];
  for (const [outcome, team, winProbability, own, opposite] of [
    ['away', away.displayName ?? awayCode, 1 - homeProbability, awayMarket, homeMarket],
    ['home', home.displayName ?? homeCode, homeProbability, homeMarket, awayMarket]
  ] as const) {
    const routes = [
      { market: own, side: 'YES' as const, ask: validQuote(own.yes_ask_dollars) },
      { market: opposite, side: 'NO' as const, ask: validQuote(opposite.no_ask_dollars) }
    ].filter((route): route is { market: KalshiMarket; side: 'YES' | 'NO'; ask: number } => route.ask !== null);
    const options = routes.map((route) => {
      const fee = feeMultiplier === null ? null : illustrativeFee(route.ask, feeMultiplier);
      const feePerContract = fee === null ? null : fee / ORDER_SIZE;
      return {
        team, outcome, side: route.side, ticker: route.market.ticker,
        yesMarketTeam: route.market === homeMarket ? home.displayName ?? homeCode : away.displayName ?? awayCode,
        ask: route.ask, modelProbability: winProbability,
        grossEdge: winProbability - route.ask,
        feePerContract,
        illustrativeNetEv: feePerContract === null ? null : winProbability - route.ask - feePerContract,
        breakEvenProbability: feePerContract === null ? null : route.ask + feePerContract,
        volume24h: numberOrNull(route.market.volume_24h_fp) ?? 0
      } satisfies NbaEvOffer;
    });
    options.sort((a, b) => (a.ask + (a.feePerContract ?? 0)) - (b.ask + (b.feePerContract ?? 0)) ||
      (a.side === 'YES' ? -1 : 1));
    if (options[0]) offers.push(options[0]);
  }
  if (!offers.length) return null;
  return { gameId: game.id, eventTicker, startTime: game.date,
    away: away.displayName ?? awayCode, home: home.displayName ?? homeCode,
    modelHomeProbability: homeProbability, offers };
}

async function publicJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function monthCodes(now: Date, horizonDays: number): string[] {
  const calendar = (time: Date) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit'
  }).formatToParts(time);
  const code = (time: Date) => {
    const p = calendar(time);
    return `${p.find((x) => x.type === 'year')?.value}${p.find((x) => x.type === 'month')?.value}`;
  };
  return [...new Set([code(now), code(new Date(now.getTime() + horizonDays * 86400000))])];
}

async function liveNbaMarkets(): Promise<{ markets: KalshiMarket[]; pages: number; partial: boolean }> {
  const markets: KalshiMarket[] = [];
  let cursor = '';
  let pages = 0;
  do {
    const url = new URL(`${KALSHI}/markets`);
    url.searchParams.set('series_ticker', SERIES);
    url.searchParams.set('status', 'open');
    url.searchParams.set('limit', String(MARKET_PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);
    const page = await publicJson<MarketPage>(url.toString());
    if (!Array.isArray(page.markets)) throw new Error('Unexpected Kalshi market response');
    markets.push(...page.markets);
    pages++;
    cursor = page.cursor || '';
  } while (cursor && pages < MAX_MARKET_PAGES);
  return { markets, pages, partial: !!cursor };
}

export async function scanNbaEv(now = new Date()): Promise<NbaEvResponse> {
  const fetchedAt = new Date().toISOString();
  const [schedule, quotes, feeInfo, rating] = await Promise.allSettled([
    Promise.all(monthCodes(now, HORIZON_DAYS).map((month) =>
      publicJson<Scoreboard>(`${NBA_SCOREBOARD}?dates=${month}&limit=500`))),
    liveNbaMarkets(),
    publicJson<SeriesReply>(`${KALSHI}/series/${SERIES}`),
    currentEloSnapshot(now)
  ]);
  if (schedule.status === 'rejected' || quotes.status === 'rejected') {
    throw new Error('The NBA schedule or live KXNBAGAME market feed could not be verified.');
  }
  const warnings: string[] = [];
  if (quotes.value.partial) warnings.push(`Kalshi market pagination was capped at ${MAX_MARKET_PAGES} pages; some NBA contracts may be missing.`);
  let feeMultiplier: number | null = null;
  let feeType: string | null = null;
  if (feeInfo.status === 'fulfilled') {
    feeType = feeInfo.value.series?.fee_type ?? null;
    const multiplier = feeInfo.value.series?.fee_multiplier;
    if (feeInfo.value.series?.ticker === SERIES && feeType === 'quadratic_with_maker_fees' &&
      typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier >= 0) feeMultiplier = multiplier;
  }
  if (feeMultiplier === null) warnings.push('Current NBA series fee terms could not be verified. Gross model gaps are shown; estimated net EV is withheld.');
  const metadata = rating.status === 'fulfilled' ? rating.value.metadata : modelMetadata();
  if (rating.status === 'rejected' || !metadata.available) warnings.push('NBA Elo input history is incomplete. All EV calculations are withheld.');

  const time = now.getTime();
  const end = time + HORIZON_DAYS * 86400000;
  const eligible = new Map<string, NbaFixture>();
  for (const month of schedule.value) for (const event of month.events ?? []) {
    const date = Date.parse(event.date ?? '');
    if (!event.id || !Number.isFinite(date) || date <= time || date > end ||
      event.season?.type !== 2 || event.season.year !== metadata.forecastSeason ||
      event.competitions?.[0]?.type?.abbreviation !== 'STD') continue;
    const status = event.status?.type?.state ?? event.competitions[0]?.status?.type?.state;
    if (status !== 'pre') continue;
    eligible.set(event.id, event);
  }
  const upcoming = [...eligible.values()].sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!));
  const marketsByEvent = new Map<string, KalshiMarket[]>();
  for (const market of quotes.value.markets) {
    const list = marketsByEvent.get(market.event_ticker) ?? [];
    list.push(market);
    marketsByEvent.set(market.event_ticker, list);
  }
  const games: NbaEvGame[] = [];
  const unmatched: NbaEvResponse['unmatched'] = [];
  for (const fixture of upcoming) {
    const competitors = fixture.competitions?.[0]?.competitors ?? [];
    const away = competitors.find((team) => team.homeAway === 'away')?.team;
    const home = competitors.find((team) => team.homeAway === 'home')?.team;
    if (!away?.id || !home?.id || !away.displayName || !home.displayName) continue;
    const eventTicker = kalshiEventTicker(fixture);
    if (rating.status !== 'fulfilled' || !metadata.available) continue;
    const prediction = forecast(home.id, away.id, rating.value.ratings);
    const match = eventTicker ? compareGame(fixture, marketsByEvent.get(eventTicker) ?? [], prediction.homeWinProbability, feeMultiplier) : null;
    if (match) games.push(match);
    else unmatched.push({ away: away.displayName, home: home.displayName, startTime: fixture.date!,
      reason: 'Exact active winner markets for both teams were not available with usable quotes.' });
  }
  const offers = games.flatMap((game) => game.offers.map((offer) => ({ ...offer,
    gameId: game.gameId, eventTicker: game.eventTicker, away: game.away, home: game.home, startTime: game.startTime
  }))).sort((a, b) => (b.illustrativeNetEv ?? b.grossEdge) - (a.illustrativeNetEv ?? a.grossEdge));
  return {
    source: 'ESPN NBA schedule, experimental Elo, Kalshi public KXNBAGAME quotes',
    fetchedAt, horizonDays: HORIZON_DAYS,
    model: { available: metadata.available && rating.status === 'fulfilled', name: metadata.name,
      validationBrier: metadata.brier, validationGames: metadata.validationGames,
      message: metadata.message },
    fees: { feeType, multiplier: feeMultiplier, standardRate: STANDARD_TAKER_RATE,
      illustrativeContracts: ORDER_SIZE, description: 'Illustrative standard taker fee for 100 contracts, rounded up once per order. Exact fees, liquidity and fill price can differ.' },
    games, offers, unmatched,
    counts: { scheduledGames: upcoming.length, matchedGames: games.length, comparedOffers: offers.length,
      marketPages: quotes.value.pages, partialMarketCoverage: quotes.value.partial },
    warnings: [
      ...warnings,
      'Elo omits injuries, lineups, rest and travel and has imperfect historical calibration. Positive model EV is not a verified edge.',
      'Normal NBA winner settlements are assumed; postponements and other Kalshi contract exceptions can differ.'
    ]
  };
}

export async function handleNbaEv(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fresh = url.searchParams.get('fresh') === '1';
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(new URL('/api/nba/ev', url.origin).toString());
  if (!fresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  try {
    const result = await scanNbaEv();
    const response = Response.json(result, { headers: {
      'Cache-Control': `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
      'X-Content-Type-Options': 'nosniff'
    }});
    try { await cache.put(cacheKey, response.clone()); } catch { /* Response remains usable without cache. */ }
    return response;
  } catch (error) {
    console.error('NBA EV scan failed', error);
    return Response.json({ error: 'NBA EV comparison data temporarily unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
