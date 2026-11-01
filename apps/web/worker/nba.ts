/**
 * Read-only NBA comparison feed. All basketball figures come from ESPN's
 * publicly accessible scoreboard, standings, schedule and injury feeds.
 * These are descriptive statistics, NOT independent win probabilities.
 * ESPN's JSON endpoints are not a guaranteed public API: upstream failures
 * are surfaced, never replaced with fabricated estimates.
 */

import { currentEloSnapshot, forecast, modelMetadata, type NbaEloForecast, type NbaEloMetadata } from './nba-model.ts';

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const CACHE_SECONDS = 30 * 60;
const MAX_GAMES = 16;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface EspnStat { name?: string; value?: number; displayValue?: string; summary?: string }
interface EspnTeam { id?: string; displayName?: string; abbreviation?: string; shortDisplayName?: string }
interface EspnCompetitor {
  id?: string;
  homeAway?: string;
  team?: EspnTeam;
  score?: string | number | { value?: number; displayValue?: string };
  records?: Array<{ name?: string; summary?: string }>;
}
interface EspnEvent {
  id?: string;
  date?: string;
  season?: { year?: number; type?: number };
  status?: { type?: { state?: string; completed?: boolean; detail?: string; shortDetail?: string } };
  competitions?: Array<{
    competitors?: EspnCompetitor[];
    status?: { type?: { state?: string; completed?: boolean; detail?: string; shortDetail?: string } };
  }>;
}
interface EspnScoreboard { events?: EspnEvent[] }
interface EspnStandingEntry { team?: EspnTeam; stats?: EspnStat[] }
interface EspnStandings { children?: Array<{ standings?: { entries?: EspnStandingEntry[] }; children?: EspnStandings['children'] }> }
interface EspnInjury {
  id?: string;
  status?: string;
  date?: string;
  shortComment?: string;
  athlete?: { displayName?: string };
}
interface EspnInjuryFeed {
  timestamp?: string;
  injuries?: Array<{ id?: string; displayName?: string; injuries?: EspnInjury[] }>;
}
interface EspnSchedule { events?: EspnEvent[] }

