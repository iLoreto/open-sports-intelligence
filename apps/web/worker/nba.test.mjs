import assert from 'node:assert/strict';
import test from 'node:test';
import { completedMeetings, injuryMap, scanNbaComparisons, standingsByTeam, teamStats } from './nba.ts';

const home = { id: '1', homeAway: 'home', team: { id: '1', abbreviation: 'AAA', displayName: 'Alpha Aces' }, score: '108' };
const away = { id: '2', homeAway: 'away', team: { id: '2', abbreviation: 'BBB', displayName: 'Beta Bears' }, score: '99' };
const stats = [
  { name: 'overall', summary: '6-2' },
  { name: 'Last Ten Games', summary: '6-2' },
  { name: 'Home', summary: '4-0' },
  { name: 'Road', summary: '2-2' },
  { name: 'avgPointsFor', value: 111.2 },
  { name: 'avgPointsAgainst', value: 104.7 },
  { name: 'differential', value: 6.5 }
];

test('maps standings and keeps unavailable metrics null', () => {
  const standings = standingsByTeam({ children: [{ standings: { entries: [{ team: home.team, stats }] } }] });
  const result = teamStats(home, standings.get('1'));
  assert.equal(result.lastTen, '6-2');
  assert.equal(result.homeRecord, '4-0');
  assert.equal(result.awayRecord, '2-2');
  assert.equal(result.pointsFor, 111.2);
  assert.equal(result.differential, 6.5);
  assert.equal(result.streak, null);
  assert.equal(teamStats(away).pointsAgainst, null);
});

test('includes only completed head-to-head fixtures with actual scores', () => {
  const played = {
    date: '2026-10-25T23:00:00Z',
    competitions: [{ status: { type: { completed: true } }, competitors: [home, away] }]
  };
  const incomplete = { ...played, competitions: [{ competitors: [home, away] }] };
  const anotherTeam = { ...played, competitions: [{ status: { type: { completed: true } }, competitors: [home, { ...away, id: '3', team: { id: '3' } }] }] };
  assert.deepEqual(completedMeetings({ events: [played, incomplete, anotherTeam] }, '1', '2'), [{
    date: played.date, homeId: '1', awayId: '2', homeScore: 108, awayScore: 99, winnerId: '1'
  }]);
});

test('injuries are reports, never fabricated availability', () => {
  const map = injuryMap({ injuries: [{ id: '1', injuries: [
    { athlete: { displayName: 'Player One' }, status: 'Out', shortComment: 'Left ankle', date: '2026-11-01T10:00:00Z' },
    { athlete: {}, status: 'Out' }
  ] }] });
  assert.equal(map.get('1')?.length, 1);
  assert.equal(map.get('1')?.[0].status, 'Out');
  assert.equal(map.has('2'), false);
});

test('produces a dated comparison, separates missing sources and excludes preseason', async () => {
  const originalFetch = globalThis.fetch;
  const event = {
    id: 'game-1', date: '2026-11-02T01:00:00Z', season: { year: 2027, type: 2 },
    status: { type: { state: 'pre', shortDetail: '8:00 PM ET' } },
    competitions: [{ competitors: [home, away] }]
  };
  const preseason = { ...event, id: 'preseason', season: { year: 2027, type: 1 } };
  const requested = [];
  globalThis.fetch = async (url) => {
    const key = String(url);
    requested.push(key);
    let body;
    if (key.includes('scoreboard?dates=20261101')) body = { events: [event, preseason] };
    else if (key.includes('scoreboard?dates=20261102')) body = { events: [] };
    else if (key.includes('/standings?')) body = { children: [{ standings: { entries: [{ team: home.team, stats }] } }] };
    else if (key.endsWith('/injuries')) return new Response('unavailable', { status: 503 });
    else if (key.includes('/schedule?')) body = { events: [] };
    else return new Response('unknown path', { status: 404 });
    return Response.json(body);
  };
  try {
    const result = await scanNbaComparisons(new Date('2026-11-01T20:00:00Z'));
    assert.equal(result.season, 2027);
    assert.equal(result.games.length, 1);
    assert.equal(result.games[0].gameId, 'game-1');
    assert.equal(result.games[0].away.pointsFor, null);
    assert.equal(result.games[0].home.pointsFor, 111.2);
    assert.equal(result.games[0].injuries.available, false);
    assert.ok(result.warnings.some((message) => message.includes('Injury')));
    assert.equal(result.counts.partialCoverage, true);
    assert.ok(requested.some((url) => url.includes('season=2026&seasontype=2')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
