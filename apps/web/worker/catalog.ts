/**
 * Resumable, read-only inventory of all standard open Kalshi Sports events.
 * Scans every provider cursor across cron invocations, not just a few series.
 * A bounded D1 page store avoids 2 MB rows and per-market write explosions.
 * Multivariate combo events are a separate Kalshi API and are not covered here.
 */

import { leagueOf, normalizeMarket, type KalshiMarket, type ScanMarket } from './markets.ts';
import type { RadarDatabase } from './persistence.ts';

const EVENTS_URL = 'https://external-api.kalshi.com/trade-api/v2/events';
const EVENT_PAGE_SIZE = 200;
const CHUNK_SIZE = 80;
const CHUNKS_PER_RESPONSE = 2;
const MAX_CURSOR_LENGTH = 1400;

interface KalshiEvent {
  event_ticker?: string;
  series_ticker?: string;
  title?: string;
  category?: string;
  markets?: KalshiMarket[];
}
interface EventsPage { events?: KalshiEvent[]; cursor?: string }
interface CatalogRun {
  id: string;
  status: 'building' | 'complete';
  cursor: string;
  pages_scanned: number;
  sports_events: number;
  markets_found: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  retry_after: string | null;
  last_error: string | null;
}
interface CatalogPage {
  page_index: number;
  chunk_index: number;
  payload: string;
  fetched_at: string;
}

export interface CatalogResponse {
  source: 'Kalshi public Sports events';
  mode: 'indexed' | 'live';
  scanId: string | null;
  updatedAt: string;
  complete: boolean;
  scanning: boolean;
  scannedPages: number;
  scannedSportsEvents: number;
  indexedMarkets: number;
  markets: ScanMarket[];
  nextCursor: string | null;
  warnings: string[];
}