export interface NbaTeamStats {
  id: string;
  name: string;
  abbreviation: string;
  record: string | null;
  lastTen: string | null;
  homeRecord: string | null;
  awayRecord: string | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  differential: number | null;
  streak: string | null;
}
export interface NbaInjury {
  name: string;
  status: string;
  note: string | null;
  updatedAt: string | null;
}
export interface NbaMeeting {
  date: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  winnerId: string | null;
}
export interface NbaComparison {
  gameId: string;
  startTime: string;
  status: 'scheduled' | 'live' | 'final';
  statusDetail: string;
  home: NbaTeamStats;
  away: NbaTeamStats;
  homeScore: number | null;
  awayScore: number | null;
  injuries: {
    home: NbaInjury[];
    away: NbaInjury[];
    reportedAt: string | null;
    available: boolean;
  };
  headToHead: {
    meetings: NbaMeeting[];
    homeWins: number;
    awayWins: number;
    partial: boolean;
  };
  /** Available only before tipoff, after all current-season model inputs load. */
  forecast?: NbaEloForecast | null;
}
export interface NbaComparisonResponse {
  source: 'ESPN public basketball feeds';
  fetchedAt: string;
  season: number;
  window: { startsOn: string; endsBefore: string; timeZone: 'America/Los_Angeles' };
  games: NbaComparison[];
  counts: { eligibleGames: number; returnedGames: number; partialCoverage: boolean };
  warnings: string[];
  notes: string[];
  model?: NbaEloMetadata;
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function score(value: EspnCompetitor['score']): number | null {
  if (typeof value === 'object' && value !== null) return num(value.value ?? value.displayValue);
  return num(value);
}

function stat(stats: EspnStat[] | undefined, name: string): EspnStat | undefined {
  return stats?.find((row) => row.name === name);
}

function textStat(stats: EspnStat[] | undefined, ...names: string[]): string | null {
  // ESPN's record labels differ from its numeric metrics (e.g. "Last Ten Games").
  const value = stats?.find((row) => names.includes(row.name ?? ''));
  return value?.summary || value?.displayValue || null;
}

function recordFromCompetitor(competitor: EspnCompetitor): string | null {
  return competitor.records?.find((r) => r.name === 'overall')?.summary ?? null;
}

/** Keeps the scoreboard's record as fallback if a standings entry is absent. */
export function teamStats(competitor: EspnCompetitor, standings?: EspnStandingEntry): NbaTeamStats {
  const stats = standings?.stats;
  const team = competitor.team ?? {};
  return {
    id: team.id || competitor.id || '',
    name: team.displayName || standings?.team?.displayName || team.abbreviation || 'Unknown team',
    abbreviation: team.abbreviation || standings?.team?.abbreviation || '—',
    record: textStat(stats, 'overall') || recordFromCompetitor(competitor),
    lastTen: textStat(stats, 'Last Ten Games', 'lasttengames'),
    homeRecord: textStat(stats, 'Home', 'home'),
    awayRecord: textStat(stats, 'Road', 'road'),
    pointsFor: num(stat(stats, 'avgPointsFor')?.value),
    pointsAgainst: num(stat(stats, 'avgPointsAgainst')?.value),
    differential: num(stat(stats, 'differential')?.value),
    streak: textStat(stats, 'streak')
  };
}

function standingEntries(data: EspnStandings): EspnStandingEntry[] {
  const collect = (groups: EspnStandings['children']): EspnStandingEntry[] =>
    (groups ?? []).flatMap((group) => [...(group.standings?.entries ?? []), ...collect(group.children)]);
  return collect(data.children);
}

export function standingsByTeam(data: EspnStandings): Map<string, EspnStandingEntry> {
  return new Map(standingEntries(data).filter((entry) => entry.team?.id).map((entry) => [entry.team!.id!, entry]));
}

function validInjury(item: EspnInjury): NbaInjury | null {
  if (!item.athlete?.displayName || !item.status) return null;
  return {
    name: item.athlete.displayName,
    status: item.status,
    note: item.shortComment?.slice(0, 280) ?? null,
    updatedAt: item.date ?? null
  };
}

export function injuryMap(feed: EspnInjuryFeed): Map<string, NbaInjury[]> {
  return new Map((feed.injuries ?? []).filter((team) => team.id).map((team) => [
    team.id!, (team.injuries ?? []).map(validInjury).filter((x): x is NbaInjury => x !== null)
  ]));
}

/** Only completed regular-season games between the exact two team IDs count. */
export function completedMeetings(schedule: EspnSchedule, firstId: string, secondId: string): NbaMeeting[] {
  const meetings: NbaMeeting[] = [];
  for (const event of schedule.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition?.status?.type?.completed && !event.status?.type?.completed) continue;
    const home = competition?.competitors?.find((c) => c.homeAway === 'home');
    const away = competition?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away || !event.date) continue;
    const homeId = home.team?.id ?? home.id ?? '';
    const awayId = away.team?.id ?? away.id ?? '';
    if (!((homeId === firstId && awayId === secondId) || (homeId === secondId && awayId === firstId))) continue;
    const homeScore = score(home.score);
    const awayScore = score(away.score);
    if (homeScore === null || awayScore === null) continue;
    meetings.push({
      date: event.date,
      homeId,
      awayId,
      homeScore,
      awayScore,
      winnerId: homeScore === awayScore ? null : homeScore > awayScore ? homeId : awayId
    });
  }
  return meetings;
}

function laDate(timestamp: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(timestamp);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function tomorrow(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + ONE_DAY_MS).toISOString().slice(0, 10);
}

