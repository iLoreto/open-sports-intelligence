# Architecture — current manual-scan implementation

## Request flow

```text
GitHub main --push/merge--> Cloudflare Workers Git deployment
                              |
                              +-- Angular static application
                              +-- Worker /api/* endpoints

User selects provider + ask range
  -> clicks Scan
  -> POST /api/markets/scan
  -> bounded Kalshi public event/market requests
  -> optional short-lived shared scan cache
  -> result, source freshness, and partial-coverage warnings
```

**There is no background market scanner.** Cloudflare Git deployments can occur automatically, but market data is retrieved only on explicit scan requests. The browser must not be described as polling every 30 minutes.

## API and data sources

- `POST /api/markets/scan`: explicit manual scan. Kalshi supported; Novig not configured. Bounded upstream pagination means coverage may be incomplete.
- `GET /api/health`: includes `backgroundScanning: false`.
- NBA team comparison: public ESPN team schedules, with completed-game normalization and coverage limitations.
- Tennis: provider not configured; return a clear unavailable status.

The current `apps/web/wrangler.jsonc` declares static assets and the Worker entrypoint; it does not declare scheduled cron triggers or a D1 history database binding.

## Removed legacy design

Earlier phases proposed a 30-minute browser refresh, scheduled Cloudflare sampling, D1 `radar_scans`/`market_history` tables, and 24-hour history charts. **Those descriptions are historical design notes, not current features.** The application no longer promises automatic refresh or 30-minute historical tracking. Legacy migration files may remain in Git history or the repository for reference; their presence does not mean collection is running.

A provider's previous-price value is not a timestamped 30-minute delta. A shared response cache is an efficiency mechanism, not a periodic recorder.

## Multi-developer change control

Create new branches from the current remote `main`; avoid stale PR branches and direct pushes to production. Review current source and documentation before changing contracts. Keep PRs focused, run build/typecheck and relevant tests, check GitHub Actions, and refresh the PR branch when other developers merge changes. A successful build is not proof that a live external API is returning valid data; production smoke checks must exercise actual deployed endpoints.

## Security and correctness

- Read-only public research, no order placement or account integration.
- No secrets in source control.
- Normalize and validate upstream data; surface unavailable providers and partial results.
- No fabricated market history, forecasts, or unsupported completeness claims.
