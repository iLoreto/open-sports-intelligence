# Sports Radar — Live Market Analysis Methodology

**Status:** Proposed research and product requirements (not implemented)  
**Date:** 2026-11-10  
**Audience:** Product owners, developers, reviewers, QA  
**Scope:** Tennis, basketball, hockey, soccer; manual, read-only market research.

## 1. Purpose

Capture the evolving, observation-led approach to live sports markets. The radar must help a human distinguish a plausible sporting outcome from a **good entry at the available price**. It must not place orders, automatically trade, imply access to unsupported live feeds, or present hypotheses as validated predictive models.

**Core principle:** Statistics establish the baseline; live gameplay tests whether the thesis remains valid; the market quote determines whether the risk is worth taking.

This document is a design proposal. It does not change the current manual-scan behavior, provider support, or background-history policy documented in the README.

## 2. Four sports, different information structures

| Sport | On-field participants | What is visually observable | Primary uncertainties | Proposed radar emphasis |
|---|---:|---|---|---|
| Tennis singles | 2 | Both competitors, serve and movement | Serve deterioration, fatigue, break-point pressure, rapid recovery | Individual performance deterioration and reversal |
| Basketball | 10 | Most on-court spacing, ball movement, defensive cohesion | Minutes, rotations, fouls, blowouts, pace | Player scoring pace + expected playing time |
| Hockey | 12 including goalies | Immediate puck pressure and goalie; off-camera movement is hard to follow | Line changes, penalties, deflections, goaltending, sudden transitions | Shot quality and **Storm Risk** |
| Soccer | 22 | Formation and ball-side play; many off-ball runs unseen | Counterattacks, red cards, substitutions, low scoring | Chance quality, tactical shifts and **Storm Risk** |

Participant count is a **heuristic for interaction complexity**, not a proven ordering of betting risk. Broadcast framing, sport pace, scoring frequency and market type affect observability. Hockey and soccer belong together for the purpose of abrupt, high-impact scoring events, but require distinct sport-specific indicators.

### 2.1 Visual observability

Record whether the analyst can actually see the relevant action. Suggested `visualConfidence` states: `high`, `partial`, `low`, `unknown`. This is analyst-supplied context unless a verified computer-vision source exists; never fabricate visual confidence from a scoreboard alone.

- Tennis: observe first-serve success, return pressure, footwork, unforced errors and composure. Body language is subjective and should be labeled as such.
- Basketball: observe spacing, passing, defensive rotations, player involvement, rotations and benching likelihood.
- Hockey: fast puck movement, line changes and off-camera positioning make a TV feed incomplete.
- Soccer: wide field and off-ball positioning mean possession alone may hide dangerous counterattacks.

## 3. Sport-specific proposed indicators

### Tennis — Collapse Indicator

Potential features: rolling first-serve percentage, second-serve points won, unforced-error trend, break points faced/saved, service-game duration, rally outcomes, physical movement and optional human observation. Distinguish **observed deterioration** from **forecast collapse**. Elite players can recover; validate whether each feature improves out-of-sample predictions.

### Basketball — Pace, Minutes and Cohesion

Player props require cumulative actuals, elapsed game time, projected finish, remaining required points, recent pace, expected minutes and score differential. The model must distinguish game-clock minutes from minutes actually played. A widening lead may decrease a star player's playing time; a comeback can increase it. Team cohesion and offensive involvement may be human-observed annotations until supported by data.

### Hockey and Soccer — Storm Risk

The ocean analogy: apparent control can change in a single high-leverage event. Proposed `stormRisk` is **not** an established probability. Candidate inputs include high-quality chances, expected goals, defensive breakdowns, penalties/power plays, dangerous turnovers, goalie performance, red cards, tactical changes and substitution effects. Distinguish score advantage from quality of control. Report source freshness and confidence. Avoid false precision and unvalidated low/medium/high cutoffs.

## 4. Shared decision engine: ADD / HOLD / REDUCE / EXIT

These are **research labels for manual decisions**, not automatic trade instructions.

| Status | Suggested conditions |
|---|---|
| ADD | Thesis supported by new live evidence, market price offers positive estimated value after costs, sufficient liquidity, and predeclared total exposure cap permits it |
| HOLD | Thesis intact; neither stronger value nor a material reason to exit |
| REDUCE | Evidence worsens, confidence falls, or exposure becomes disproportionate |
| EXIT | Thesis materially breaks and executable exit price is preferable to remaining exposed |

Never increase solely because a price moved, because a position is losing, or because a prop is nearing completion. Distinguish **cash-funded exposure** from **promotional-credit exposure**, plus combined gross exposure. Track matched versus unfilled orders separately. Never imply a suggested action was executed.

**Required inputs:** sport, market and precise threshold, period/time, actual game state, verified feed timestamps, current quoted price and side, estimated fair probability with uncertainty, fees/slippage, liquidity, bankroll/exposure cap, existing position and visual-confidence state.

**Market math:** for a binary $1 payout at entry price `p`, simplified gross expected value per contract is `q - p`, where `q` is the independently estimated win probability. Incorporate fees and execution costs; quoted prices are not themselves verified probabilities. For parlays, assess the **joint probability and correlation** of all legs; do not multiply marginal probabilities under an unsupported independence assumption.

