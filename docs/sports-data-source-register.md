# Sports Radar — Data Source Register

**Status:** Source evaluation and documentation, not authorization to activate feeds. Updated 2026-11-10.

## Source classification

| Provider | Data | Project status | Free access / constraint | Reference |
|---|---|---|---|---|
| ESPN public JSON | Scores, schedules, teams and completed-game results | **Integrated** for NBA team comparison; other leagues depend on current adapters | Unofficial, undocumented, no SLA or guaranteed commercial rights | https://site.api.espn.com/ |
| Kalshi | Public event/market data and quotes | **Integrated** for user-triggered manual scan | Public market endpoints; pagination, rate limits and coverage apply | https://docs.kalshi.com/ |
| BALLDONTLIE | NBA teams, players, games | **Previously evaluated**, not active scanner source | Free key: teams/players/games, 5 requests/min; game-player stats, injuries, box scores and props require paid tiers | https://docs.balldontlie.io/ |
| DeepCourt | Men’s ATP, Challenger and ITF live scores, match history, surface form, H2H and conditions | **Used as a manual research reference**, not an integrated API | Free live scores, results, player profiles and history. Pro ($30/month listed) adds detailed serve/conditions analysis. No public developer API confirmed; scraping protected data is prohibited by terms. | https://deepcourt.ai/pricing |\n| TheSportsDB | Multi-sport teams, events, leagues | Candidate | Public test/free tier; limited fields, verify permitted usage | https://www.thesportsdb.com/api.php |
| MLB StatsAPI | Baseball game data | Candidate | Public endpoints, no key commonly required; review MLB terms | https://statsapi.mlb.com/ |
| NHL web API | Hockey schedule, scores, stats | Candidate | Public endpoints; undocumented stability/rights, verify live granularity | https://api-web.nhle.com/ |
| football-data.org | Soccer fixtures, standings and results | Candidate | Limited free token tier; not a source of guaranteed xG | https://www.football-data.org/ |
| API-Football | Soccer schedules and selected stats | Candidate | Limited free tier; assess quota and live endpoint eligibility | https://www.api-football.com/ |
| ESPN tennis / TheSportsDB | Tennis results/event discovery | Candidate only | Coverage of point-by-point, serve percentages and live scores unverified | https://www.espn.com/tennis/ |

**DeepCourt verification:** Its official pricing identifies free scores/history and paid condition-specific analytics. Treat this as a research website until an authorized API or data license is confirmed. Its terms prohibit scraping protected data: https://deepcourt.ai/terms . Coverage is men’s ATP, Challenger and ITF; do not assume WTA.\n\n## Critical engineering rules

1. Distinguish **integrated**, **previously evaluated**, **candidate**, and **unavailable**. An API mentioned here is not proof of an operational integration.
2. Verify provider terms, commercial use, caching and attribution before deployment. Public access is not a license.
3. Validate each endpoint in CI and against a live sample before claiming it works. Track response schema, data timestamps, error rate and quota.
4. A free NBA games endpoint does not imply free player game statistics. BALLDONTLIE free currently excludes player stats and injuries.
5. Market quotes and sporting outcomes are different feeds. Never silently cross-wire Kalshi and Novig.
6. Record `source`, `observedAt`, `fetchedAt`, `coverage`, `confidence` and `licenseStatus` for any proposed data adapter.
7. Tennis Collapse, hockey/soccer Storm Risk and basketball minutes require **verified** granular inputs or must remain manual analyst observations.
8. Preserve the manual-only scan architecture. No background polling or historical series is authorized by this resource inventory.

## Suggested integration priority

- **P0:** Stabilize existing ESPN and Kalshi integrations, smoke tests and honest error reporting.
- **P1:** Evaluate NHL and MLB public feeds for verified scores/schedules; TheSportsDB for reference metadata.
- **P2:** Compare football-data.org and API-Football for soccer fixtures and match statistics.
- **P3:** Source and validate granular tennis points/serve data, basketball player minutes, hockey shot quality and soccer xG. If no sustainable free feed exists, show unavailable rather than invent data.

**Developer note:** Read `README.md` and `docs/live-sports-radar-methodology.md` (PR #42) for product constraints and proposed indicators. All implementation changes require separate PR review.
