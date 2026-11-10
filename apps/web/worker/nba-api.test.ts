import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.ts';

const assets = { fetch: async () => new Response('asset') };
const request = (path: string) => new Request('https://example.test' + path);

test('ESPN-only NBA comparison returns completed-game statistics without credentials', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    assert.match(String(input), /site\.api\.espn\.com/);
    const events = [
      { id: '1001', date: '2026-11-01T20:00:00Z', status: { type: { completed: true } }, competitions: [{ competitors: [
        { homeAway: 'home', team: { abbreviation: 'BOS' }, score: '110' },
        { homeAway: 'away', team: { abbreviation: 'CLE' }, score: '100' }
      ] }] },
      { id: '1002', date: '2026-11-03T20:00:00Z', status: { type: { completed: true } }, competitions: [{ competitors: [
        { homeAway: 'home', team: { abbreviation: 'CLE' }, score: '105' },
        { homeAway: 'away', team: { abbreviation: 'BOS' }, score: '99' }
      ] }] }
    ];
    return Response.json({ events });
  };
  try {
    const response = await worker.fetch(request('/api/nba/compare?left=2&right=6&sample=5'), { ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.source, 'ESPN NBA scoreboard');
    assert.equal(body.left.games, 2);
    assert.equal(body.right.games, 2);
    assert.equal(body.left.wins, 1);
    assert.equal(body.right.wins, 1);
    assert.ok(calls.length > 0);
    assert.ok(calls.every(url => url.includes('site.api.espn.com')));
  } finally { globalThis.fetch = originalFetch; }
});

test('ESPN upstream failures produce 502, not fabricated results', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
  try {
    const response = await worker.fetch(request('/api/nba/compare?left=2&right=6&sample=5'), { ASSETS: assets });
    assert.equal(response.status, 502);
    assert.match((await response.json() as any).message, /503/);
  } finally { globalThis.fetch = originalFetch; }
});

test('obsolete secret configuration endpoint is not available', async () => {
  const response = await worker.fetch(request('/api/nba/config-status'), { ASSETS: assets });
  assert.equal(response.status, 404);
});
