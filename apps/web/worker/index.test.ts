import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.ts';

const scoreboardGame = (state: 'in' | 'pre' | 'post', hoursFromNow = 2) => ({
  date: new Date(Date.now() + hoursFromNow * 3600000).toISOString(),
  status: { type: { state, completed: state === 'post' } },
  competitions: [{ competitors: [
    { team: { displayName: 'Boston Celtics', name: 'Celtics' } },
    { team: { displayName: 'Philadelphia 76ers', name: '76ers' } }
  ] }]
});

const assets = { fetch: async () => new Response('asset') };
const request = (path: string, method = 'GET') => new Request('https://example.test' + path, { method });

test('NBA compare returns computed stats from completed team schedule events', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
	const url = String(input);
	calls.push(url);
	assert.match(url, /site\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\/nba\/teams\/(bos|cle)\/schedule\?season=/);
	return Response.json({
	  events: [
		{
		  id: '1001',
		  date: '2026-11-01T20:00:00Z',
		  status: { type: { completed: true } },
		  competitions: [{ competitors: [
			{ homeAway: 'home', team: { abbreviation: 'BOS' }, score: '110' },
			{ homeAway: 'away', team: { abbreviation: 'CLE' }, score: '100' }
		  ] }]
		},
		{
		  id: '1002',
		  date: '2026-11-03T20:00:00Z',
		  status: { type: { completed: true } },
		  competitions: [{ competitors: [
			{ homeAway: 'home', team: { abbreviation: 'CLE' }, score: '105' },
			{ homeAway: 'away', team: { abbreviation: 'BOS' }, score: '99' }
		  ] }]
		},
		{
		  id: '1003',
		  date: '2026-11-05T20:00:00Z',
		  status: { type: { completed: false } },
		  competitions: [{ competitors: [
			{ homeAway: 'home', team: { abbreviation: 'BOS' }, score: '0' },
			{ homeAway: 'away', team: { abbreviation: 'CLE' }, score: '0' }
		  ] }]
		}
	  ]
	});
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
	assert.equal(body.left.recent.length, 2);
	assert.equal(body.partial, true);
	assert.equal(calls.length, 6);
  } finally {
	globalThis.fetch = originalFetch;
  }
});

test('scanner discovers league series, then fetches details only for discovered event IDs', async () => {
  const originalFetch = globalThis.fetch;
  const game = scoreboardGame('in');
  const calls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    if (url.pathname.endsWith('/series')) return Response.json({ series: [
      { ticker: 'KXNBAGAME', title: 'NBA games', category: 'Sports' },
      { ticker: 'KXNFLGAME', title: 'NFL games', category: 'Sports' },
      { ticker: 'KXECON', title: 'Economics', category: 'Economics' }
    ] });
    if (url.pathname.endsWith('/events')) {
      assert.equal(url.searchParams.get('series_ticker'), 'KXNBAGAME');
      return Response.json({ events: [{ event_ticker: 'KXNBAGAME-26NOV16', title: 'Boston at Philadelphia' }], cursor: '' });
    }
    if (url.pathname.endsWith('/markets')) {
      assert.equal(url.searchParams.get('event_ticker'), 'KXNBAGAME-26NOV16');
      return Response.json({ markets: [{ ticker: 'KXNBAGAME-26NOV16-ML', title: 'Yes Boston', status: 'open',
        yes_ask_dollars: '0.58', no_ask_dollars: '0.42' }], cursor: '' });
    }
    throw new Error('Unexpected upstream request: ' + url);
  };
  try {
    const response = await worker.fetch(request('/api/markets/scan?provider=kalshi&league=nba&min=50&max=70', 'POST'), { ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.markets.map((m: any) => [m.side, m.askCents]), [['YES', 58]], JSON.stringify(body));
    assert.equal(body.partialCoverage, false);
    assert.equal(calls.length, 6);
    assert.equal(body.markets[0].gameStatus, 'live');
    assert.ok(calls.every(url => !url.pathname.endsWith('/markets') || url.searchParams.has('event_ticker')));
  } finally { globalThis.fetch = originalFetch; }
});

