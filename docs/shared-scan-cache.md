# Shared scan cache (Cloudflare D1)

The first manual scan after a cache miss fetches a league snapshot. The Worker stores quotes before filtering by ask price, so users scanning the same league can use any range without calling Kalshi again while the snapshot is fresh. An atomic D1 lease prevents concurrent refreshes for that league.

## Cloudflare setup

The Worker binds the existing `open-sports-radar` database as `DB` in `apps/web/wrangler.jsonc`. Before deploying, initialize the `scan_cache` table using the idempotent migration. Run this from `apps/web`.

```bash
npx wrangler d1 execute DB --remote --file migrations/0001_scan_cache.sql
```

To verify an expired or empty cache, run two manual scans for the same league with different price ranges. The first should report `cache.status: "miss"`. The second should report `"hit"`, with the same `scannedAt`. Without the binding or the cache table, the Worker returns a direct scan and reports `cache.status: "unavailable"`.

## Semantics
- The cache uses one key per league, such as `kalshi:sports:open:v2:nba`.
- Complete snapshots expire after ten minutes. Incomplete snapshots expire after one minute. The original `scannedAt` is returned with the cache age.
- Lease: 120 seconds; R2 review fixes add an atomic freshness predicate to the lease claim and a 90-second scan-wide abort signal passed into every Kalshi fetch. Expired lease owners cannot commit snapshots. Waiting requests poll for a completed snapshot, then receive a retryable error rather than issuing duplicate scans.
- A failed scan releases its lease. Stale data is not silently substituted.
- Existing bounded pagination and partial coverage metadata are retained; a cached partial scan remains partial.
- D1 rows may be pruned periodically; one current row is used per scan scope.
- API redistribution rights and Cloudflare D1 write/storage limits must be reviewed before public launch.

## Tests
`cd apps/web && npm run test:cache` runs Node's native TypeScript-stripping tests for cache hits, overlapping ranges, TTL expiry, simultaneous requests, lease contention, and failure recovery.

## Queued next provider: Novig (not yet connected)

**P1 follow-up, intentionally not activated in this PR.** The current `/api/markets/scan?provider=novig` response remains `501` until a permitted, reliable market-data integration is available. Do not represent placeholder quotes as live Novig prices.

- [ ] Confirm supported Novig quote source, credentials/permissions, redistribution rights and rate limits.
- [ ] Implement a separate Novig adapter returning normalized event IDs, market IDs, side, executable bid/ask, liquidity, captured-at timestamp and settlement rules. Do not assume Novig markets are interchangeable with Kalshi markets.
- [ ] Use independent D1 cache key `novig:sports:open:v1` (plus additional scan-scope dimensions if required). **Never** return a Kalshi snapshot for a Novig request.
- [ ] Apply the same 60-second snapshot TTL and atomic lease deduplication, independently per provider.
- [ ] Add provider-specific cache-hit, overlapping-range, concurrent-request, expiry, API failure, stale quote and incomplete coverage tests.
- [ ] Add UI provider switch and display quote source, capture time, cache age and explicit unavailable state.
- [ ] Run preview smoke tests against authorized Novig data before enabling production requests.

A cross-provider comparison must explicitly reconcile event identity, outcome and settlement terms; matching titles alone are insufficient.

## Review convention

R2 is the designated reviewer name in project documentation, PR descriptions, and review follow-ups. Request R2 review after CI and deployment verification; track R2 findings and resolutions in the PR conversation.
