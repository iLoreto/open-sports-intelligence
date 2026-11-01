import { nbaBaseline } from './nba-baseline.ts';
import { probability, replaySeason, type CompletedNbaGame } from './elo.ts';

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

export interface NbaEloForecast {
  homeWinProbability: number;
  awayWinProbability: number;
  homeElo: number;
  awayElo: number;
}

export interface NbaEloMetadata {
  name: string;
  trainedThroughSeason: number;
  forecastSeason: number;
  validationSeason: number;
  validationGames: number;
  brier: number;
  baselineBrier: number;
  logLoss: number;
  baselineLogLoss: number;
  baselineHomeProbability: number;
  trainingGames: number;
  currentSeasonGames: number;
  resultsThrough: string | null;
  calibration: Array<{ bucket: string; games: number; predicted: number | null; observed: number | null }>;
  available: boolean;
  message: string;
}

export function modelMetadata(currentSeasonGames = 0, resultsThrough: string | null = null): NbaEloMetadata {
  const a = nbaBaseline;
  return {
    name: a.model, trainedThroughSeason: a.trainedThroughSeason,
    forecastSeason: a.forecastSeason, validationSeason: a.validationSeason,
    validationGames: a.validation.games, brier: a.validation.brier,
    baselineBrier: a.validation.baselineBrier, logLoss: a.validation.logLoss,
    baselineLogLoss: a.validation.baselineLogLoss,
    baselineHomeProbability: a.baselineHomeProbability, trainingGames: a.trainingGames,
    currentSeasonGames, resultsThrough,
    calibration: a.validation.calibration.map((bucket) => ({ ...bucket })),
    available: false, message: 'Current-season data not yet verified.'
  };
}

/** Parse ESPN's STD classification: excludes Cup finals and All-Star events. */
export function completedRegularGames(events: unknown[], season: number, now: Date): CompletedNbaGame[] {
  const result: CompletedNbaGame[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as {
      id?: string; date?: string; season?: { type?: number; year?: number };
      status?: { type?: { completed?: boolean } };
      competitions?: Array<{
        type?: { abbreviation?: string };
        status?: { type?: { completed?: boolean } };
        competitors?: Array<{ homeAway?: string; team?: { id?: string }; score?: string | number }>;
      }>;
    };
    const competition = event.competitions?.[0];
    if (!event.id || !event.date || event.season?.year !== season || event.season?.type !== 2) continue;
    if (competition?.type?.abbreviation !== 'STD') continue;
    if (!event.status?.type?.completed && !competition.status?.type?.completed) continue;
    if (!Number.isFinite(Date.parse(event.date)) || Date.parse(event.date) > now.getTime()) continue;
    const home = competition.competitors?.find((competitor) => competitor.homeAway === 'home');
    const away = competition.competitors?.find((competitor) => competitor.homeAway === 'away');
    const homeScore = Number(home?.score);
    const awayScore = Number(away?.score);
    if (!home?.team?.id || !away?.team?.id || home?.score == null || away?.score == null) continue;
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    result.push({ id: event.id, date: event.date, season, homeId: home.team.id, awayId: away.team.id, homeScore, awayScore });
  }
  return result;
}

/** Months since the October season opener, inclusive. */
export function seasonMonths(forecastSeason: number, now: Date): string[] {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit'
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const first = (forecastSeason - 1) * 12 + 9; // October is zero-based month 9.
  const last = year * 12 + month - 1;
  if (last < first || last - first > 9) return [];
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const ordinal = first + i;
    return `${Math.floor(ordinal / 12)}${String(ordinal % 12 + 1).padStart(2, '0')}`;
  });
}

export function forecast(homeId: string, awayId: string, ratings: Record<string, number>): NbaEloForecast {
  const homeElo = ratings[homeId] ?? 1500;
  const awayElo = ratings[awayId] ?? 1500;
  const homeWinProbability = probability(homeElo, awayElo);
  return { homeWinProbability, awayWinProbability: 1 - homeWinProbability, homeElo, awayElo };
}

export async function currentEloSnapshot(now = new Date()): Promise<{
  ratings: Record<string, number>;
  metadata: NbaEloMetadata;
}> {
  const months = seasonMonths(nbaBaseline.forecastSeason, now);
  if (!months.length) throw new Error('Model requires retraining for the current NBA season.');
  const retrieved = await Promise.all(months.map(async (month) => {
    const response = await fetch(`${ESPN_SCOREBOARD}?dates=${month}&limit=500`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`ESPN month ${month} returned HTTP ${response.status}`);
    const data: { events?: unknown[] } = await response.json();
    if (!Array.isArray(data.events)) throw new Error(`ESPN month ${month} has no events array`);
    return data.events;
  }));
  const games = new Map<string, CompletedNbaGame>();
  for (const events of retrieved) for (const game of completedRegularGames(events, nbaBaseline.forecastSeason, now)) {
    games.set(game.id, game);
  }
  const played = [...games.values()];
  const { ratings } = replaySeason(played, { ...nbaBaseline.initialRatings });
  const resultsThrough = played.length ? played.reduce((latest, game) => game.date > latest ? game.date : latest, played[0].date) : null;
  const metadata = modelMetadata(played.length, resultsThrough);
  metadata.available = true;
  metadata.message = 'Experimental pregame Elo probabilities, not calibrated betting odds or evidence of a market edge.';
  return { ratings, metadata };
}
