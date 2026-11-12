import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyPuckTeams, moneyPuckUrl } from './moneypuck.ts';
const header = 'team,situation,games_played,iceTime,xGoalsFor,xGoalsAgainst,highDangerShotsFor,highDangerShotsAgainst';
const codes = ['ANA','BOS','BUF','CAR','CBJ','CGY','CHI','COL','DAL','DET','EDM','FLA','LAK','MIN','MTL','NJD','NSH','NYI','NYR','OTT','PHI','PIT','SEA','SJS','STL','TBL','TOR','UTA','VAN','VGK','WPG','WSH'];
const fixture = [header, ...codes.flatMap(team => [
  `${team},all,20,72000,50,50,100,100`,
  `${team},5on5,20,36000,30,20,60,40`
])].join('\n');
test('MoneyPuck parser filters five-on-five and computes rates', () => {
  const rows = parseMoneyPuckTeams(fixture);
  assert.equal(rows.size, 32);
  assert.equal(rows.get('TBL')?.xgShare, .6);
  assert.equal(rows.get('TBL')?.xgf60, 3);
  assert.equal(rows.get('TBL')?.xga60, 2);
  assert.equal(rows.get('TBL')?.xgd60, 1);
});
test('MoneyPuck parser rejects missing columns and incomplete coverage', () => {
  assert.throws(() => parseMoneyPuckTeams('team,situation\nTBL,5on5'), /schema/);
  assert.throws(() => parseMoneyPuckTeams([header,'TBL,5on5,1,3600,2,1,4,2'].join('\n')), /Incomplete/);
});
test('MoneyPuck URL uses NHL season start year', () => {
  assert.equal(moneyPuckUrl(2026), 'https://moneypuck.com/moneypuck/playerData/seasonSummary/2026/regular/teams.csv');
});
