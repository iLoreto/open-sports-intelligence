# ESPN public JSON API — community developer blueprint

> **Unofficial, independent documentation.** This project is not affiliated with, endorsed by, or supported by ESPN. The endpoints below are reverse-engineered, publicly accessible web endpoints, **not a contracted or officially supported public API**. They may change, rate-limit, restrict usage, or disappear. No API key is typically needed for the illustrated endpoints, but public accessibility does not grant unrestricted commercial rights. Review ESPN terms and applicable data/licensing requirements before deploying. Never bypass access controls.

This guide is written for developers building read-only sports scoreboards and analytics. It intentionally distinguishes **observed/community-documented patterns** from **guaranteed contracts** (there are none). Validate each route and response for your league. Last research review: 2026-11-10; **not a live verification of every endpoint**.

## Start here

```sh
# NBA games (live and scheduled)
curl -fsS 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
# NBA on a particular date
curl -fsS 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261110'
# NBA team directory
curl -fsS 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams'
# NBA standings: IMPORTANT different /apis/v2/ prefix
curl -fsS 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings'
```

## Documentation

- [Endpoint catalog and sport/league slugs](endpoints.md)
- [Response shapes, normalization and pagination](schemas.md)
- [Cloudflare Workers implementation and production safety](integration.md)
- [Executable real-HTTP smoke test](../../scripts/espn-api-smoke.mjs) — no mocks, no credentials; run `node scripts/espn-api-smoke.mjs` from repository root

## API families

| Host | Pattern | Typical purpose | Confidence |
| --- | --- | --- | --- |
| `site.api.espn.com` | `/apis/site/v2/sports/{sport}/{league}/scoreboard` | Scores, fixtures, events | Community-documented |
| `site.api.espn.com` | `/apis/site/v2/sports/{sport}/{league}/teams` | Team directory | Community-documented |
| `site.api.espn.com` | `/apis/site/v2/sports/{sport}/{league}/summary?event={id}` | Event details, box score | Community-documented; varies by sport |
| `site.api.espn.com` | `/apis/v2/sports/{sport}/{league}/standings` | Standings | Community-documented; distinct route |
| `sports.core.api.espn.com` | `/v2/sports/{sport}/leagues/{league}/...` | Detailed linked resources | Community-documented; different schemas |
| `site.web.api.espn.com` | `/apis/common/v3/sports/{sport}/{league}/athletes/{id}/stats` | Player statistics | Community-documented; availability varies |
| `cdn.espn.com` | `/core/{sport}/game?xhr=1&gameId={id}` | Game package | Community-documented; varies by sport |

**Avoid assuming a v3 Site API route exists just because v2 works.** Do not assume Site v2 athlete routes work. Standings on `/apis/site/v2/` may return a stub; use `/apis/v2/`.

## Recommended usage policy

- Cache aggressively: historical final games hours/days; schedules minutes; live scores cautiously and according to provider permissions. Do not poll per visitor.
- Make requests from a backend with timeouts, concurrency caps, retries with jitter only for transient failures, and a circuit breaker. Honor 429 and `Retry-After`; never evade blocks.
- Validate JSON and required fields. `200 OK` with an empty or altered payload is not proof of usable data.
- Identify source, fetch time, and stale status in your own API. Never fabricate scores or silently substitute incomplete data.
- Keep stable internal team/event identifiers; ESPN IDs are not BALLDONTLIE IDs.
- Limit upstream traffic and confirm permitted reuse, redistribution, attribution, logos and trademarks separately.

## Sources and further reading

- [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API) — community route inventory, sport coverage, quirks.
- [0xShakhawat/ESPN-API](https://github.com/0xShakhawat/ESPN-API) — community catalogs, live-probe methodology, Core API reference.
- [machina-sports ESPN reference](https://github.com/machina-sports/sports-skills/blob/main/skills/espn-api/references/endpoints.md) — route patterns and cautions.

These are **third-party references**, not ESPN official API documentation. The examples and implementation guidance here are original to this repository.
