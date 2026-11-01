# Open Sports Intelligence

An open-source, read-only sports market intelligence dashboard.

**Status:** MVP with phase-one radar features. The dashboard displays public Kalshi sports market prices, previous-price movement, and 24-hour volume. The 55–65¢ watch band filters observed YES asks; **it does not produce independent win probabilities or claim a betting edge.** A D1-backed historical chart becomes available after the scheduled collector is configured.

## Stack

- Angular 22 / TypeScript (static dashboard)
- Cloudflare Workers with Static Assets (Angular frontend and API in one deployment)
- Cloudflare Workers Git integration (automatic deployments from GitHub)
- Cloudflare edge cache (30-minute response TTL)
- Cloudflare Cron Trigger (every 30 minutes, UTC) and optional D1 historical price snapshots
- GitHub Actions (build validation)
- Future: Cloudflare D1 snapshots, scheduled ingestion, Python-based calibrated models

## Run

```bash
cd apps/web
npm ci
npm run build
npx wrangler dev
```

Open the URL printed by Wrangler. `ng serve` alone does not serve the `/api/markets` Worker route.

## Cloudflare Workers setup

1. Workers & Pages → Create application → Connect to GitHub.
2. Select `iLoreto/open-sports-intelligence` and the `main` branch.
3. Set **Root directory** to `apps/web`.
4. Set **Build command** to `npm run build`.
5. Set **Deploy command** to `npx wrangler deploy`.
6. Leave the preview command empty initially.
7. Use Node 24 in the build environment (for example `NODE_VERSION=24.15.0`).
8. Deploy after the source is committed. Subsequent pushes to `main` trigger Cloudflare builds.

The tracked `apps/web/wrangler.jsonc` declares the Worker entrypoint, Angular build directory, and static-asset binding. Requests to `/api/markets` and `/api/health` are served by the Worker; other routes serve the static Angular app.

### Enable persistent price history (one-time infrastructure setup)

The new dashboard and live market feed **work without D1**. Until D1 is connected, `/api/history?ticker=...` explicitly returns `available: false` with no fabricated price history.

1. Create the D1 database `open-sports-radar` in Cloudflare (already provisioned for this deployment).
2. Verify the database binding in `apps/web/wrangler.jsonc`:

   ```jsonc
   "d1_databases": [
     { "binding": "RADAR_DB", "database_name": "open-sports-radar", "database_id": "867ffc71-bf0b-4259-a0ca-19fb55b0872f" }
   ]
   ```

3. Apply the bundled schema: `npx wrangler d1 migrations apply open-sports-radar --remote` (from `apps/web`).
4. Redeploy from GitHub. `triggers.crons` already schedules ingestion at `*/30 * * * *` (UTC).
5. After **two successful collections** (usually about 30–60 minutes after activation), choose **VIEW** next to a market to see its price-history chart.

Only the scheduled collector stores historical points. Browser refreshes may fetch the newest quote but do not invent or backfill price samples. Snapshots are retained for seven days; the chart shows the last 24 hours. The public history endpoint takes a market ticker only and cannot place orders.

## Data correctness

- Source: Kalshi's public `GET /series` and `GET /markets` endpoints.
- The API adapter discovers sports series and samples a limited number per league to stay inside early-stage runtime/resource budgets. The response explicitly reports partial coverage, including the 55–65¢ watch band.
- YES ask is the published offer price, **not** an independently modeled win probability.
- The displayed change is Kalshi's `last_price_dollars - previous_price_dollars` where both values are available. It is **not** yet a measured 30-minute delta.
- Cache TTL and browser polling are 30 minutes. When D1 is bound, Cron Triggers collect scheduled history independently of site visitors; otherwise the public market endpoint remains on-demand.
- Without D1, no persistent history is claimed. No injury integration, forecast calibration, or verified net-edge logic is claimed yet.
- The app contains no order, portfolio, or account endpoints.

## Roadmap

1. **Phase one implemented in code:** D1-backed 30-minute scheduled snapshots, history API, chart, 55–65¢ watch band (requires D1 provisioning for persistence).
2. Coverage-aware league and market taxonomy, full pagination, lineups/injuries with source timestamps.
3. Python models for sport-specific head-to-head estimates and championship scenarios.
4. Fee/slippage-aware discrepancy calculations, historical backtesting, and calibration reports.
5. Publish forecast history, including losses and data gaps.

## License

A license will be selected before inviting external contributions.

## Data sources

- [Kalshi public market data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Cloudflare Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Cloudflare Angular guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/angular/)
