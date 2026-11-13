# 2026/27 UEFA Nations League — research module (foundation)

## Scope
54 national teams in 14 official groups. This PR introduces a **pure, read-only, market-independent** TypeScript registry and experimental probability function. It does **not** claim live fixtures, verified current ratings, deployment, or an operational UI.

Official groups: https://www.uefa.com/uefanationsleague/news/0298-1d6ef1acfaef-b54fcf1da859-1000--2026-27-uefa-nations-league-all-you-need-to-know/
Fixtures/results: https://www.uefa.com/uefanationsleague/news/02a2-1fea18abbcbc-456e846509e7-1000--2026-27-uefa-nations-league-all-the-league-phase-fixtures-a/

## Data contract
- A fixture needs a stable ID, group, both teams and an offset-aware kickoff.
- A rating needs team, numerical Elo, source and as-of timestamp.
- A forecast needs an explicit cutoff strictly before kickoff.
- Missing, stale/future or unsupported ratings produce **no forecast**, never a default 1500 disguised as measured strength.
- Current function uses an experimental 65-point home advantage and strength-dependent draw probability. These are **not production-calibrated**.
- Historical ratings and fixtures must be independently sourced, normalized and audited before use.

## Next PRs
1. Verified complete 156-match fixture/results importer, provenance and completeness tests.
2. Reproducible historical dataset ingestion and chronological rating reconstruction; no lookahead.
3. Same-fixture temporal backtest with Brier/log-loss and league-specific calibration.
4. Read-only Worker endpoint and Angular Nations League desk with division/group filters, coverage warnings and manual refresh.

## Test
From `apps/web`: `node --experimental-strip-types --test worker/nations-league.test.ts`.

No market scanning, orders, background polling or price history are introduced.
