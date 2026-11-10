export const SNAPSHOT_TTL_MS = 60_000;
export const LEASE_MS = 120_000;
// R2: stop all upstream work before a lease can expire; leave room for D1 commit.
export const SCAN_DEADLINE_MS = 90_000;
export const SCAN_KEY = 'kalshi:sports:open:v1';

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface ScanDatabase { prepare(sql: string): D1Statement }
export interface CachedMarket {
  ticker: string; event: string; title: string; side: 'YES' | 'NO'; askCents: number;
  yesBid: string | null; yesAsk: string | null; noAsk: string | null;
  last: string | null; volume24h: string | null;
}
export interface ScanSnapshot {
  source: string; provider: string; scannedAt: string;
  sportsEvents: number; pagesScanned: number; nestedMarkets: number;
  quotedMarkets: number; fetchedMarkets: number; partialCoverage: boolean;
  note: string; markets: CachedMarket[];
}
interface Row { snapshot: string | null; captured_at: number | null; expires_at: number | null; lease_until: number | null }
export interface ScanOutput extends ScanSnapshot {
  min: number; max: number;
  cache: { status: 'hit' | 'miss' | 'unavailable'; ttlSeconds: number; ageSeconds: number };
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function filter(snapshot: ScanSnapshot, min: number, max: number, status: ScanOutput['cache']['status'], now: number): ScanOutput {
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(snapshot.scannedAt)) / 1000));
  return { ...snapshot, min, max, markets: snapshot.markets.filter(m => m.askCents >= min && m.askCents <= max),
    cache: { status, ttlSeconds: 60, ageSeconds } };
}
async function read(db: ScanDatabase): Promise<Row | null> {
  return db.prepare('SELECT snapshot, captured_at, expires_at, lease_until FROM scan_cache WHERE cache_key = ?').bind(SCAN_KEY).first<Row>();
}
/** A single provider snapshot serves every price range; the SQL lease serializes concurrent Workers. */
export async function sharedScan(db: ScanDatabase, min: number, max: number, fetchSnapshot: (signal: AbortSignal) => Promise<ScanSnapshot>,
  options: { now?: () => number; wait?: (ms: number) => Promise<void>; token?: string; maxWaits?: number } = {}): Promise<ScanOutput> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  const token = options.token ?? crypto.randomUUID();
  const initial = await read(db);
  if (initial?.snapshot && (initial.expires_at ?? 0) > now()) {
    return filter(JSON.parse(initial.snapshot) as ScanSnapshot, min, max, 'hit', now());
  }
  const leaseTime = now();
  const claim = await db.prepare(`INSERT INTO scan_cache (cache_key, lease_token, lease_until)
    VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET
    lease_token = excluded.lease_token, lease_until = excluded.lease_until
    WHERE (scan_cache.lease_until IS NULL OR scan_cache.lease_until <= ?)
      AND (scan_cache.expires_at IS NULL OR scan_cache.expires_at <= ?)`)
    .bind(SCAN_KEY, token, leaseTime + LEASE_MS, leaseTime, leaseTime).run();
  if (claim.meta.changes > 0) {
    try {
      const deadline = AbortSignal.timeout(SCAN_DEADLINE_MS);
      const snapshot = await fetchSnapshot(deadline);
      deadline.throwIfAborted();
      const finished = now();
      const write = await db.prepare(`UPDATE scan_cache SET snapshot = ?, captured_at = ?, expires_at = ?,
        lease_token = NULL, lease_until = NULL WHERE cache_key = ? AND lease_token = ? AND lease_until > ?`)
        .bind(JSON.stringify(snapshot), finished, finished + SNAPSHOT_TTL_MS, SCAN_KEY, token, finished).run();
      if (write.meta.changes !== 1) throw new Error('Scan lease expired before the snapshot could be saved');
      return filter(snapshot, min, max, 'miss', finished);
    } catch (error) {
      await db.prepare('UPDATE scan_cache SET lease_token = NULL, lease_until = NULL WHERE cache_key = ? AND lease_token = ?')
        .bind(SCAN_KEY, token).run().catch(() => undefined);
      throw error;
    }
  }
  // Other Workers are scanning. Wait for their committed result; never start a duplicate scan.
  for (let i = 0; i < (options.maxWaits ?? 40); i++) {
    await wait(500);
    const row = await read(db);
    if (row?.snapshot && (row.expires_at ?? 0) > now()) {
      return filter(JSON.parse(row.snapshot) as ScanSnapshot, min, max, 'hit', now());
    }
    if (!row?.lease_until || row.lease_until <= now()) break;
  }
  throw new Error('A shared scan is still running. Please retry shortly.');
}
export function uncachedScan(snapshot: ScanSnapshot, min: number, max: number): ScanOutput {
  return filter(snapshot, min, max, 'unavailable', Date.now());
}
