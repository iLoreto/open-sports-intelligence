# Architecture

## First deployment

```
GitHub main
   └── Cloudflare Workers Git integration
        └── Single Worker deployment
             ├── Angular static assets
             └── Worker /api/markets
              ├── Kalshi GET /series?category=Sports
              └── Kalshi GET /markets?series_ticker=…
```

The Worker API adapter caches a sampled read-only snapshot at the Cloudflare edge for 30 minutes. One manual UI refresh calls `?fresh=1`. The browser also refreshes every 30 minutes while open.

The data source itself provides a previous-price field, but it does not give us a timestamped 30-minute delta. We label that honestly.

## Phase-one historical collector

```
Cloudflare Cron Trigger (UTC, every 30 minutes)
  └── scheduled() → Kalshi sampled scan → D1 RADAR_DB
                                             ├── radar_scans: latest full API payload
                                             └── market_history: timestamped price points

Public GET /api/markets → recent D1 scan (if fresh) → live API fallback → edge cache
Public GET /api/history?ticker=… → D1 24-hour samples (or explicit unavailable)
```

The database binding is intentionally optional so production can deploy safely before D1 provisioning. The scheduled collector logs a warning and returns when `RADAR_DB` is not bound. `?fresh=1` bypasses the edge cache and persisted snapshot for a live check without writing artificial history.

The frontend has a 55–65¢ YES ask watch band, separated game and championship desks, and on-demand history charts. Missing timestamp intervals are rendered as gaps. All displays are factual market observations, not forecasts or betting advice.

## Next iteration

Add full series/market pagination, per-series coverage metrics, ingestion retries/backoff, and additional independent sporting data. The phase-one scheduled sampling is still partial coverage; it must not be mistaken for a global complete radar.

Independent sports data and prediction services are separate model components. A model must publish a tracked version, source timestamps, calibration data, and historical accuracy before any market/model gap appears as a radar signal.

## Security and privacy

- Public data only; there are no account endpoints or credentials in the application.
- No order placement, portfolio calls, authentication tokens, or automated trading.
- No secrets committed to GitHub. Future ingestion API credentials, if any, belong in Cloudflare secrets.
- External data should be treated as untrusted and normalized before rendering.
