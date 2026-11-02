# Open Sports Intelligence

An open-source, read-only sports market intelligence dashboard.

**Status:** NBA comparison desk with an experimental, historically backtested Elo win-probability baseline; an NBA **model-versus-market value lab** for exactly matched game-winner contracts; a resumable public Kalshi Sports catalog; and sampled 30-minute market-price history. Sports discovery has **no default YES-price range, league whitelist or top-180 result cutoff**. The NBA model does **not** use market prices, lineups, or injuries and does **not** establish a verified betting edge.

## Stack

- Angular 22 / TypeScript (static dashboard)
- Cloudflare Workers with Static Assets (Angular frontend and API in one deployment)
- Cloudflare Workers Git integration (automatic deployments from GitHub)
- Cloudflare edge cache (30-minute response TTL for both data feeds; 5-minute NBA TTL when sources are missing)
- Cloudflare Cron Trigger (every 2 minutes, UTC) for bounded catalog indexing; existing price-history samples every 30 minutes
- GitHub Actions (build validation)
- Reproducible historical NBA Elo baseline, chronological holdout evaluation and on-demand current-season updates
- Future: verified lineup-aware models, forecast history and calibration monitoring

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

The tracked `apps/web/wrangler.jsonc` declares the Worker entrypoint, Angular build directory, and static-asset binding. `/api/catalog`, `/api/markets`, `/api/nba/comparisons`, `/api/nba/ev`, `/api/history`, and `/api/health` are served by the Worker; other routes serve the static Angular app.

### Full Sports catalog (no price band)

`GET /api/catalog` lists **all quoted prices** on standard open Kalshi Sports events. It walks the upstream `GET /events?status=open&limit=200&with_nested_markets=true` cursor without a fixed page or contract cutoff, filters for the provider's actual `category: Sports` label, and retains every recognized open contract. No minimum price, maximum price, selected-league restriction or volume ranking is applied. The dashboard provides text search over **loaded** contracts and a **Load more** button for cursor pagination. Major sport choices, including **NBA**, remain available even before that sport appears in the first page. `GET /api/catalog?sport=NBA` searches **all indexed pages** rather than filtering only the first displayed chunk; `cursor` preserves that sport selection across further pages. The NBA matchup desk also has a shortcut directly to NBA catalog results.

Once migration `0002_sports_catalog.sql` is applied, one upstream page is indexed every **two minutes**. Progress, indexed market count, last update, and whether a full traversal has completed are returned in every response. Each provider page is saved in bounded 80-contract D1 chunks; a cursor is advanced together with the chunks to avoid silently skipping pages. The newest completed traversal remains browseable while the next traversal builds. The historical quote sampler remains independent and continues every 30 minutes.

```bash
curl 'https://open-sports-intelligence.iloreto97.workers.dev/api/catalog'
# Follow the JSON `nextCursor` with /api/catalog?cursor=<URL-encoded-nextCursor>
```

Without D1 or before applying migration 0002, `/api/catalog` falls back to **live, cursor-paginated** Kalshi event data. This fallback does not claim total-market counts or background completion. If provider rate limits are hit, the scheduled collector pauses and retries. Full traversal may take hours; opening the dashboard does not force an unbounded fetch. The catalog is an inventory gathered over time, **not a simultaneous order-book snapshot**. It currently covers standard Sports events; Kalshi's *multivariate combo* markets are not available from this endpoint and are explicitly excluded. No independent forecast-to-contract match means no EV is calculated here.

### NBA matchup comparison API

`GET /api/nba/comparisons` returns an independent, read-only NBA research feed:

