import type { scanMarkets } from './markets';

export type RadarSnapshot = Awaited<ReturnType<typeof scanMarkets>>;

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface RadarDatabase {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

interface StoredScan { payload: string; scanned_at: string }
interface StoredPoint {
  sampled_at: string;
  yes_ask: number | null;
  yes_bid: number | null;
  last_price: number | null;
  volume_24h: number;
}

const HISTORY_DAYS = 7;
const HISTORY_HOURS = 24;
const MAX_SNAPSHOT_AGE_MS = 35 * 60 * 1000;
const MAX_TICKER_LENGTH = 160;

/** The scheduled collector is the only writer of historical samples. */
export async function persistSnapshot(db: RadarDatabase, snapshot: RadarSnapshot): Promise<void> {
  const timestamp = snapshot.scannedAt;
  const statements: Statement[] = [
    db.prepare('INSERT INTO radar_scans (scanned_at, payload) VALUES (?, ?)')
      .bind(timestamp, JSON.stringify(snapshot))
  ];

  for (const market of snapshot.markets) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO market_history
        (ticker, sampled_at, yes_ask, yes_bid, last_price, volume_24h)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(market.ticker, timestamp, market.yesAsk, market.yesBid,
      market.lastPrice, market.volume24h));
  }

  // D1 batches execute the statements transactionally, so a scan is never partial.
  await db.batch(statements);

  const cutoff = new Date(Date.parse(timestamp) - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM market_history WHERE sampled_at < ?').bind(cutoff),
    db.prepare('DELETE FROM radar_scans WHERE scanned_at < ?').bind(cutoff)
  ]);
}

export async function latestSnapshot(db: RadarDatabase): Promise<RadarSnapshot | null> {
  const row = await db.prepare('SELECT scanned_at, payload FROM radar_scans ORDER BY scanned_at DESC LIMIT 1')
    .first<StoredScan>();
  if (!row || Date.now() - Date.parse(row.scanned_at) > MAX_SNAPSHOT_AGE_MS) return null;
  return JSON.parse(row.payload) as RadarSnapshot;
}

export async function historyResponse(request: Request, db?: RadarDatabase): Promise<Response> {
  const ticker = new URL(request.url).searchParams.get('ticker')?.trim().toUpperCase() ?? '';
  if (!ticker || ticker.length > MAX_TICKER_LENGTH || !/^[A-Z0-9_-]+$/.test(ticker)) {
    return Response.json({ error: 'Invalid market ticker' }, { status: 400 });
  }

  if (!db) {
    return Response.json({ ticker, available: false, points: [], message: 'Historical collection is not configured yet.' },
      { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const cutoff = new Date(Date.now() - HISTORY_HOURS * 60 * 60 * 1000).toISOString();
    const { results } = await db.prepare(`
      SELECT sampled_at, yes_ask, yes_bid, last_price, volume_24h
      FROM market_history WHERE ticker = ? AND sampled_at >= ?
      ORDER BY sampled_at ASC LIMIT 60
    `).bind(ticker, cutoff).all<StoredPoint>();
    return Response.json({
      ticker,
      available: true,
      points: results.map((row) => ({
        sampledAt: row.sampled_at,
        yesAsk: row.yes_ask,
        yesBid: row.yes_bid,
        lastPrice: row.last_price,
        volume24h: row.volume_24h
      }))
    }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
  } catch (error) {
    console.error('D1 history lookup failed', error);
    return Response.json({ error: 'Market history temporarily unavailable' }, { status: 503 });
  }
}
