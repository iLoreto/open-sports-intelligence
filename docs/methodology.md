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

- Limited initial series coverage and no persistence: every response explicitly reports partial coverage.
- League classification is text-based and is a temporary discovery heuristic.
- The game-vs-championship taxonomy is preliminary; complex futures may be classified as "Other".
- There is no injury, goalie, lineup, event schedule, or independent head-to-head dataset yet.
- No claim of edge, profitability, or statistical calibration can be made yet.

## Acceptance criteria for an eventual model score

1. Published, reproducible model feature set and version.
2. Timestamped data lineage that precedes the quoted market snapshot.
3. Out-of-sample calibration and performance evaluation by sport and market type.
4. Correct exchange fees, bid/ask execution price, and slippage assumptions.
5. Full history of forecasts and results, including missing and losing predictions.
