# Open Sports Intelligence

A read-only sports research dashboard. **Market scanning is manual only.** The application does not automatically scan, poll for new market snapshots, or record 30-minute price history.

## Current behavior

- Select a provider and explicitly press **Scan** to request a new market snapshot. The scanner calls `POST /api/markets/scan`.
- Kalshi is the configured market-scan provider. Novig selection is visible but its public market-data adapter is not yet configured; the API returns a clear error rather than substitute quotes.
- Choose the requested ask-price range in the UI. Scans use bounded Kalshi event/market pagination; results can have partial coverage and are **not** a complete simultaneous snapshot of every market.
- The NBA comparison desk uses ESPN team schedules for completed-game research. Tennis provider coverage remains unconfigured.
- `GET /api/health` reports `backgroundScanning: false`.
- No scheduled 30-minute market history, automatic refresh, or history chart is part of the current scanner workflow. A displayed provider previous price is **not** a measured 30-minute change.
- No trading, orders, accounts, or automated betting.

## Technology

- Angular / TypeScript frontend in `apps/web`
- Cloudflare Worker serving static assets and read-only APIs
- GitHub Actions for build and smoke-test validation
- Cloudflare Git integration for **deployment** on changes to `main`. Automatic *deployment* is separate from market *scanning*; deployments remain automatic, scans do not.

## Local development

```bash
cd apps/web
npm ci
npm run build
npx wrangler dev
```

The Worker must run for `/api/*` routes. Angular's standalone development server does not replace the Worker API.

## Production configuration

Connect the GitHub repository `iLoreto/open-sports-intelligence` to Cloudflare Workers, using branch `main`, root directory `apps/web`, build command `npm run build`, and deploy command `npx wrangler deploy`. The tracked `apps/web/wrangler.jsonc` declares the Worker entrypoint and static assets. It does **not** configure a cron trigger or D1 history binding.

### Market scanner API

`POST /api/markets/scan?provider=kalshi&min=55&max=70`

This is an explicit, user-initiated operation. The provider and price band are request parameters. The server may reuse a bounded shared snapshot for efficiency; a cache is **not** a background scheduler or a historical archive. Scan freshness, coverage, and provider errors must be represented honestly. `provider=novig` is currently unsupported.

`GET /api/health` reports service health and whether background scanning is enabled.

### NBA and tennis research

The NBA comparison interface retrieves completed NBA games from ESPN's publicly accessible team-schedule feeds. It reports the sample size and partial coverage, and does not claim to have injury, lineup, or player-stat information that was not fetched. ESPN's public JSON endpoints may change. Tennis currently reports an unavailable provider rather than fabricated matches.

## Data accuracy and limitations

- Market ask prices are quotes, not independently verified win probabilities.
- Pagination and rate limits can prevent full market coverage. Do not describe a bounded scan as the entire book.
- No 30-minute polling, scheduled sample collection, retained 30-minute quote series, or historical-price backfill is promised.
- A cache or a provider's previous-price field does not constitute time-series history.
- All research is informational. There are no account or order-placement endpoints.

## Collaboration and pull requests

Several developers contribute to this repository. **Always start from the latest remote `main`**, not an old working copy or a previous PR branch. Use a dedicated branch and focused PR; do not push documentation changes directly to `main`. Before requesting merge, compare against the current base, resolve conflicts, run the applicable build/tests, and confirm that no other developer's changes were overwritten. GitHub Actions and Cloudflare preview/production checks should be reviewed separately. Never claim a production smoke test passed unless it was actually run against the deployed endpoint.

See [architecture](docs/architecture.md) for the current request flow and [UFC planning](docs/ufc-radar-plan.md) for future, unimplemented capabilities.

## Roadmap

Improve market-source coverage and error reporting, verified sport-specific research, tests for live provider contracts, and PR preview validation. Historical tracking or automatic scans are **not active features**; any reintroduction requires a separate design, explicit approval, tests, and updated documentation.

## License

A license will be selected before inviting external contributions.

## Sources

- [Kalshi market data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [ESPN NBA scoreboard](https://www.espn.com/nba/scoreboard)
- [Cloudflare Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/)
