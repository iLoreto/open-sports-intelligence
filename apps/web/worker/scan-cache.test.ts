import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedScan, SNAPSHOT_TTL_MS, type ScanSnapshot, type ScanDatabase } from './scan-cache.ts';

function fakeDb(onClaim?: () => Promise<void>) {
  let row: Record<string, any> | null = null;
  const db: ScanDatabase = { prepare(sql) {
    const values: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) { values.push(...args); return stmt; },
      async first() { return row ? { ...row } : null; },
      async run() {
        if (sql.startsWith('INSERT')) {
          if (onClaim) await onClaim();
          if (row && ((row.lease_until != null && row.lease_until > Number(values[3])) ||
            (row.expires_at != null && row.expires_at > Number(values[4])))) return { meta: { changes: 0 } };
          row = { ...row, lease_token: values[1], lease_until: values[2] };
          return { meta: { changes: 1 } };
        }
        if (!row || row.lease_token !== values[sql.includes('SET snapshot') ? 4 : values.length - 1]) return { meta: { changes: 0 } };
        if (sql.includes('SET snapshot')) {
          if (row.lease_until <= Number(values[5])) return { meta: { changes: 0 } };
          Object.assign(row, { snapshot: values[0], captured_at: values[1], expires_at: values[2], lease_token: null, lease_until: null });
        } else Object.assign(row, { lease_token: null, lease_until: null });
        return { meta: { changes: 1 } };
      }
    };
    return stmt;
  }};
  return db;
}
let clock = 1_800_000_000_000;
const snapshot = (): ScanSnapshot => ({
  source: 'test', provider: 'kalshi', scannedAt: new Date(clock).toISOString(),
  sportsEvents: 1, pagesScanned: 1, nestedMarkets: 2, quotedMarkets: 2,
  fetchedMarkets: 2, partialCoverage: false, note: 'test',
  markets: [55, 68].map((askCents, i) => ({ ticker: String(i), event: 'game', title: 'test',
    side: 'YES' as const, askCents, yesBid: null, yesAsk: null, noAsk: null, last: null, volume24h: null }))
});
test('shared snapshot filters distinct ranges and expires after 60 seconds', async () => {
  const db = fakeDb(); let calls = 0;
  const fetcher = async () => { calls++; return snapshot(); };
  const a = await sharedScan(db, 55, 65, fetcher, { now: () => clock });
  const b = await sharedScan(db, 60, 70, fetcher, { now: () => clock });
  assert.equal(a.cache.status, 'miss'); assert.equal(b.cache.status, 'hit');
  assert.deepEqual(a.markets.map(m => m.askCents), [55]);
  assert.deepEqual(b.markets.map(m => m.askCents), [68]);
  assert.equal(calls, 1);
  clock += SNAPSHOT_TTL_MS + 1;
  const c = await sharedScan(db, 55, 70, fetcher, { now: () => clock });
  assert.equal(c.cache.status, 'miss'); assert.equal(calls, 2);
});
test('simultaneous callers share one upstream fetch', async () => {
  const db = fakeDb(); let calls = 0; let finish!: (s: ScanSnapshot) => void;
  const fetcher = () => { calls++; return new Promise<ScanSnapshot>(resolve => { finish = resolve; }); };
  const first = sharedScan(db, 1, 99, fetcher, { now: () => clock });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const second = sharedScan(db, 55, 65, fetcher, { now: () => clock, wait: async () => { await first; }, maxWaits: 2 });
  await Promise.resolve(); await Promise.resolve();
  finish(snapshot());
  const [a,b] = await Promise.all([first,second]);
  assert.equal(calls, 1); assert.equal(a.cache.status, 'miss'); assert.equal(b.cache.status, 'hit');
});
test('failed upstream fetch releases lease and permits retry', async () => {
  const db = fakeDb();
  await assert.rejects(sharedScan(db, 1, 99, async () => { throw Error('upstream'); }, { now: () => clock }), /upstream/);
  const result = await sharedScan(db, 1, 99, async () => snapshot(), { now: () => clock });
  assert.equal(result.cache.status, 'miss');
});
test('in-flight scan does not trigger duplicate fetch while lease held', async () => {
  const db = fakeDb(); let finish!: (s: ScanSnapshot) => void;
  const first = sharedScan(db, 1, 99, () => new Promise(resolve => { finish = resolve; }), { now: () => clock });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  let duplicate = 0;
  await assert.rejects(sharedScan(db, 1, 99, async () => { duplicate++; return snapshot(); },
    { now: () => clock, wait: async () => {}, maxWaits: 2 }), /still running/);
  assert.equal(duplicate, 0);
  finish(snapshot()); await first;
});

test('R2: a late claimant reuses a snapshot committed after its initial read', async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let paused = false;
  const db = fakeDb(async () => {
    if (!paused) { paused = true; entered(); await gate; }
  });
  let calls = 0;
  const fetcher = async () => { calls++; return snapshot(); };
  const late = sharedScan(db, 60, 70, fetcher, { now: () => clock, wait: async () => {}, maxWaits: 2 });
  await started;
  const winner = await sharedScan(db, 55, 65, fetcher, { now: () => clock });
  release();
  const reused = await late;
  assert.equal(winner.cache.status, 'miss');
  assert.equal(reused.cache.status, 'hit');
  assert.equal(calls, 1);
});
test('R2: scan-wide deadline signal is passed to upstream producer', async () => {
  const db = fakeDb();
  let received: AbortSignal | undefined;
  await sharedScan(db, 1, 99, async signal => {
    received = signal;
    assert.equal(signal.aborted, false);
    return snapshot();
  }, { now: () => clock });
  assert.ok(received);
});
test('R2: expired lease cannot commit a late snapshot', async () => {
  const db = fakeDb();
  await assert.rejects(sharedScan(db, 1, 99, async () => {
    clock += 120_001;
    return snapshot();
  }, { now: () => clock }), /lease expired/);
  const retry = await sharedScan(db, 1, 99, async () => snapshot(), { now: () => clock });
  assert.equal(retry.cache.status, 'miss');
});
