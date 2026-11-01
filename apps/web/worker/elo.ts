/** Small, reproducible NBA Elo baseline. No sportsbooks, odds, or customer data. */
export interface CompletedNbaGame {
  id: string;
  date: string;
  season: number;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

export interface EloSettings {
  k: number;
  homeAdvantage: number;
  scale: number;
  carryover: number;
}

export const ELO_SETTINGS: EloSettings = {
  k: 20,
  homeAdvantage: 65,
  scale: 400,
  carryover: 0.7
};

export interface EvaluatedGame { game: CompletedNbaGame; predictedHome: number; homeWon: number }

export function probability(homeRating: number, awayRating: number, settings = ELO_SETTINGS): number {
  return 1 / (1 + 10 ** ((awayRating - homeRating - settings.homeAdvantage) / settings.scale));
}

export function carryoverRatings(ratings: Record<string, number>, settings = ELO_SETTINGS): Record<string, number> {
  return Object.fromEntries(Object.entries(ratings).map(([id, value]) => [id, 1500 + (value - 1500) * settings.carryover]));
}

/** Updates occur only after each completed game's pregame probability is recorded. */
export function replaySeason(
  games: CompletedNbaGame[],
  startingRatings: Record<string, number> = {},
  settings = ELO_SETTINGS
): { ratings: Record<string, number>; evaluated: EvaluatedGame[] } {
  const ratings = { ...startingRatings };
  const evaluated: EvaluatedGame[] = [];
  for (const game of [...games].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id))) {
    if (game.homeId === game.awayId || game.homeScore === game.awayScore) continue;
    const home = ratings[game.homeId] ?? 1500;
    const away = ratings[game.awayId] ?? 1500;
    const predictedHome = probability(home, away, settings);
    const homeWon = Number(game.homeScore > game.awayScore);
    const change = settings.k * (homeWon - predictedHome);
    ratings[game.homeId] = home + change;
    ratings[game.awayId] = away - change;
    evaluated.push({ game, predictedHome, homeWon });
  }
  return { ratings, evaluated };
}

export function scorePredictions(values: EvaluatedGame[], baselineHomeProbability: number) {
  const clamp = (p: number) => Math.min(1 - 1e-8, Math.max(1e-8, p));
  const brier = (rows: EvaluatedGame[], choose: (row: EvaluatedGame) => number) =>
    rows.reduce((sum, row) => sum + (choose(row) - row.homeWon) ** 2, 0) / Math.max(1, rows.length);
  const logLoss = (rows: EvaluatedGame[], choose: (row: EvaluatedGame) => number) =>
    rows.reduce((sum, row) => {
      const p = clamp(choose(row));
      return sum - row.homeWon * Math.log(p) - (1 - row.homeWon) * Math.log(1 - p);
    }, 0) / Math.max(1, rows.length);
  const calibration = Array.from({ length: 10 }, (_, i) => {
    const low = i * 0.1;
    const high = low + 0.1;
    const rows = values.filter((row) => row.predictedHome >= low && (i === 9 ? row.predictedHome <= high : row.predictedHome < high));
    return {
      bucket: `${Math.round(low * 100)}–${Math.round(high * 100)}%`,
      games: rows.length,
      predicted: rows.length ? rows.reduce((sum, row) => sum + row.predictedHome, 0) / rows.length : null,
      observed: rows.length ? rows.reduce((sum, row) => sum + row.homeWon, 0) / rows.length : null
    };
  });
  return {
    games: values.length,
    brier: brier(values, (row) => row.predictedHome),
    baselineBrier: brier(values, () => baselineHomeProbability),
    logLoss: logLoss(values, (row) => row.predictedHome),
    baselineLogLoss: logLoss(values, () => baselineHomeProbability),
    homeWinRate: values.reduce((sum, row) => sum + row.homeWon, 0) / Math.max(1, values.length),
    calibration
  };
}
