import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSportsPage, handleSportsCatalog, advanceSportsCatalog } from './catalog.ts';

const event = (category, markets, title = 'Basketball championship') => ({
  category, title, series_ticker: 'KXNBACHAMP', event_ticker: 'SPORTS-2027', markets
});
const contract = (id, ask) => ({
  ticker: `SPORTS-2027-${id}`, event_ticker: 'SPORTS-2027', title: `Winner ${id}`,
  status: 'open', yes_ask_dollars: ask, yes_bid_dollars: '0.0100',
  volume_24h_fp: '3.00'
});

test('includes Sports contracts at every price and never applies a league or top-180 cutoff', () => {
  const contracts = Array.from({ length: 220 }, (_, id) => contract(id, id % 2 ? '0.9800' : '0.0200'));
  const normalized = normalizeSportsPage({ events: [
    event('Sports', contracts),
    event('Politics', [contract('politics', '0.6000')]),
    event('Sports', [{ ...contract('closed', '0.5000'), status: 'closed' }]),
    { ...event('Sports', [contract('cricket', '0.1700')], 'Cricket league winner'), series_ticker: 'KXCRICKET' }
  ] });
  assert.equal(normalized.markets.length, 221);
  assert.equal(normalized.sportsEvents, 3);
  assert.equal(normalized.markets[0].yesAsk, 0.02);
  assert.equal(normalized.markets[1].yesAsk, 0.98);
  assert.equal(normalized.markets.at(-1).sport, 'OTHER SPORTS');
  assert.ok(normalized.markets.every((market) => market.ticker !== 'SPORTS-2027-politics'));
});

test('live catalog paginates via Kalshi cursor rather than truncating at the first page', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url);
    requested.push(path);
    return Response.json({ events: [event('Sports', [contract('1', '0.0100')])],
      cursor: path.searchParams.get('cursor') ? '' : 'next-page-opaque' });
  };
  try {
    const first = await handleSportsCatalog(new Request('https://example.test/api/catalog'));
    const firstPage = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstPage.mode, 'live');
    assert.equal(firstPage.complete, false);
    assert.equal(firstPage.nextCursor, 'live:next-page-opaque');
    assert.equal(firstPage.markets[0].yesAsk, 0.01);
    const next = await handleSportsCatalog(new Request(`https://example.test/api/catalog?cursor=${encodeURIComponent(firstPage.nextCursor)}`));
    assert.equal((await next.json()).complete, true);
    assert.equal(requested[1].searchParams.get('cursor'), 'next-page-opaque');
    assert.equal(requested[0].searchParams.get('limit'), '200');
    assert.equal(requested[0].searchParams.get('with_nested_markets'), 'true');
  } finally { globalThis.fetch = originalFetch; }
});

function fakeDatabase() {
  const state = { runs: [], pages: [], batches: 0 };
  const prepare = (sql) => {
    const query = sql.replace(/\s+/g, ' ').trim();
    const statement = {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (query.startsWith('SELECT * FROM sports_catalog_runs WHERE status')) {
          const status = query.includes("status='complete'") ? 'complete' : 'building';
          return state.runs.find((row) => row.status === status) ?? null;
        }
        if (query.startsWith('SELECT * FROM sports_catalog_runs WHERE id')) return state.runs.find((row) => row.id === this.args[0]) ?? null;
        throw new Error(`Unsupported test SQL: ${query}`);
      },
      async all() {
        if (query.startsWith('SELECT page_index')) {
          const [runId, page, , chunk, limit] = this.args;
          const rows = state.pages.filter((row) => row.run_id === runId && (row.page_index > page || (row.page_index === page && row.chunk_index > chunk)));
          return { results: rows.slice(0, limit) };
        }
        if (query.startsWith('SELECT id FROM sports_catalog_runs')) return { results: [] };
        throw new Error(`Unsupported test SQL: ${query}`);
      },
      async run() {
        if (query.startsWith('INSERT INTO sports_catalog_runs')) {
          const [id, startedAt, updatedAt] = this.args;
          state.runs.push({ id, status: 'building', cursor: '', started_at: startedAt, updated_at: updatedAt,
            pages_scanned: 0, sports_events: 0, markets_found: 0, retry_after: null, last_error: null });
        } else if (query.startsWith('INSERT INTO sports_catalog_pages')) {
          const [run_id, page_index, chunk_index, fetched_at, payload] = this.args;
          state.pages.push({ run_id, page_index, chunk_index, fetched_at, payload });
        } else if (query.startsWith('UPDATE sports_catalog_runs SET cursor')) {
          const [cursor, sportsEvents, marketCount, updatedAt, completedAt, status, id] = this.args;
          const run = state.runs.find((row) => row.id === id);
          Object.assign(run, { cursor, updated_at: updatedAt, completed_at: completedAt, status,
            pages_scanned: run.pages_scanned + 1, sports_events: run.sports_events + sportsEvents,
            markets_found: run.markets_found + marketCount });
        } else if (query.startsWith('UPDATE sports_catalog_runs SET last_error')) {
          const [lastError, retryAfter, id] = this.args;
          Object.assign(state.runs.find((row) => row.id === id), { last_error: lastError, retry_after: retryAfter });
        } else if (!query.startsWith('DELETE FROM sports_catalog_')) {
          throw new Error(`Unsupported test SQL: ${query}`);
        }
      }
    };
    return statement;
  };
  return { state, prepare, async batch(statements) { state.batches++; for (const stmt of statements) await stmt.run(); } };
}

test('scheduled catalog persists all 220 contracts in bounded chunks and resumes provider cursor', async () => {
  const originalFetch = globalThis.fetch;
  const db = fakeDatabase();
  const cursors = [];
  globalThis.fetch = async (url) => {
    const cursor = new URL(url).searchParams.get('cursor') ?? '';
    cursors.push(cursor);
    return Response.json({ events: [event('Sports', cursor ? [contract('finish', '0.9900')] :
      Array.from({ length: 220 }, (_, id) => contract(id, '0.0300')))], cursor: cursor ? '' : 'resume-here' });
  };
  try {
    await advanceSportsCatalog(db);
    assert.equal(db.state.runs[0].markets_found, 220);
    assert.equal(db.state.pages.length, 3);
    assert.ok(db.state.pages.every((row) => JSON.parse(row.payload).length <= 80));
    const page = await (await handleSportsCatalog(new Request('https://example.test/api/catalog'), db)).json();
    assert.equal(page.mode, 'indexed');
    assert.equal(page.markets.length, 160);
    assert.ok(page.nextCursor?.startsWith('db:sports-'));
    const secondPage = await (await handleSportsCatalog(new Request(`https://example.test/api/catalog?cursor=${encodeURIComponent(page.nextCursor)}`), db)).json();
    assert.equal(secondPage.markets.length, 60);
    await advanceSportsCatalog(db);
    assert.deepEqual(cursors, ['', 'resume-here']);
    assert.equal(db.state.runs[0].status, 'complete');
    assert.equal(db.state.runs[0].markets_found, 221);
    assert.equal(db.state.batches, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects invalid and expired indexed pagination cursors', async () => {
  const invalid = await handleSportsCatalog(new Request('https://example.test/api/catalog?cursor=bad!'));
  assert.equal(invalid.status, 400);
  const expired = await handleSportsCatalog(new Request('https://example.test/api/catalog?cursor=db:sports-2026-11-01T00:00:00.000Z:2:1'), fakeDatabase());
  assert.equal(expired.status, 410);
});
