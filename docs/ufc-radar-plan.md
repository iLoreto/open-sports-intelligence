# UFC Radar future update

This PR is a planning-only change, not a live UFC integration.

## Modules
- Read-only UFC event/fighter/fight API with stable identifiers, verified sources, timestamps, cancellation status and tests.
- Independent fight probabilities and method-of-victory analysis with citations and versioning.
- Kalshi/Novig provider adapters with per-provider quote availability, market matching by settlement rules, fees, bid/ask, liquidity and freshness.
- Manual refresh only; no order placement. Check API access and public redistribution permissions before enabling quotes.
- Google Sheets export: one tab per numbered UFC event (e.g. UFC 334), with cited fight research, independent forecasts, market snapshots and outcome review. Fight Nights use date-based tabs.
- Cloudflare preview deployment on PRs; mobile and regression tests for NBA and tennis.

## Acceptance
No fabricated prices, no silent substitution of providers, no secret credentials in the browser, and no overwriting community research notes.