class KalshiCatalogError extends Error {
  status: number;
  retryAfter: string | null;
  constructor(status: number, retryAfter: string | null) {
    super(`Kalshi catalog responded HTTP ${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function fetchEvents(cursor = ''): Promise<EventsPage> {
  const url = new URL(EVENTS_URL);
  url.searchParams.set('status', 'open');
  url.searchParams.set('limit', String(EVENT_PAGE_SIZE));
  url.searchParams.set('with_nested_markets', 'true');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(13000)
  });
  if (!response.ok) throw new KalshiCatalogError(response.status, response.headers.get('Retry-After'));
  const page: EventsPage = await response.json();
  if (!Array.isArray(page.events) || typeof page.cursor !== 'string') {
    throw new Error('Unexpected Kalshi catalog payload');
  }
  return page;
}

/** Filters by the actual event category; no sports whitelist or price band. */
export function normalizeSportsPage(page: EventsPage, now = Date.now()): {
  markets: ScanMarket[]; sportsEvents: number;
} {
  const markets: ScanMarket[] = [];
  let sportsEvents = 0;
  for (const event of page.events ?? []) {
    if (event.category?.toLowerCase() !== 'sports') continue;
    sportsEvents++;
    const seriesTitle = event.title || event.series_ticker || 'Sports event';
    const sport = leagueOf({ ticker: event.series_ticker ?? '', title: seriesTitle }) || 'OTHER SPORTS';
    for (const market of event.markets ?? []) {
      if (!market.ticker || !market.event_ticker || (market.status && !['open', 'active'].includes(market.status))) continue;
      markets.push(normalizeMarket(market, {
        sport, seriesTitle, eventTitle: event.title || market.event_ticker
      }, now));
    }
  }
  return { markets, sportsEvents };
}

function nextRetry(error: unknown): string {
  const seconds = error instanceof KalshiCatalogError && error.status === 429
    ? Math.min(3600, Math.max(60, Number(error.retryAfter) || 300)) : 300;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Process exactly one provider page per cron invocation on the Workers Free tier.
 * Chunk inserts and cursor advancement share a D1 transaction: no silent gaps.
 */
export async function advanceSportsCatalog(db: RadarDatabase): Promise<void> {
  const now = new Date().toISOString();
  let run = await db.prepare(`SELECT * FROM sports_catalog_runs WHERE status = 'building'
    ORDER BY started_at DESC LIMIT 1`).first<CatalogRun>();
  if (!run) {
    const id = `sports-${now}`;
    await db.prepare(`INSERT INTO sports_catalog_runs
      (id, status, cursor, started_at, updated_at) VALUES (?, 'building', '', ?, ?)`)
      .bind(id, now, now).run();
    run = {
      id, status: 'building', cursor: '', pages_scanned: 0, sports_events: 0,
      markets_found: 0, started_at: now, updated_at: now, completed_at: null,
      retry_after: null, last_error: null
    };
  }
  if (run.retry_after && Date.parse(run.retry_after) > Date.now()) return;

  try {
    const page = await fetchEvents(run.cursor);
    const normalized = normalizeSportsPage(page);
    const statements = [];
    for (let i = 0; i < normalized.markets.length; i += CHUNK_SIZE) {
      const chunk = normalized.markets.slice(i, i + CHUNK_SIZE);
      statements.push(db.prepare(`INSERT INTO sports_catalog_pages
        (run_id, page_index, chunk_index, fetched_at, payload) VALUES (?, ?, ?, ?, ?)`)
        .bind(run.id, run.pages_scanned, i / CHUNK_SIZE, now, JSON.stringify(chunk)));
    }
    const completed = !page.cursor;
    const pageNumber = run.pages_scanned + 1;
    statements.push(db.prepare(`UPDATE sports_catalog_runs SET
      cursor = ?, pages_scanned = pages_scanned + 1,
      sports_events = sports_events + ?, markets_found = markets_found + ?,
      updated_at = ?, completed_at = ?, status = ?, retry_after = NULL, last_error = NULL
      WHERE id = ? AND status = 'building' AND cursor = ?`)
      .bind(page.cursor ?? '', normalized.sportsEvents, normalized.markets.length,
        now, completed ? now : null, completed ? 'complete' : 'building', run.id, run.cursor));
    await db.batch(statements);
    console.log(`Sports book scan ${run.id}: page ${pageNumber}, ${normalized.markets.length} contracts, finished=${completed}`);
    if (completed) {
      // Old completed traversals are dispensable; retain newest two snapshots.
      const old = await db.prepare(`SELECT id FROM sports_catalog_runs
        WHERE status = 'complete' ORDER BY completed_at DESC LIMIT 20 OFFSET 2`).all<{ id: string }>();
      for (const row of old.results) {
        await db.prepare('DELETE FROM sports_catalog_pages WHERE run_id = ?').bind(row.id).run();
        await db.prepare('DELETE FROM sports_catalog_runs WHERE id = ?').bind(row.id).run();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 180) : 'Unknown upstream error';
    console.warn(`Sports book catalog paused at page ${run.pages_scanned}: ${message}`);
    await db.prepare('UPDATE sports_catalog_runs SET last_error = ?, retry_after = ? WHERE id = ?')
      .bind(message, nextRetry(error), run.id).run();
  }
}

function parseCursor(cursor: string): { mode: 'indexed' | 'live'; runId: string | null; page: number; chunk: number; upstream: string } {
  if (!cursor) return { mode: 'indexed', runId: null, page: -1, chunk: -1, upstream: '' };
  if (cursor.startsWith('live:') && cursor.length <= MAX_CURSOR_LENGTH) {
    return { mode: 'live', runId: null, page: -1, chunk: -1, upstream: cursor.slice(5) };
  }
  const match = /^db:(sports-[A-Za-z0-9:.\-]{10,50}):(\d{1,7}):(\d{1,4})$/.exec(cursor);
  if (!match) throw new Error('Invalid catalog cursor');
  return { mode: 'indexed', runId: match[1], page: Number(match[2]), chunk: Number(match[3]), upstream: '' };
}

async function indexedCatalog(db: RadarDatabase, cursor: ReturnType<typeof parseCursor>, sport: string | null): Promise<CatalogResponse | null> {
  const [completed, building] = await Promise.all([
    db.prepare(`SELECT * FROM sports_catalog_runs WHERE status='complete'
      ORDER BY completed_at DESC LIMIT 1`).first<CatalogRun>(),
    db.prepare(`SELECT * FROM sports_catalog_runs WHERE status='building'
      ORDER BY started_at DESC LIMIT 1`).first<CatalogRun>()
  ]);
  // A pagination cursor pins its original scan even while a newer scan builds.
  const run = cursor.runId
    ? await db.prepare('SELECT * FROM sports_catalog_runs WHERE id = ?').bind(cursor.runId).first<CatalogRun>()
    : completed || building;
  if (!run) return null;
  const { results } = await db.prepare(`SELECT page_index, chunk_index, fetched_at, payload
    FROM sports_catalog_pages WHERE run_id = ? AND
    (page_index > ? OR (page_index = ? AND chunk_index > ?))
    ${sport ? 'AND instr(payload, ?) > 0' : ''}
    ORDER BY page_index ASC, chunk_index ASC LIMIT ?`)
    .bind(run.id, cursor.page, cursor.page, cursor.chunk,
      ...(sport ? [`"sport":"${sport}"`] : []), CHUNKS_PER_RESPONSE + 1)
    .all<CatalogPage>();
  const visible = results.slice(0, CHUNKS_PER_RESPONSE);
  const last = visible.at(-1);
  return {
    source: 'Kalshi public Sports events', mode: 'indexed', scanId: run.id,
    updatedAt: run.updated_at, complete: run.status === 'complete', scanning: !!building,
    scannedPages: run.pages_scanned, scannedSportsEvents: run.sports_events,
    indexedMarkets: run.markets_found,
    markets: visible.flatMap((row) => (JSON.parse(row.payload) as ScanMarket[])
      .filter((market) => !sport || market.sport === sport)),
    nextCursor: results.length > CHUNKS_PER_RESPONSE && last
      ? `db:${run.id}:${last.page_index}:${last.chunk_index}` : null,
    warnings: [
      ...(!completed ? ['First full-book traversal is still building. More contracts appear as the cursor advances.'] : []),
      ...(sport && !visible.length && run.status === 'building' ? [`No ${sport} contracts have been indexed yet. Try refreshing as the scan advances.`] : []),
      ...(run.last_error ? [`Latest traversal paused: ${run.last_error}`] : []),
      'Sports category excludes Kalshi multivariate combo events; those require a separate endpoint.'
    ]
  };
}

async function liveCatalog(cursor: string, sport: string | null): Promise<CatalogResponse> {
  const page = await fetchEvents(cursor);
  const normalized = normalizeSportsPage(page);
  return {
    source: 'Kalshi public Sports events', mode: 'live', scanId: null,
    updatedAt: new Date().toISOString(), complete: !page.cursor, scanning: false,
    scannedPages: 1, scannedSportsEvents: normalized.sportsEvents,
    indexedMarkets: normalized.markets.length,
    markets: normalized.markets.filter((market) => !sport || market.sport === sport),
    nextCursor: page.cursor ? `live:${page.cursor}` : null,
    warnings: [
      'Live pagination is not a completed full-book snapshot. Continue loading to traverse the public event catalog.',
      ...(sport ? [`The ${sport} filter applies to each provider page. Continue loading to search later pages.`] : []),
      'Multivariate combo events are excluded from this standard-events feed.'
    ]
  };
}

export async function handleSportsCatalog(request: Request, db?: RadarDatabase): Promise<Response> {
  const url = new URL(request.url);
  const rawSport = (url.searchParams.get('sport') ?? '').trim().toUpperCase();
  if (rawSport && rawSport !== 'ALL' && !/^[A-Z0-9 /-]{1,32}$/.test(rawSport)) {
    return Response.json({ error: 'Invalid sport filter' }, { status: 400 });
  }
  const sport = rawSport && rawSport !== 'ALL' ? rawSport : null;
  const rawCursor = url.searchParams.get('cursor') ?? '';
  let cursor: ReturnType<typeof parseCursor>;
  try { cursor = parseCursor(rawCursor); }
  catch { return Response.json({ error: 'Invalid catalog cursor' }, { status: 400 }); }
  const live = cursor.mode === 'live' || url.searchParams.get('fresh') === '1';
  try {
    if (db && !live) {
      try {
        const indexed = await indexedCatalog(db, cursor, sport);
        if (indexed) return Response.json(indexed, { headers: { 'Cache-Control': 'no-store' } });
        if (cursor.runId) return Response.json({ error: 'This catalog traversal has expired. Restart browsing from the first page.' }, { status: 410 });
      } catch (error) {
        if (cursor.runId) return Response.json({ error: 'Catalog page temporarily unavailable. Please retry.' }, { status: 503 });
        console.warn('Full-book D1 index unavailable; returning live page', error);
      }
    }
    if (cursor.runId) return Response.json({ error: 'Indexed catalog is unavailable. Restart browsing from the first page.' }, { status: 410 });
    return Response.json(await liveCatalog(cursor.upstream, sport), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof KalshiCatalogError && error.status === 429 ? 503 : 502;
    return Response.json({ error: 'Sports catalog temporarily unavailable', detail: error instanceof Error ? error.message : 'Unknown upstream failure' },
      { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
