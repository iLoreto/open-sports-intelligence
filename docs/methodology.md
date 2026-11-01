# Data methodology

## Current measurements

| Field | Interpretation |
| --- | --- |
| YES bid | Highest displayed bid to purchase YES, in dollars per contract |
| YES ask | Lowest displayed offer to purchase YES, in dollars per contract |
| Last | Latest reported matched trade price |
| Change | Last minus Kalshi's previous-price field; not 30-minute history |
| 24h volume | Kalshi's 24-hour traded-contract count |
| Spread | YES ask minus YES bid; not a transaction fee |

The values are exchange market information, **not** a probability model or an investment recommendation. The spread and other transaction costs matter when evaluating any proposed market discrepancy.

## Known gaps

- Limited initial Kalshi series coverage; price history requires D1 scheduling.
- League classification is text-based and is a temporary discovery heuristic.
- The game-vs-championship taxonomy is preliminary; complex futures may be classified as "Other".
- NBA reports include ESPN team results, injury lists and head-to-head histories, but not verified lineups or all sports.
- NBA Elo is an experimental, backtested baseline, not an injury-adjusted team assessment or verified market edge. Probability buckets reveal residual miscalibration.
- No claim of net profitability, fee-adjusted edge, verified starting lineups or ongoing calibration can be made.

## NBA Elo model and validation

- **Source**: ESPN regular-season (`STD`) scoreboards, team IDs and completed game scores, without Kalshi or Vegas prices. Historical games downloaded by `apps/web/build-nba-baseline.mjs`.
- **Model**: (P(\mathrm{home}) = 1 / (1 + 10^{(R_{away} - R_{home} - 65)/400})\); Elo changes by (20 \times (\mathrm{actualHomeWin} - P(\mathrm{home}))\) after each result. Team ratings regress 30% toward 1500 each offseason.
- **Training**: all 1,230 regular-season games in 2023–24 and 2024–25. **Holdout**: 1,230 games in 2025–26, evaluated before each game is used to update ratings. No 2025–26 outcome informs a probability for that same game.
- **Brier**: 0.2094 model vs 0.2472 constant home-win baseline (54.35% home wins in training); **log loss**: 0.6074 vs 0.6874. Lower is better. These are historical descriptive metrics, not forward guarantees.
- **Calibration**: every 10-point probability bucket is disclosed with the actual home-win fraction and count; small or extreme buckets may be unstable. Model forecasts intentionally exclude player availability, injuries, lineups, travel and game-specific news.
- **Live features**: the model replays completed games from the current season, without using unfinished games or postgame ratings to make forecasts for those same games. If any required score month is missing or the season changes, model output is unavailable while sourced comparisons remain visible.
- **Deployment**: historical artifact is checked into GitHub and cannot regenerate silently in Cloudflare. The original training code and tests are public. No order functionality exists.

## Acceptance criteria for an eventual model score

1. Published, reproducible model feature set and version (experimental NBA Elo baseline satisfies this part only).
2. Timestamped data lineage that precedes the quoted market snapshot.
3. Out-of-sample calibration and performance evaluation by sport and market type (NBA model has a historical holdout, but market-type/forward validation remain).
4. Correct exchange fees, bid/ask execution price, and slippage assumptions.
5. Full history of forecasts and results, including missing and losing predictions.