async function espnJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`ESPN responded HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function isoDateKey(date: string): string { return date.replace(/-/g, ''); }

function statusFor(event: EspnEvent): NbaComparison['status'] {
  const state = event.status?.type?.state ?? event.competitions?.[0]?.status?.type?.state;
  return state === 'post' ? 'final' : state === 'in' ? 'live' : 'scheduled';
}

function eventTeams(event: EspnEvent): { home: EspnCompetitor; away: EspnCompetitor } | null {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  return home?.team?.id && away?.team?.id ? { home, away } : null;
}

export async function scanNbaComparisons(now = new Date()): Promise<NbaComparisonResponse> {
  const today = laDate(now);
  const nextDay = tomorrow(today);
  const month = Number(today.slice(5, 7));
  const season = Number(today.slice(0, 4)) + (month >= 10 ? 1 : 0);
  const fetchedAt = new Date().toISOString();
  const endpoints = [
    `${ESPN_SITE}/scoreboard?dates=${isoDateKey(today)}&limit=100`,
    `${ESPN_SITE}/scoreboard?dates=${isoDateKey(nextDay)}&limit=100`,
    `${ESPN_STANDINGS}?season=${season}`,
    `${ESPN_SITE}/injuries`
  ];
  const [todayResult, tomorrowResult, standingResult, injuryResult] = await Promise.allSettled([
    espnJson<EspnScoreboard>(endpoints[0]), espnJson<EspnScoreboard>(endpoints[1]),
    espnJson<EspnStandings>(endpoints[2]), espnJson<EspnInjuryFeed>(endpoints[3])
  ]);
  if (todayResult.status === 'rejected' && tomorrowResult.status === 'rejected') {
    throw new Error('Both NBA scoreboard requests failed');
  }

  const warnings: string[] = [];
  if (todayResult.status === 'rejected' || tomorrowResult.status === 'rejected') warnings.push('One scoreboard day could not be retrieved.');
  if (standingResult.status === 'rejected') warnings.push('Team standings are unavailable; only scoreboard records will be shown.');
  if (injuryResult.status === 'rejected') warnings.push('Injury reports are unavailable; no player status is inferred.');
  const standings = standingResult.status === 'fulfilled' ? standingsByTeam(standingResult.value) : new Map<string, EspnStandingEntry>();
  const injuryFeed = injuryResult.status === 'fulfilled' ? injuryResult.value : null;
  const injuries = injuryFeed ? injuryMap(injuryFeed) : new Map<string, NbaInjury[]>();

  const events = [
    ...(todayResult.status === 'fulfilled' ? todayResult.value.events ?? [] : []),
    ...(tomorrowResult.status === 'fulfilled' ? tomorrowResult.value.events ?? [] : [])
  ];
  const unique = new Map<string, EspnEvent>();
  for (const event of events) {
    if (!event.id || !event.date || !eventTeams(event)) continue;
    // ESPN also publishes preseason and tournament exhibition fixtures.
    if (event.season?.type !== 2) continue;
    const day = laDate(new Date(event.date));
    if (day !== today && day !== nextDay) continue;
    if (Date.parse(event.date) > now.getTime() + ONE_DAY_MS) continue;
    unique.set(event.id, event);
  }
  const eligible = [...unique.values()].sort((a, b) => {
    const first = statusFor(a) === 'final' ? 1 : 0;
    const second = statusFor(b) === 'final' ? 1 : 0;
    return first - second || Date.parse(a.date!) - Date.parse(b.date!);
  });
  const selected = eligible.slice(0, MAX_GAMES);
  if (eligible.length > MAX_GAMES) warnings.push(`Only ${MAX_GAMES} of ${eligible.length} games fit the current response limit.`);

  const games = await Promise.all(selected.map(async (event): Promise<NbaComparison> => {
    const { home, away } = eventTeams(event)!;
    const homeId = home.team!.id!;
    const awayId = away.team!.id!;
    const schedules = await Promise.allSettled([
      espnJson<EspnSchedule>(`${ESPN_SITE}/teams/${homeId}/schedule?season=${season}&seasontype=2`),
      espnJson<EspnSchedule>(`${ESPN_SITE}/teams/${homeId}/schedule?season=${season - 1}&seasontype=2`)
    ]);
    const found = new Map<string, NbaMeeting>();
    for (const result of schedules) {
      if (result.status !== 'fulfilled') continue;
      for (const meeting of completedMeetings(result.value, homeId, awayId)) {
        found.set(`${meeting.date}-${meeting.homeId}-${meeting.awayId}`, meeting);
      }
    }
    const meetings = [...found.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5);
    const state = statusFor(event);
    return {
      gameId: event.id!,
      startTime: event.date!,
      status: state,
      statusDetail: event.status?.type?.shortDetail || event.competitions?.[0]?.status?.type?.shortDetail || state,
      home: teamStats(home, standings.get(homeId)),
      away: teamStats(away, standings.get(awayId)),
      homeScore: state === 'scheduled' ? null : score(home.score),
      awayScore: state === 'scheduled' ? null : score(away.score),
      injuries: {
        home: injuries.get(homeId) ?? [], away: injuries.get(awayId) ?? [],
        reportedAt: injuryFeed?.timestamp ?? null,
        available: !!injuryFeed && injuries.has(homeId) && injuries.has(awayId)
      },
      headToHead: {
        meetings,
        homeWins: meetings.filter((meeting) => meeting.winnerId === homeId).length,
        awayWins: meetings.filter((meeting) => meeting.winnerId === awayId).length,
        partial: schedules.some((result) => result.status === 'rejected')
      }
    };
  }));
  if (games.some((game) => game.headToHead.partial)) warnings.push('Some head-to-head schedules could not be retrieved.');
  return {
    source: 'ESPN public basketball feeds', fetchedAt, season,
    window: { startsOn: today, endsBefore: tomorrow(nextDay), timeZone: 'America/Los_Angeles' },
    games,
    counts: { eligibleGames: eligible.length, returnedGames: games.length, partialCoverage: warnings.length > 0 },
    warnings,
    notes: [
      'Team statistics and reported injuries are descriptive; the separate experimental Elo forecast uses final game scores only.',
      'Head-to-head includes up to five completed regular-season meetings across this and last season.',
      'Injuries are reports, not verified starting lineups. Elo probabilities are not verified market edges or Vegas money splits.'
    ]
  };
}

export async function handleNbaComparisons(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fresh = url.searchParams.get('fresh') === '1';
  const cacheKey = new Request(new URL('/api/nba/comparisons', url.origin).toString());
  const cache = (caches as CacheStorage & { default: Cache }).default;
  if (!fresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  try {
    // Ratings are built concurrently with matchup data; an unavailable model
    // never prevents publication of the underlying sourced comparisons.
    const [comparisonResult, modelResult] = await Promise.allSettled([
      scanNbaComparisons(), currentEloSnapshot()
    ]);
    if (comparisonResult.status === 'rejected') throw comparisonResult.reason;
    const result = comparisonResult.value;
    result.model = modelMetadata();
    if (modelResult.status === 'fulfilled' && result.season === modelResult.value.metadata.forecastSeason) {
      result.model = modelResult.value.metadata;
      for (const game of result.games) {
        game.forecast = game.status === 'scheduled'
          ? forecast(game.home.id, game.away.id, modelResult.value.ratings) : null;
      }
    } else {
      result.model.message = 'Pregame projections unavailable; current-season results could not be fully verified.';
      result.warnings.push('NBA Elo model unavailable; sourced matchup statistics remain visible.');
    }
    result.counts.partialCoverage = result.warnings.length > 0;
    const ttl = result.counts.partialCoverage ? 300 : CACHE_SECONDS;
    const response = Response.json(result, {
      headers: { 'Cache-Control': `public, max-age=0, s-maxage=${ttl}`, 'X-Content-Type-Options': 'nosniff' }
    });
    try { await cache.put(cacheKey, response.clone()); } catch { /* live result remains usable */ }
    return response;
  } catch (error) {
    console.error('NBA comparison feed failed', error);
    return Response.json({ error: 'NBA comparison data temporarily unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
