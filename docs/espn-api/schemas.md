# Response shapes and normalization

**Illustrative partial structures** only. These are not official schemas; fields may be absent, null, differently typed or sport-dependent. Validate at runtime.

## Scoreboard

```json
{
  "events": [{
    "id": "401000001",
    "date": "2026-11-10T00:00Z",
    "status": { "type": { "completed": true, "name": "STATUS_FINAL" } },
    "competitions": [{
      "competitors": [
        { "homeAway": "home", "score": "110", "team": { "id": "2", "abbreviation": "BOS", "displayName": "Boston Celtics" } },
        { "homeAway": "away", "score": "100", "team": { "id": "5", "abbreviation": "CLE", "displayName": "Cleveland Cavaliers" } }
      ]
    }]
  }]
}
```

The IDs, date, scores and event are **fabricated schema illustrations**, not an actual game or a claim about ESPN IDs. Use a real response for data.

## Teams

Common nesting: `sports[].leagues[].teams[].team`. Do not assume `teams[]` at the top level. Inspect `team.id`, `team.displayName`, `team.abbreviation`.

## Normalize a completed basketball game

```ts
type NormalizedGame = {
  provider: 'espn';
  providerEventId: string;
  startTimeUtc: string;
  completed: true;
  home: { providerTeamId: string; name: string; score: number };
  away: { providerTeamId: string; name: string; score: number };
};

function normalizeFinal(event: any): NormalizedGame | null {
  if (!event?.status?.type?.completed || typeof event.id !== 'string') return null;
  const competitors = event.competitions?.[0]?.competitors;
  if (!Array.isArray(competitors)) return null;
  const home = competitors.find((c: any) => c.homeAway === 'home');
  const away = competitors.find((c: any) => c.homeAway === 'away');
  if (!home?.team?.id || !away?.team?.id) return null;
  if (!/^\\d+$/.test(String(home.score)) || !/^\\d+$/.test(String(away.score))) return null;
  if (typeof event.date !== 'string' || !Number.isFinite(Date.parse(event.date))) return null;
  return {
    provider: 'espn', providerEventId: event.id, startTimeUtc: event.date,
    completed: true,
    home: { providerTeamId: String(home.team.id), name: String(home.team.displayName ?? ''), score: Number(home.score) },
    away: { providerTeamId: String(away.team.id), name: String(away.team.displayName ?? ''), score: Number(away.score) }
  };
}
```

**Do not use ESPN team IDs as BALLDONTLIE IDs.** In particular, do not derive one provider's ID from array order or abbreviations. Resolve names/IDs through provider directories, store an explicit canonical mapping and test it.

## Last N completed games

1. Query a date window with enough completed games; handle provider limits, pagination and truncation.
2. Normalize each event and deduplicate by `providerEventId`.
3. Filter by canonical team ID, then sort by `startTimeUtc` descending.
4. Take exactly N, or mark the sample partial if fewer than N exist.
5. Compute wins/losses and points-for/against from the team's perspective; account for sport-specific ties and overtime.
6. Return `source`, `fetchedAt`, `sampleRequested`, `sampleActual`, and `stale`.

Never silently mix regular season, playoffs, preseason or different competitions unless the UI explicitly requests it.
