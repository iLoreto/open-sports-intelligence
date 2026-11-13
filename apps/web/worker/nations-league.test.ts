import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TEAMS, GROUPS, forecast, validateFixtures, validateRegistry } from './nations-league.ts';
test('2026/27 UEFA registry has 54 distinct nations and 14 groups', () => {
  validateRegistry(); assert.equal(ALL_TEAMS.length,54); assert.equal(Object.keys(GROUPS).length,14);
});
const fixture = { id:'A2-1', kickoff:'2026-11-13T20:45:00+01:00', group:'A2' as const, home:'Netherlands', away:'Greece' };
test('forecasts are normalized, independently sourced and sum to one', () => {
  const r=forecast(fixture,[{team:'Netherlands',rating:1660,asOf:'2026-11-12T00:00:00Z',source:'historical results'},{team:'Greece',rating:1573,asOf:'2026-11-12T00:00:00Z',source:'historical results'}],'2026-11-12T12:00:00Z');
  assert.ok(r); assert.ok(Math.abs(r.homeWin+r.draw+r.awayWin-1)<1e-12); assert.ok(r.homeWin>r.awayWin);
});
test('missing or future-dated ratings never become fake forecasts',()=>{
  assert.equal(forecast(fixture,[], '2026-11-12T12:00:00Z'),null);
  assert.equal(forecast(fixture,[{team:'Netherlands',rating:1660,asOf:'2026-11-14T00:00:00Z',source:'future'}], '2026-11-12T12:00:00Z'),null);
  assert.throws(()=>forecast(fixture,[],fixture.kickoff),/Cutoff/);
});
test('rejects duplicate fixtures, invalid pairings and incomplete scores',()=>{
  assert.throws(()=>validateFixtures([fixture,fixture]),/Duplicate fixture/);
  assert.throws(()=>validateFixtures([{...fixture,away:'Italy'}]),/Invalid group/);
  assert.throws(()=>validateFixtures([{...fixture,homeGoals:2}]),/Incomplete result/);
});
