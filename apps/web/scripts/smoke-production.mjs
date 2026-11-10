#!/usr/bin/env node
// Real HTTP smoke tests: no mocks and no credentials printed.
const base = (process.env.SMOKE_BASE_URL || 'https://open-sports-intelligence.iloreto97.workers.dev').replace(/\/$/, '');
const request = async path => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
  let body;
  try { body = await response.json(); } catch { throw new Error(path + ': non-JSON response, HTTP ' + response.status); }
  if (!response.ok) throw new Error(path + ': HTTP ' + response.status + ', code=' + (body.code || 'none') + ', message=' + (body.message || body.error || 'none'));
  return body;
};
const fail = message => { throw new Error(message); };
try {
  const teams = await request('/api/nba/teams');
  if (!Array.isArray(teams.teams) || !teams.teams.some(t => t.id === 2) || !teams.teams.some(t => t.id === 6)) fail('NBA team directory invalid');
  console.log('PASS: deployed NBA team directory');
  const status = await request('/api/nba/config-status');
  if (typeof status.keyConfigured !== 'boolean') fail('Invalid runtime provider configuration status');
  console.log('INFO: optional BALLDONTLIE binding ' + (status.keyConfigured ? 'configured' : 'not configured; ESPN fallback expected'));
  const comparison = await request('/api/nba/compare?left=2&right=6&sample=5');
  for (const side of ['left','right']) {
    const stats = comparison[side];
    if (!stats || !Number.isInteger(stats.games) || stats.games < 1 || stats.games > 5 || stats.wins + stats.losses + (stats.ties || 0) !== stats.games || !Number.isFinite(stats.pointsFor) || !Number.isFinite(stats.pointsAgainst)) fail('Invalid ' + side + ' comparison statistics');
  }
  if (!comparison.source || !comparison.fetchedAt) fail('Missing comparison source/timestamp');
  console.log('PASS: live Boston vs Cleveland comparison, source=' + comparison.source);
} catch (error) {
  console.error('FAIL: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
