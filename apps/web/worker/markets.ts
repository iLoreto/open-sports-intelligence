/**
 * Cloudflare Worker route: public, read-only Kalshi market data.
 *
 * Deliberately publishes raw market facts. No model-derived probabilities or
 * trade recommendations are calculated here.
 */

import { latestSnapshot, type RadarDatabase } from './persistence';

interface KalshiSeries {
  ticker: string;
  title?: string;
  category?: string;
  categories?: string[];
  tags?: string[];
  volume_fp?: string;
}

interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  status?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  previous_price_dollars?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  occurrence_datetime?: string;
  close_time?: string;
}

interface SeriesReply { series: KalshiSeries[] }
interface MarketsReply { markets: KalshiMarket[]; cursor?: string }
interface ScanMarket {
  ticker: string;
  eventTicker: string;
  title: string;
  eventTitle: string;
  sport: string;
  seriesTitle: string;
  kind: 'game' | 'championship' | 'other';
  yesBid: number | null;
  yesAsk: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  previousPrice: number | null;
  priceChange: number | null;
  volume24h: number;
  openInterest: number;
  closeTime: string | null;
}

const KALSHI = 'https://external-api.kalshi.com/trade-api/v2';
const CACHE_SECONDS = 30 * 60;
const MAX_SERIES_PER_SPORT = 3;
const MAX_SERIES_TOTAL = 21;
const MAX_RESULTS = 180;

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function leagueOf(series: KalshiSeries): string | null {
  const text = [series.title, series.ticker, ...(series.tags ?? [])].join(' ').toLowerCase();
  if (/\b(nba|basketball)\b/.test(text)) return 'NBA';
  if (/\b(nhl|hockey|stanley cup)\b/.test(text)) return 'NHL';
  if (/\b(nfl|super bowl|american football)\b/.test(text)) return 'NFL';
  if (/\b(mlb|baseball|world series)\b/.test(text)) return 'MLB';
  if (/\b(ufc|mma|mixed martial)\b/.test(text)) return 'UFC';
  if (/\b(f1|formula one|formula 1|grand prix|drivers championship)\b/.test(text)) return 'F1';
  if (/\b(soccer|premier league|la liga|champions league|serie a|bundesliga|football)\b/.test(text)) return 'SOCCER';
  return null;
}

function marketKind(market: KalshiMarket, seriesTitle: string, now: number): ScanMarket['kind'] {
  const text = [market.title, market.subtitle, market.yes_sub_title, seriesTitle].join(' ').toLowerCase();
  if (/champion|to win (the )?(title|cup|league|finals)|season winner|stanley cup|super bowl|world series|drivers championship/.test(text)) {
    return 'championship';
  }
  const timestamp = market.occurrence_datetime ?? market.close_time;
  const scheduled = timestamp ? Date.parse(timestamp) : NaN;
  if (Number.isFinite(scheduled) && scheduled >= now && scheduled <= now + 24 * 3600 * 1000) {
    return 'game';
  }
  return 'other';
}

