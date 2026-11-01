import assert from 'node:assert/strict';
import test from 'node:test';
import { nbaBaseline } from './nba-baseline.ts';
import { carryoverRatings, probability, replaySeason, scorePredictions } from './elo.ts';
import { completedRegularGames, currentEloSnapshot, forecast, seasonMonths } from './nba-model.ts';

const completed = (id, date, homeScore, awayScore) => ({
  id, date, season: 2027, homeId: '1', awayId: '2', homeScore, awayScore
});

test('pregame predictions are scored before ratings update, with home advantage', () => {
  const first = completed('first', '2026-10-21T00:00:00Z', 110, 105);
  const second = completed('second', '2026-10-22T00:00:00Z', 105, 112);
  const { ratings, evaluated } = replaySeason([second, first]);
  assert.ok(Math.abs(evaluated[0].predictedHome - probability(1500, 1500)) < 1e-12);
  assert.equal(evaluated[0].homeWon, 1);
  assert.ok(evaluated[1].predictedHome > evaluated[0].predictedHome);
  assert.ok(Math.abs(ratings['1'] + ratings['2'] - 3000) < 1e-8);
  assert.equal(carryoverRatings({ '1': 1600 })['1'], 1570);
});

test('backtest is a full held-out season with independently sourced baseline', () => {
  assert.deepEqual(nbaBaseline.trainingSeasons, [2024, 2025]);
  assert.equal(nbaBaseline.validationSeason, 2026);
  assert.equal(nbaBaseline.validation.games, 1230);
  assert.equal(nbaBaseline.trainingGames, 2460);
  assert.equal(nbaBaseline.validation.calibration.reduce((sum, row) => sum + row.games, 0), 1230);
  assert.ok(nbaBaseline.validation.brier < nbaBaseline.validation.baselineBrier);
  assert.ok(nbaBaseline.validation.logLoss < nbaBaseline.validation.baselineLogLoss);
  const scores = scorePredictions([{ game: completed('1', '2026-11-01T00:00:00Z', 101, 99), predictedHome: 0.7, homeWon: 1 }], 0.55);
  assert.ok(Math.abs(scores.brier - 0.09) < 1e-10);
});

test('only finished, normal regular-season NBA games enter the model', () => {
  const event = {
    id: 'nba-1', date: '2026-10-24T22:00:00Z', season: { year: 2027, type: 2 },
    status: { type: { completed: true } },
    competitions: [{ type: { abbreviation: 'STD' }, competitors: [
      { homeAway: 'home', team: { id: '1' }, score: '107' },
      { homeAway: 'away', team: { id: '2' }, score: '98' }
    ] }]
  };
  const future = { ...event, id: 'future', date: '2026-11-20T22:00:00Z' };
  const cupFinal = { ...event, id: 'cup', competitions: [{ ...event.competitions[0], type: { abbreviation: 'CC' } }] };
  const allStar = { ...event, id: 'star', competitions: [{ ...event.competitions[0], type: { abbreviation: 'ALLSTAR' } }] };
  const live = { ...event, id: 'live', status: { type: { completed: false } } };
  const actual = completedRegularGames([event, future, cupFinal, allStar, live], 2027, new Date('2026-11-01T22:00:00Z'));
  assert.equal(actual.length, 1);
  assert.equal(actual[0].id, 'nba-1');
});

test('month coverage respects NBA season boundary and LA time zone', () => {
  assert.deepEqual(seasonMonths(2027, new Date('2026-11-01T23:00:00Z')), ['202610', '202611']);
  assert.deepEqual(seasonMonths(2027, new Date('2026-10-01T06:00:00Z')), []); // September 30 Pacific.
  assert.deepEqual(seasonMonths(2027, new Date('2027-01-10T22:00:00Z')), ['202610', '202611', '202612', '202701']);
  assert.deepEqual(seasonMonths(2027, new Date('2027-10-20T22:00:00Z')), []); // New season: retrain.
});

test('forecast is complementary and retains team-rating provenance', () => {
  const result = forecast('1', '2', { '1': 1640, '2': 1490 });
  assert.ok(result.homeWinProbability > 0.5);
  assert.ok(Math.abs(result.homeWinProbability + result.awayWinProbability - 1) < 1e-12);
  assert.equal(result.homeElo, 1640);
  assert.equal(result.awayElo, 1490);
});

test('all current-season month feeds must succeed before public forecasts are available', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('202611')
    ? new Response('upstream unavailable', { status: 503 })
    : Response.json({ events: [] });
  try {
    await assert.rejects(currentEloSnapshot(new Date('2026-11-01T23:00:00Z')), /ESPN month 202611/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
