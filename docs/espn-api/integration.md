# Cloudflare Workers integration blueprint

## Architecture

```text
Browser -> your Worker /api/scores -> Cache API / D1 -> ESPN read-only JSON endpoint
                                           |-> optional independent provider
```

Avoid direct browser polling and unbounded requests. One cache entry should serve many viewers. Use strict input validation and an allowlist of sports, leagues and endpoint types; do not expose an arbitrary URL proxy.

## Defensive fetch example (TypeScript)

```ts
const ALLOWED = new Set(['basketball/nba', 'football/nfl', 'hockey/nhl', 'baseball/mlb']);
async function scoreboard(sportLeague: string, date: string) {
  if (!ALLOWED.has(sportLeague) || !/^\\d{8}$/.test(date)) throw new Error('Invalid request');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportLeague}/scoreboard?dates=${date}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (response.status === 429) throw new Error('ESPN rate limited; honor Retry-After');
  if (!response.ok) throw new Error(`ESPN HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).events)) throw new Error('Invalid scoreboard payload');
  return data;
}
```

## Production requirements

- **Caching:** live scores ~15–60s only if provider permits; scheduled games 5–15m; completed games hours/days. These are suggested app cache TTLs, not ESPN published requirements.
- **Rate limiting:** apply request budgets per league; no unlimited client fan-out. Respect `429` and `Retry-After`.
- **Circuit breaker:** after repeated timeouts, 429 or schema failures, pause provider calls and use another lawful source or clearly marked last-known data.
- **Backoff:** bounded retries only on transient failures; no retry storms.
- **Observability:** upstream status, latency, schema failures, source, cache hit ratio, last successful update; do not log private tokens.
- **Health checks:** use a real endpoint and verify response structure, not just HTTP 200. Run on CI and schedule; fail visibly when a provider changes.
- **Deployment gates:** test against a preview Worker before merge, then smoke-test production after deploy. Don't confuse mocked tests with live provider tests.
- **Licensing:** public URL does not imply unrestricted commercial reuse, redistribution, logo usage, or a service guarantee.

## Sports Radar integration plan

1. Extract ESPN access behind a typed provider interface; preserve provider-specific IDs.
2. Introduce canonical team identity maps with fixture tests for NBA/NFL/NHL/MLB.
3. Make ESPN usable without `BALLDONTLIE_API_KEY`; retain optional providers as adapters.
4. Add independent fallbacks, per-source health checks, and stale data metadata.
5. Test NBA Boston/Cleveland Last 5 against real upstream data and deployed Worker before merging.

**Documentation alone does not implement or validate these runtime changes.**
