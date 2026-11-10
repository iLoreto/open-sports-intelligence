#!/usr/bin/env node
// Production smoke: ESPN is the sole NBA data provider; no credentials required.
const base = (process.env.SMOKE_BASE_URL || 'https://open-sports-intelligence.iloreto97.workers.dev').replace(/\/$/, '');
const request = async path => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
  let body;
  try { body = await response.json(); } catch { throw new Error(path + ': non-JSON response, HTTP ' + response.status); }
  if (!response.ok) throw new Error(path + ': HTTP ' + response.status + ', message=' + (body.message || body.error || 'none'));
  return body;
};
try {
  const teams = await request('/api/nba/teams');
  if (!Array.isArray(teams.teams) || !teams.teams.some(t => t.id === 2) || !teams.teams.some(t => t.id === 6)) throw new Error('NBA team directory invalid');
  console.log('PASS: deployed NBA team directory');
  const comparison = await request('/api/nba/compare?left=2&right=6&sample=5');
  if (comparison.source !== 'ESPN NBA scoreboard') throw new Error('Unexpected NBA provider: ' + comparison.source);
  for (const side of ['left', 'right']) {
    const stats = comparison[side];
    if (!stats || !Number.isInteger(stats.games) || stats.games < 1 || stats.games > 5 || stats.wins + stats.losses !== stats.games || !Number.isFinite(stats.pointsFor) || !Number.isFinite(stats.pointsAgainst)) throw new Error('Invalid ' + side + ' comparison statistics');
  }
  if (!comparison.fetchedAt) throw new Error('Missing comparison timestamp');
  console.log('PASS: live ESPN NBA comparison, source=' + comparison.source);
} catch (error) {
  console.error('FAIL: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
