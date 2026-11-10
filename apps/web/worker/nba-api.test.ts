import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.ts';

const originalFetch = globalThis.fetch;
const assets = { fetch: async () => new Response('asset') };
const request = () => new Request('https://example.test/api/nba/compare?left=2&right=6&sample=5');
const game = (id: number, home: number, visitor: number, hs: number, vs: number) => ({ id, date: '2026-11-01', status: 'Final', home_team: { id: home, full_name: '' }, visitor_team: { id: visitor, full_name: '' }, home_team_score: hs, visitor_team_score: vs });

test('configured runtime key authenticates to BALLDONTLIE and returns actual parsed game stats', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get('Authorization'), 'test-secret');
    const id = String(input).includes('team_ids%5B%5D=6') || String(input).includes('team_ids[]=6') ? 6 : 2;
    return Response.json({ data: [id === 2 ? game(1, 2, 6, 110, 100) : game(2, 6, 2, 101, 99)] });
  };
  try {
    const response = await worker.fetch(request(), { ASSETS: assets, BALLDONTLIE_API_KEY: 'test-secret' });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.source, 'BALLDONTLIE NBA API');
    assert.equal(body.left.games, 1);
    assert.equal(body.right.games, 1);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid BALLDONTLIE credentials return provider failure rather than fabricated statistics', async () => {
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
  try {
    const response = await worker.fetch(request(), { ASSETS: assets, BALLDONTLIE_API_KEY: 'bad-key' });
    assert.equal(response.status, 502);
    assert.match((await response.json() as any).message, /401/);
  } finally { globalThis.fetch = originalFetch; }
});

test('runtime status does not disclose the API key', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/nba/config-status'), { ASSETS: assets, BALLDONTLIE_API_KEY: 'super-private-key' });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"keyConfigured":true/);
  assert.doesNotMatch(body, /super-private-key/);
});
