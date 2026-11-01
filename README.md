# Open Sports Intelligence

An open-source, read-only sports market intelligence dashboard.

**Status:** MVP foundation. The dashboard displays public Kalshi sports market prices, previous-price movement, and 24-hour volume. **It does not yet produce independent win probabilities or claim any betting edge.**

## Stack

- Angular 22 / TypeScript (static dashboard)
- Cloudflare Workers with Static Assets (Angular frontend and API in one deployment)
- Cloudflare Workers Git integration (automatic deployments from GitHub)
- Cloudflare edge cache (30-minute response TTL)
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

## Data correctness

- Source: Kalshi's public `GET /series` and `GET /markets` endpoints.
- The API adapter discovers sports series and samples a limited number per league to stay inside early-stage runtime/resource budgets. The response explicitly reports partial coverage.
- YES ask is the published offer price, **not** an independently modeled win probability.
- The displayed change is Kalshi's `last_price_dollars - previous_price_dollars` where both values are available. It is **not** yet a measured 30-minute delta.
- Cache TTL and browser polling are 30 minutes. This initial release is **on-demand**; it does **not** yet run a 24/7 background collector.
- No persistent price history, injury integration, forecast calibration, or verified net-edge logic is claimed yet.
- The app contains no order, portfolio, or account endpoints.

## Roadmap

1. D1-backed 30-minute scheduled snapshots and historical price series.
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