test('scanner reports incomplete discovery instead of claiming full coverage', async () => {
  const originalFetch = globalThis.fetch;
  const game = scoreboardGame('pre');
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    if (url.pathname.endsWith('/series')) return Response.json({ series: [{ ticker: 'KXNBAGAME', category: 'Sports' }] });
    if (url.pathname.endsWith('/events')) return Response.json({ events: [], cursor: 'more-' + (url.searchParams.get('cursor') || 'first') });
    throw new Error('Unexpected detail call');
  };
  try {
    const response = await worker.fetch(request('/api/markets/scan?provider=kalshi&league=nba&min=1&max=99', 'POST'), { ASSETS: assets });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).partialCoverage, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('scanner excludes events outside 12 hours before requesting market details', async () => {
  const originalFetch = globalThis.fetch;
  const game = scoreboardGame('pre', 24);
  let detailCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    if (url.pathname.endsWith('/series')) return Response.json({ series: [{ ticker: 'KXNBAGAME', category: 'Sports' }] });
    if (url.pathname.endsWith('/events')) return Response.json({ events: [{ event_ticker: 'KXNBAGAME-OUTSIDE', title: 'Boston at Philadelphia' }], cursor: '' });
    if (url.pathname.endsWith('/markets')) { detailCalls++; return Response.json({ markets: [] }); }
    throw new Error('Unexpected request: ' + url);
  };
  try {
    const response = await worker.fetch(request('/api/markets/scan?provider=kalshi&league=nba&min=1&max=99', 'POST'), { ASSETS: assets });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).markets.length, 0);
    assert.equal(detailCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('scanner recognizes upcoming matchups by team city and never labels them LIVE', async () => {
  const originalFetch = globalThis.fetch;
  const game = scoreboardGame('pre', 3);
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    if (url.pathname.endsWith('/series')) return Response.json({ series: [
      { ticker: 'KXNBAGAME', category: 'Sports' }, { ticker: 'KXNBAFINAL', category: 'Sports' }
    ] });
    if (url.pathname.endsWith('/events')) return Response.json({ events: [
      { event_ticker: 'KXNBAGAME-TODAY', title: 'Boston at Philadelphia' }
    ], cursor: '' });
    if (url.pathname.endsWith('/markets')) return Response.json({ markets: [
      { ticker: 'KXNBAGAME-TODAY-ML', title: 'Yes Boston', status: 'open',
        yes_ask_dollars: '0.60', no_ask_dollars: '0.40' }
    ], cursor: '' });
    throw new Error('Unexpected request: ' + url);
  };
  try {
    const response = await worker.fetch(request('/api/markets/scan?provider=kalshi&league=nba&min=50&max=70', 'POST'), { ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.markets.length, 1, JSON.stringify(body));
    assert.equal(body.markets[0].gameStatus, 'upcoming');
  } finally { globalThis.fetch = originalFetch; }
});

test('scanner excludes completed games and never requests their contract details', async () => {
  const originalFetch = globalThis.fetch;
  const game = scoreboardGame('post', -2);
  let detailCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    if (url.pathname.endsWith('/series')) return Response.json({ series: [{ ticker: 'KXNBAGAME', category: 'Sports' }] });
    if (url.pathname.endsWith('/events')) return Response.json({ events: [
      { event_ticker: 'KXNBAGAME-FINAL', title: 'Boston at Philadelphia' }
    ], cursor: '' });
    if (url.pathname.endsWith('/markets')) { detailCalls++; return Response.json({ markets: [] }); }
    throw new Error('Unexpected request: ' + url);
  };
  try {
    const response = await worker.fetch(request('/api/markets/scan?provider=kalshi&league=nba&min=1&max=99', 'POST'), { ASSETS: assets });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).markets.length, 0);
    assert.equal(detailCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('scanner retries a short Kalshi rate limit once', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [] });
    assert.ok(url.pathname.endsWith('/series'));
    calls++;
    if (calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
    return Response.json({ series: [] });
  });

  const response = await worker.fetch(request('/api/markets/scan?league=nba', 'POST'), { ASSETS: assets });
  assert.equal(response.status, 200);
  const body = await response.json() as { rateLimited: boolean; partialCoverage: boolean };
  assert.equal(body.rateLimited, false);
  assert.equal(body.partialCoverage, false);
  assert.equal(calls, 2);
});

test('scanner surfaces sustained Kalshi throttling with Retry-After', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 429, headers: { 'Retry-After': calls === 1 ? '0' : '30' } });
  });

  const response = await worker.fetch(request('/api/markets/scan?league=nba', 'POST'), { ASSETS: assets });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.deepEqual(await response.json(), {
    error: 'Kalshi is temporarily rate limiting scans. Please retry shortly.',
    rateLimited: true
  });
  assert.equal(calls, 2);
});

test('scanner returns quotes already fetched when Kalshi throttles market pagination', async t => {
  const game = scoreboardGame('in');
  const eventTicker = 'KXNBAGAME-26NOV16';
  const ticker = eventTicker + '-ML';
  let marketCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    if (url.pathname.endsWith('/series')) return Response.json({ series: [{ ticker: 'KXNBAGAME', category: 'Sports' }] });
    if (url.pathname.endsWith('/events')) {
      return Response.json({ events: [{ event_ticker: eventTicker, title: 'Boston at Philadelphia' }] });
    }
    assert.ok(url.pathname.endsWith('/markets'));
    marketCalls++;
    if (url.searchParams.has('cursor')) {
      return new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
    }
    return Response.json({
      markets: [{ ticker, title: 'Yes Boston', status: 'open', yes_ask_dollars: '0.58', no_ask_dollars: '0.42' }],
      cursor: 'next'
    });
  });

  const response = await worker.fetch(request('/api/markets/scan?league=nba&min=50&max=72', 'POST'), { ASSETS: assets });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    rateLimited: boolean;
    partialCoverage: boolean;
    markets: { ticker: string; askCents: number }[];
  };
  assert.equal(body.rateLimited, true);
  assert.equal(body.partialCoverage, true);
  assert.deepEqual(body.markets.map(market => [market.ticker, market.askCents]), [[ticker, 58]]);
  assert.equal(marketCalls, 2);
});
