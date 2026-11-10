# Shared scan cache (Cloudflare D1)

The Worker caches a provider-wide Kalshi sports snapshot for **60 seconds** and filters the returned quotes per request. Different users and price ranges reuse the same snapshot. An atomic D1 upsert lease prevents simultaneous Workers from performing duplicate upstream scans.

## Provisioning (required for shared caching)
1. Create a Cloudflare D1 database in the dashboard, e.g. `sports-radar-cache`.
2. Apply `apps/web/migrations/0001_scan_cache.sql` to that database (Cloudflare D1 console or Wrangler migration execution).
3. Add a D1 binding named **DB** to the `open-sports-intelligence` Worker in Cloudflare settings, in each deployment environment.
4. For Wrangler-managed deployments, add the actual database UUID to `apps/web/wrangler.jsonc` under `d1_databases` with `binding: "DB"`, `database_name` and `database_id`. Never guess the UUID.
5. Verify the Worker is using the binding and migration before enabling production caching.

If DB is not bound, the existing scan remains available but the response explicitly reports `cache.status = "unavailable"`. The D1 cache is not activated merely by merging the PR.

## Semantics
- Cache key: `kalshi:sports:open:v1`. Provider, sport and query scope must change the key if scan coverage changes.
- TTL: 60 seconds from successful write. The original `scannedAt` is preserved and returned to the client.
- Lease: 120 seconds; waiting requests poll for a completed snapshot, then receive a retryable error rather than issuing duplicate scans.
- A failed scan releases its lease. Stale data is not silently substituted.
- Existing bounded pagination and partial coverage metadata are retained; a cached partial scan remains partial.
- D1 rows may be pruned periodically; one current row is used per scan scope.
- API redistribution rights and Cloudflare D1 write/storage limits must be reviewed before public launch.

## Tests
`cd apps/web && npm run test:cache` runs Node's native TypeScript-stripping tests for cache hits, overlapping ranges, TTL expiry, simultaneous requests, lease contention, and failure recovery.