async function kalshiJson<T>(path: string): Promise<T> {
  const response = await fetch(KALSHI + path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Kalshi responded ${response.status}`);
  return response.json() as Promise<T>;
}

export async function scanMarkets() {
  const seriesReply = await kalshiJson<SeriesReply>('/series?category=Sports&include_volume=true');
  const candidates = (seriesReply.series ?? [])
    .filter((series) => typeof series.ticker === 'string' && leagueOf(series))
    .sort((a, b) => (numberOrNull(b.volume_fp) ?? 0) - (numberOrNull(a.volume_fp) ?? 0));

  const selected: Array<{ series: KalshiSeries; sport: string }> = [];
  const picked = new Map<string, number>();
  for (const series of candidates) {
    const sport = leagueOf(series);
    if (!sport || (picked.get(sport) ?? 0) >= MAX_SERIES_PER_SPORT) continue;
    selected.push({ series, sport });
    picked.set(sport, (picked.get(sport) ?? 0) + 1);
    if (selected.length === MAX_SERIES_TOTAL) break;
  }

  const results = await Promise.allSettled(selected.map(async ({ series, sport }) => {
    const query = '/markets?status=open&limit=1000&series_ticker=' + encodeURIComponent(series.ticker);
    const result = await kalshiJson<MarketsReply>(query);
    return { result, series, sport };
  }));

  const now = Date.now();
  const markets: ScanMarket[] = [];
  let incompletePages = false;
  let failedSeries = 0;
  let scannedMarkets = 0;

  for (const result of results) {
    if (result.status === 'rejected') {
      failedSeries++;
      continue;
    }
    const { result: payload, series, sport } = result.value;
    if (payload.cursor) incompletePages = true;
    for (const market of payload.markets ?? []) {
      if (market.status && !['open', 'active'].includes(market.status)) continue;
      scannedMarkets++;
      const lastPrice = numberOrNull(market.last_price_dollars);
      const previousPrice = numberOrNull(market.previous_price_dollars);
      markets.push({
        ticker: market.ticker,
        eventTicker: market.event_ticker,
        title: market.title || market.yes_sub_title || market.ticker,
        eventTitle: series.title || market.event_ticker,
        sport,
        seriesTitle: series.title || series.ticker,
        kind: marketKind(market, series.title ?? '', now),
        yesBid: numberOrNull(market.yes_bid_dollars),
        yesAsk: numberOrNull(market.yes_ask_dollars),
        noAsk: numberOrNull(market.no_ask_dollars),
        lastPrice,
        previousPrice,
        priceChange: lastPrice === null || previousPrice === null ? null : lastPrice - previousPrice,
        volume24h: numberOrNull(market.volume_24h_fp) ?? 0,
        openInterest: numberOrNull(market.open_interest_fp) ?? 0,
        closeTime: market.close_time || null
      });
    }
  }

  if (selected.length > 0 && failedSeries === selected.length) {
    throw new Error('All selected sports series requests failed');
  }

  markets.sort((a, b) => b.volume24h - a.volume24h);
  const visibleMarkets = markets.slice(0, MAX_RESULTS);

  return {
    source: 'Kalshi public API' as const,
    scannedAt: new Date().toISOString(),
    markets: visibleMarkets,
    counts: {
      availableSportsSeries: candidates.length,
      scannedSeries: selected.length - failedSeries,
      scannedMarkets,
      returnedMarkets: visibleMarkets.length,
      partialCoverage: candidates.length > selected.length || incompletePages || failedSeries > 0 || markets.length > MAX_RESULTS
    },
    notes: [
      'Market prices and volume are sourced from Kalshi public data.',
      'Price movement uses Kalshi previous_price_dollars, not a fixed 30-minute interval.',
      'Series coverage is sampled. No independent probabilities have been calculated.'
    ]
  };
}

export async function handleMarkets(request: Request, db?: RadarDatabase): Promise<Response> {
  const requestUrl = new URL(request.url);
  const fresh = requestUrl.searchParams.get('fresh') === '1';
  const cacheKey = new Request(new URL('/api/markets', requestUrl.origin).toString());
  const cache = (caches as CacheStorage & { default: Cache }).default;

  if (!fresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    let result: Awaited<ReturnType<typeof scanMarkets>> | null = null;
    if (db && !fresh) {
      try {
        result = await latestSnapshot(db);
      } catch (error) {
        // A missing migration or transient D1 fault must not take the public feed down.
        console.error('D1 latest snapshot unavailable; using live feed', error);
      }
    }
    result ??= await scanMarkets();
    const response = Response.json(result, {
      headers: {
        'Cache-Control': `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
        'X-Content-Type-Options': 'nosniff'
      }
    });
    try { await cache.put(cacheKey, response.clone()); } catch { /* The live result is still usable. */ }
    return response;
  } catch (error) {
    return Response.json(
      { error: 'Market feed temporarily unavailable', detail: error instanceof Error ? error.message : 'Unknown upstream error' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
