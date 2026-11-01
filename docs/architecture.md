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

This first version is **not** yet a permanent ingest pipeline. The data source itself provides a previous-price field, but it does not give us a timestamped 30-minute delta. We label that honestly.

## Next iteration

Use Cloudflare Cron Triggers to invoke a separate ingest Worker every 30 minutes; persist normalized snapshots to D1. UI requests should read those snapshots without running a full exchange scan on every visitor request. Add retry/backoff, data freshness thresholds, full pagination, and per-series coverage metrics.

Independent sports data and prediction services are separate model components. A model must publish a tracked version, source timestamps, calibration data, and historical accuracy before any market/model gap appears as a radar signal.

## Security and privacy

- Public data only; there are no account endpoints or credentials in the application.
- No order placement, portfolio calls, authentication tokens, or automated trading.
- No secrets committed to GitHub. Future ingestion API credentials, if any, belong in Cloudflare secrets.
- External data should be treated as untrusted and normalized before rendering.
