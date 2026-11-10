#!/usr/bin/env node
// Live, read-only ESPN endpoint checks. No mock data or API key.
const root = 'https://site.api.espn.com';
const probes = [
  { name: 'NBA scoreboard', path: '/apis/site/v2/sports/basketball/nba/scoreboard', valid: x => Array.isArray(x.events) },
  { name: 'NBA teams', path: '/apis/site/v2/sports/basketball/nba/teams', valid: x => Array.isArray(x.sports?.[0]?.leagues?.[0]?.teams) && x.sports[0].leagues[0].teams.length >= 25 },
  { name: 'NFL scoreboard', path: '/apis/site/v2/sports/football/nfl/scoreboard', valid: x => Array.isArray(x.events) },
  { name: 'MLB scoreboard', path: '/apis/site/v2/sports/baseball/mlb/scoreboard', valid: x => Array.isArray(x.events) },
  { name: 'NHL scoreboard', path: '/apis/site/v2/sports/hockey/nhl/scoreboard', valid: x => Array.isArray(x.events) },
  { name: 'NBA standings', path: '/apis/v2/sports/basketball/nba/standings', valid: x => x && typeof x === 'object' && (Array.isArray(x.children) || Array.isArray(x.standings?.entries)) },
];
let failed = 0;
for (const p of probes) {
  try {
    const start = Date.now();
    const res = await fetch(root + p.path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!p.valid(data)) throw new Error('unexpected JSON shape');
    console.log('PASS ' + p.name + ' (' + (Date.now() - start) + 'ms)');
  } catch (err) {
    failed++;
    console.error('FAIL ' + p.name + ': ' + (err instanceof Error ? err.message : String(err)));
  }
}
console.log(probes.length - failed + '/' + probes.length + ' live endpoints passed');
if (failed) process.exitCode = 1;