## 5. Worked case: Brunson 25+ points, Knicks vs Bucks

**Illustrative observations from live discussion; not a verified historical feed.** Times and scores are user-reported snapshots.

| Game clock | Brunson cumulative points | Interpretation |
|---|---:|---|
| Halftime (24 elapsed min) | 10 | Below even 25-point pace (12.5) |
| Q3, 3:00 remaining (33 elapsed) | 16 | 9 more required with 15 game minutes remaining |
| Q3, 1:00 remaining (35 elapsed) | 20 | Sharp scoring acceleration; 5 more required |
| End Q3 (36 elapsed) | 21 | 4 more required; favorable scoring checkpoint |
| Early Q4, 11:38 remaining | 23 | 2 more required, but outcome not yet settled |

**Projection methodology:** naive cumulative pace at end Q3 = `21 / 36 = 0.5833 points per elapsed game minute`; projected regulation finish `21 / 36 * 48 = 28`; estimated 25-point crossing at elapsed minute `25 / (21/36) ≈ 42.86` (Q4 with ~5:09 remaining). This is a *simple linear scenario*, not a calibrated probability. Actual player minutes, foul trouble, usage, defensive adjustments and game state can invalidate it. Display the model assumption prominently.

**Live-entry lesson:** The observer initially worried a large Knicks lead would bench Brunson. As Milwaukee narrowed the margin (roughly 20 to 15), expected Brunson minutes appeared to improve while his points accelerated. The observer reported adding $75 **before** the 25-point leg completed, to avoid much lower potential profit at later prices. This illustrates the trade-off between better payout and increased chance of loss; it does **not** establish that the entry was positive EV or that the ticket won.

**Correlated parlay risk:** Knicks win, Milwaukee under 103.5 and Brunson 25+ were discussed together. A Milwaukee comeback can help Brunson's playing-time outlook while hurting the Milwaukee-under leg and potentially the Knicks-win leg. Evaluate all legs jointly, not just Brunson.

**Suggested UI:** one persistent extrapolation chart with actual observed points, even-pace target, current projection, and 25-point threshold; label projected points distinctly from observed points. Recalculate from each new user-provided snapshot. Show projected finish and estimated crossing time with assumptions, not invented real-time updates.

## 6. Data and UX contract

1. Keep the current **explicit manual Scan** interaction. No background polling, automatic order placement, or fabricated 30-minute market history.
2. Separate `observed`, `user_reported`, `provider_reported`, `derived`, and `hypothesis` values. Attach timestamps and source labels.
3. Use a provider adapter with explicit availability and errors. Do not substitute a Kalshi quote for Novig, or vice versa.
4. Surface `lastUpdated`, coverage completeness, stale-data warning and unavailable-data state.
5. Let the analyst enter manual observations (score, clock, minutes, game pressure, visual confidence) without claiming they were fetched.
6. Preserve a sport-specific view: tennis deterioration, basketball pace/minutes, hockey/soccer storm indicators.
7. For every ADD/HOLD/REDUCE/EXIT label, show reasons, assumptions, uncertainty and exposure limits.
8. Preserve the latest user snapshot as the latest **provided** observation, without implying it is independently live-verified.
9. Keep prop definitions explicit: 25+ includes 25; under 103.5 allows 103 or fewer.
10. Do not conflate a completed prop leg with a completed parlay or a profitable ticket.

## 7. Implementation roadmap (proposal only)

**Phase A — Documentation and manual model:** data schema, source provenance, manual observation entry, basketball pace chart and explanatory decision labels.

**Phase B — Sport-specific signals:** tennis serve/break-pressure trends; basketball minutes and rotations; hockey and soccer chance-quality/storm inputs, only when trustworthy sources are available.

**Phase C — Price and exposure assessment:** provider-specific executable quotes, transaction costs, joint parlay risk, liquidity, cash vs credit exposure and user-defined limits.

**Phase D — Validation:** replay timestamped historical games and prices, evaluate calibration, false positives, decision latency, feed staleness, and outcomes by sport. Do not promote heuristic labels to confidence scores without evidence.

## 8. Acceptance tests for developers

- At 21 points at end Q3, 25+ shows **4 required**, a naive 28-point final projection, and an approximate 5:09 Q4 crossing time, clearly labeled as extrapolation.
- Updating from 16 to 20 points changes the **same chart** and its projected finish, rather than replacing it with an unrelated chart.
- Missing live player-minute data yields `unknown`, never an invented number.
- A larger lead can lower estimated playing-time confidence; a narrowing lead may raise it, but only with explicit supporting evidence.
- Tennis deterioration is not automatically called a collapse based on body language.
- Hockey/soccer Storm Risk shows unknown when required inputs are unavailable.
- A correlated three-leg parlay is not priced as three independent outcomes without justification.
- No scheduled scans, 30-minute historical series, trades, or order placement are introduced.
- Unit tests distinguish game-clock elapsed time from individual player minutes and preserve source timestamps.

## 9. Engineering governance

This is a proposal for review, not authorization to implement all phases. Follow the latest remote `main`; use a dedicated PR and mandatory review/approval gates. Never bypass PR review or merge automatically. Verify changes against current repository behavior, run appropriate tests, and document which checks actually ran. No developer should interpret proposed radar features as existing functionality.
