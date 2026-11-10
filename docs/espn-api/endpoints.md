# Endpoint reference — public ESPN JSON interfaces

All routes are **unofficial and unversioned as a service contract**, even where their path contains `v2` or `v3`. Test each combination: a listed pattern does not imply every league supports it.

## Common league slugs

| Sport | League | Path pair |
| --- | --- | --- |
| Basketball | NBA | `basketball/nba` |
| Basketball | WNBA | `basketball/wnba` |
| Basketball | Men's NCAA | `basketball/mens-college-basketball` |
| Basketball | Women's NCAA | `basketball/womens-college-basketball` |
| Football | NFL | `football/nfl` |
| Football | NCAA FBS | `football/college-football` |
| Baseball | MLB | `baseball/mlb` |
| Hockey | NHL | `hockey/nhl` |
| Soccer | English Premier League | `soccer/eng.1` |
| Soccer | MLS | `soccer/usa.1` |
| Soccer | UEFA Champions League | `soccer/uefa.champions` |
| Soccer | Serie A | `soccer/ita.1` |
| Soccer | La Liga | `soccer/esp.1` |
| Tennis | ATP | `tennis/atp` |
| Tennis | WTA | `tennis/wta` |
| MMA | UFC | `mma/ufc` |
| Golf | PGA Tour | `golf/pga` |
| Golf | LPGA | `golf/lpga` |

Some tennis/MMA/golf endpoints use different response shapes, tournament IDs or limited coverage. Treat these as discovery candidates, not verified feature parity.

## Site API

Base: `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}`

| Relative path | Use | Notes |
| --- | --- | --- |
| `/scoreboard` | Live/recent/upcoming events | Usually `events[]`; date defaults vary |
| `/scoreboard?dates=YYYYMMDD` | One date | Use league-local schedule dates carefully |
| `/scoreboard?dates=YYYYMMDD-YYYYMMDD` | Date range | Potentially truncated; split ranges and validate completeness |
| `/scoreboard?limit=100` | Request larger event set | Limit is advisory; don't assume server honors it |
| `/scoreboard?week=1&seasontype=2` | Football schedule | Week/season type is sport-specific |
| `/teams` | Team directory | Often `sports[0].leagues[0].teams[]` |
| `/teams/{id}` | Team detail | ESPN numeric ID; not cross-provider ID |
| `/teams/{id}/roster` | Roster | Availability varies |
| `/teams/{id}/schedule` | Team fixtures | Query season/season type where supported |
| `/summary?event={id}` | Event boxscore, leaders, plays | Extract event ID from scoreboard |
| `/injuries` | League injury list | Coverage varies; do not assume complete |
| `/news` | League headlines | Publication timestamps required |
| `/groups` | Divisions/conferences | Schema differs by sport |
| `/transactions` | Transactions | Availability varies |
| `/rankings` | Polls/rankings | Mainly college sports |

Standings use **another base**:

```text
https://site.api.espn.com/apis/v2/sports/{sport}/{league}/standings
```

## Detailed resources

```text
https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events
https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{eventId}
https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{athleteId}/stats
https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{athleteId}/gamelog
https://cdn.espn.com/core/{sport}/game?xhr=1&gameId={eventId}
```

Core responses often use linked `$ref` resources. **Never blindly fetch arbitrary URLs supplied by remote JSON**: validate allowed HTTPS hosts and paths to prevent SSRF. Some community examples mention `.pvt` references; don't rewrite or chase private hosts in production without validating legitimacy and authorization.

## Known operational gotchas

1. `200 OK` can return no events, a partial date range, or a placeholder standings payload.
2. A single date range can exceed server limits; split by day/week and deduplicate by event ID.
3. A `completed` flag is safer than inferring final status from score presence; unfinished scores can be zero or absent.
4. Soccer ties, overtime and shootouts need sport-specific logic. Basketball win/loss math does not generalize.
5. ESPN abbreviations vary across feeds and over time. Build an explicit, tested identity map.
6. Event timestamps are UTC; league-local game dates may differ.
7. Published request quotas, SLAs and reuse rights are not guaranteed for these endpoints.

See [community references](README.md#sources-and-further-reading) for additional candidates; this document intentionally does not assert that every listed route is live-tested.