- Current-day and next-day regular-season NBA games within the next 24 hours (including today's completed games), capped at 16. The window uses the `America/Los_Angeles` time zone.
- For both teams: current record, last 10, home/road record, points scored and conceded per game, point differential, and streak when reported by ESPN.
- Up to five completed head-to-head regular-season meetings from the current and preceding season. Historical results do **not** imply the next game's outcome.
- ESPN-listed injuries with player status, comments and feed update time. They are **not** confirmed starting lineups. Missing injury reports and incomplete head-to-head schedules are flagged rather than interpreted as absence of injuries or games.
- A source timestamp and `warnings`, `notes`, and `counts.partialCoverage` fields. The app exposes upstream failures rather than generating fallback statistics.
- A separate `model` object with out-of-sample validation metrics; a `forecast` for **scheduled** games only, omitted when current-season results cannot be verified. In-progress and completed games do not show updated ratings as if they had been known before tipoff.

`GET /api/nba/comparisons?fresh=1` bypasses the 30-minute Worker response cache for manual refresh. Data is sourced directly from ESPN's publicly accessible JSON endpoints (`site.api.espn.com`); those feeds are not a guaranteed, versioned developer API and may change or become unavailable. A 502 means neither scoreboard request could be retrieved.

Run `npm run test:nba` for normalization and partial-feed tests, and `npm run typecheck:worker` for the Worker TypeScript check. GitHub Actions runs both alongside Angular's production build.

### Experimental NBA Elo model (phase three)

The baseline uses a standard two-team Elo formula with **K=20**, **65 Elo points for home court**, **400-point logistic scale**, and **70% season-to-season carryover**. These fixed parameters were not selected by optimizing the published 2025–26 holdout. Each completed game changes both teams' ratings; every validation probability is scored *before* that game's result updates those ratings.

Training uses exactly 1,230 ESPN-classified `STD` regular-season games in each of **2023–24** and **2024–25**. The **2025–26** season (1,230 games) is a chronological, walk-forward holdout. Non-standard games such as All-Star contests and the NBA Cup final are excluded, even when ESPN labels their season type as regular season.

| 2025–26 holdout | Elo model | Training-set home-win baseline |
| --- | ---: | ---: |
| Brier score (lower is better) | **0.2094** | 0.2472 |
| Log loss (lower is better) | **0.6074** | 0.6874 |

The public API also includes empirical calibration buckets for all probability ranges. Some buckets are substantially overconfident (especially the 20–30% home-win range); **the model is not perfectly calibrated, nor does a better historical Brier score imply betting profitability**.

The checked-in `apps/web/worker/nba-baseline.ts` contains the versioned historical ratings and metrics. Rebuild it from public ESPN months with `npm run build:nba-model` (Node 24 and network access required). In production, the Worker replays completed **2026–27** regular-season games from October through the current month on top of those ratings. If any required month is inaccessible, it withholds all projections but continues to show sourced matchup statistics. New seasons require an intentionally reviewed retraining and update of the forecast-season artifact; the service does not silently use stale ratings.

Forecasts exclude injuries, roster quality, back-to-backs, travel, player availability, Kalshi prices, and sportsbook quotes. They are research estimates, **not prices to trade, recommendations, or independent demonstrations of edge**.

### NBA model-versus-market EV lab (experimental)

`GET /api/nba/ev` joins **live**, public Kalshi `KXNBAGAME` winner quotes to ESPN regular-season NBA fixtures in the next **seven days**, plus the validated historical Elo baseline. Unlike the long-running D1 Sports catalog, price comparison requests fetch current KXNBAGAME market asks and current series fee metadata directly from Kalshi. Responses are cached for **five minutes**; `?fresh=1` bypasses this cache on manual refresh. No additional Cloudflare migration is needed.

To avoid false matches, a fixture must be scheduled in the ESPN `STD` regular season, have a start time in the future, match **the exact event date in Los Angeles time**, match the full away/home team-code pair in a `KXNBAGAME-YYMMMDD<AWAY><HOME>` ticker, and have both corresponding `-<TEAM>` outcome markets active. Markets for spreads, totals, props, NBA championship futures, live/completed games, and ambiguous team codes are never assigned a game-winner Elo probability. A missing matchup or failed Elo month is reported; no substitute forecast is manufactured. Kalshi market-pagination limits are reported explicitly.

For each exact two-team event, the engine evaluates both market routes to a given outcome: **YES** on that team's market or **NO** on its opponent's market. It displays whichever currently has the lower estimated price-plus-fee for the illustrative 100-contract order, retaining the contract ticker and side:

\[\text{Gross model gap per contract} = P_{\text{Elo}}(\text{winning outcome}) - \text{quoted ask}\]

\[\text{Illustrative EV per contract} = P_{\text{Elo}} - \text{ask} - \frac{\text{estimated 100-contract taker fee}}{100}\]

The fee estimate reads **`fee_type` and `fee_multiplier` live from `GET /series/KXNBAGAME`**. Only the observed `quadratic_with_maker_fees` type is supported. Standard taker fee formula: `ceil(100 × 0.07 × multiplier × quantity × price × (1 − price)) / 100` dollars, rounded upward once per order. If fee terms cannot be verified, estimated net EV and fee-adjusted break-even are **null**; the gross gap can still be shown. The user can filter to positive model estimates or inspect all (including negative) comparisons. Fees, the executable quote, and availability may differ from the 100-contract illustration, particularly for special contract terms and liquidity.

This calculation is **model-implied expected value, not a demonstrated tradeable edge**. The Elo model is imperfectly calibrated, excludes lineup/injury/rest/travel factors, and uses historical data that may not be predictive today. The results do not simulate fills, validate injury-adjusted probabilities, or backtest realized P&L against contemporaneous Kalshi asks. No capital allocation or recommendations are generated. The model compares **Kalshi game-winner contracts**, not external sportsbook moneylines; those will require separate licensed odds/data-source matching.

### Enable persistent price history (one-time infrastructure setup)

The new dashboard and live market feed **work without D1**. Until D1 is connected, `/api/history?ticker=...` explicitly returns `available: false` with no fabricated price history.

1. Create the D1 database `open-sports-radar` in Cloudflare (already provisioned for this deployment).
2. Verify the database binding in `apps/web/wrangler.jsonc`:

   ```jsonc
   "d1_databases": [
     { "binding": "RADAR_DB", "database_name": "open-sports-radar", "database_id": "867ffc71-bf0b-4259-a0ca-19fb55b0872f" }
   ]
   ```

3. Apply both bundled migrations, including `0002_sports_catalog.sql`: `npx wrangler d1 migrations apply open-sports-radar --remote` (from `apps/web`).
4. Redeploy from GitHub. `triggers.crons` schedules index advancement at `*/2 * * * *` (UTC) and sampled price history on the 30-minute marks.
5. After **two successful collections** (usually about 30–60 minutes after activation), choose **VIEW** next to a market to see its price-history chart.

Only the scheduled collector stores historical points. Browser refreshes may fetch the newest quote but do not invent or backfill price samples. Snapshots are retained for seven days; the chart shows the last 24 hours. The public history endpoint takes a market ticker only and cannot place orders.

## Data correctness

- Full-book source: Kalshi's public cursor-paginated `GET /events` endpoint, with nested markets and `category: Sports` filtering. Multivariate combo events are excluded; upstream cursors are exhausted incrementally and coverage is labeled incomplete until then.
- Legacy 30-minute price-history source: Kalshi's `GET /series` and `GET /markets` endpoints. This independent sampling adapter still selects a bounded subset of series; its response explicitly reports partial coverage, and its sampled panels are labeled separately from the full catalog.
- YES ask is the published offer price, **not** an independently modeled win probability.
- The displayed change is Kalshi's `last_price_dollars - previous_price_dollars` where both values are available. It is **not** yet a measured 30-minute delta.
- The legacy market cache TTL and browser polling are 30 minutes. The full Sports catalog has no-store responses and advances through D1 every two minutes. Cron Triggers collect scheduled history independently of site visitors; otherwise the public market endpoint remains on-demand.
- Without D1, no persistent price history is claimed. Injury integration is observational only; the experimental Elo model has a completed historical holdout but not verified lineups, ongoing forward calibration, or any demonstrated net-edge logic.
- The app contains no order, portfolio, or account endpoints.

## Roadmap

1. **Market history implemented:** D1-backed 30-minute scheduled snapshots, history API and chart (requires D1 provisioning for persistence).
2. **NBA comparison implemented:** season statistics, L10, dated injuries, and last-five head-to-head results with coverage warnings.
3. **NBA model and EV research implemented:** reproducible Elo baseline, 2025–26 walk-forward holdout, empirical probability buckets, current-season updates, and exact live KXNBAGAME price-vs-model comparison with explicit fee assumptions.
4. **Full standard Sports catalog implemented:** unbounded cursor traversal across scheduled invocations, coverage accounting, D1 paging, all YES prices, sport/search controls. Remaining: multivariate-market support, deeper sport taxonomy, live quote refresh and robust data-source contracts.
5. Sport-specific, lineup-aware and championship models, with prospective calibration monitoring.
6. Remaining: external sportsbook odds comparisons, exact execution/size-aware fee and slippage estimates, honest prospective EV backtesting, and published forecast/outcome logs (including losses and data gaps).

## License

A license will be selected before inviting external contributions.

## Data sources

- [Kalshi public market data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [ESPN NBA schedule and scores](https://www.espn.com/nba/scoreboard)
- [Cloudflare Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Cloudflare Angular guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/angular/)
