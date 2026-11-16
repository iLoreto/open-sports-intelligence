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


const eventTicker = 'KXNBAGAME-BOSPHI';
const market = { ticker: eventTicker + '-BOS', title: 'Boston wins', status: 'active',
  yes_ask_dollars: '0.58', no_ask_dollars: '0.42' };
const scan = () => worker.fetch(request('/api/markets/scan?provider=kalshi&league=nba&min=50&max=72', 'POST'), { ASSETS: assets });
const discovery = (start: string) => ({
  events: [{ event_ticker: eventTicker, title: 'Boston at Philadelphia' }],
  milestones: [{ start_date: start, primary_event_tickers: [eventTicker] }],
  cursor: ''
});

test('scanner checks ESPN first and fetches quotes only for the exact matched event', async t => {
  const game = scoreboardGame('in');
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    assert.equal(url.pathname, '/trade-api/v2/events');
    if (url.searchParams.has('series_ticker')) {
      assert.equal(url.searchParams.get('series_ticker'), 'KXNBAGAME');
      assert.equal(url.searchParams.get('with_milestones'), 'true');
      assert.equal(url.searchParams.has('with_nested_markets'), false);
      const sameTeamsTomorrow = 'KXNBAGAME-TOMORROW';
      const page = discovery(game.date);
      page.events.push({ event_ticker: sameTeamsTomorrow, title: 'Boston at Philadelphia' });
      page.milestones.push({ start_date: new Date(Date.parse(game.date) + 86400000).toISOString(), primary_event_tickers: [sameTeamsTomorrow] });
      return Response.json(page);
    }
    assert.equal(url.searchParams.get('tickers'), eventTicker);
    assert.equal(url.searchParams.get('with_nested_markets'), 'true');
    return Response.json({ events: [
      { event_ticker: eventTicker, title: 'Boston at Philadelphia', markets: [market] },
      { event_ticker: 'KXNBAGAME-UNREQUESTED', title: 'Boston at Philadelphia', markets: [{ ...market, ticker: 'UNREQUESTED' }] }
    ] });
  });
  const response = await scan();
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.scheduledGames, 1);
  assert.equal(body.sportsEvents, 1);
  assert.equal(body.markets[0]?.eventTicker, eventTicker);
  assert.equal(body.partialCoverage, false);
  assert.deepEqual(body.markets.map((m: any) => [m.ticker, m.side, m.askCents, m.gameStatus, m.gameStartAt]),
    [[market.ticker, 'YES', 58, 'live', game.date]]);
  assert.equal(calls.filter(url => url.hostname === 'site.api.espn.com').length, 3);
  assert.equal(calls.length, 5);
  assert.ok(calls.slice(0, 3).every(url => url.hostname === 'site.api.espn.com'));
});

test('scanner makes no Kalshi requests when ESPN lists only completed or later games', async t => {
  const games = [scoreboardGame('post', -2), scoreboardGame('pre', 24)];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.equal(new URL(String(input)).hostname, 'site.api.espn.com');
    return Response.json({ events: games });
  });
  const response = await scan();
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.scheduledGames, 0);
  assert.deepEqual(body.markets, []);
  assert.equal(body.partialCoverage, false);
});

test('scanner marks a scheduled game as upcoming and reports a missing Kalshi event', async t => {
  const game = scoreboardGame('pre', 3);
  let omitEvent = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    if (url.searchParams.has('series_ticker')) return Response.json(discovery(game.date));
    return Response.json({ events: omitEvent ? [] : [{ event_ticker: eventTicker, title: 'Boston at Philadelphia', markets: [market] }] });
  });

  const response = await scan();
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.markets[0].gameStatus, 'upcoming');
  assert.equal(body.markets[0].gameStartAt, game.date);

  omitEvent = true;
  const incomplete = await scan();
  assert.equal(incomplete.status, 200);
  const partial = await incomplete.json() as any;
  assert.equal(partial.scheduledGames, 1);
  assert.equal(partial.partialCoverage, true);
  assert.deepEqual(partial.markets, []);
});

test('scanner stops bounded discovery without fetching quotes for an unresolved ESPN game', async t => {
  const game = scoreboardGame('pre');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    assert.equal(url.searchParams.has('with_nested_markets'), false);
    return Response.json({ events: [], cursor: 'more-' + ++requests });
  });
  const response = await scan();
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).partialCoverage, true);
  assert.equal(requests, 4);
});

test('scanner retries a short Kalshi rate limit once', async t => {
  const game = scoreboardGame('in');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    assert.equal(url.searchParams.get('series_ticker'), 'KXNBAGAME');
    calls++;
    if (calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
    return Response.json({ events: [] });
  });
  const response = await scan();
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).rateLimited, false);
  assert.equal(calls, 2);
});

test('scanner surfaces sustained Kalshi throttling with Retry-After', async t => {
  const game = scoreboardGame('in');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (new URL(String(input)).hostname === 'site.api.espn.com') return Response.json({ events: [game] });
    calls++;
    return new Response(null, { status: 429, headers: { 'Retry-After': calls === 1 ? '0' : '30' } });
  });

  const response = await scan();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.deepEqual(await response.json(), {
    error: 'Kalshi is temporarily rate limiting scans. Please retry shortly.',
    rateLimited: true
  });
  assert.equal(calls, 2);
});

test('scanner preserves quotes if Kalshi throttles the second batch of exact event IDs', async t => {
  const start = scoreboardGame('in').date;
  const games = Array.from({ length: 21 }, (_, index) => {
    const suffix = String(index).padStart(2, '0');
    const ticker = 'KXNBAGAME-' + suffix;
    const teams = ['Away' + suffix, 'Home' + suffix];
    return { ticker, title: teams.join(' vs '), scoreboard: {
      id: suffix, date: start, status: { type: { state: 'in' } },
      competitions: [{ competitors: teams.map(displayName => ({ team: { displayName } })) }]
    } };
  });
  let quoteCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') return Response.json({ events: games.map(g => g.scoreboard) });
    if (url.searchParams.has('series_ticker')) return Response.json({
      events: games.map(game => ({ event_ticker: game.ticker, title: game.title })),
      milestones: games.map(game => ({ start_date: start, primary_event_tickers: [game.ticker] }))
    });
    const batch = url.searchParams.get('tickers')?.split(',') ?? [];
    quoteCalls++;
    if (quoteCalls === 2) {
      assert.deepEqual(batch, [games[20].ticker]);
      return new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
    }
    assert.equal(batch.length, 20);
    return Response.json({
      events: games.slice(0, 20).map(game => ({ event_ticker: game.ticker, title: game.title, markets: [
        { ...market, ticker: game.ticker + '-YES', title: 'Away wins' }
      ] }))
    });
  });
  const response = await scan();
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.rateLimited, true);
  assert.equal(body.partialCoverage, true);
  assert.equal(body.markets.length, 20);
  assert.equal(quoteCalls, 2);
});

test('scanner matches abbreviated Kalshi college team names to ESPN schools', async t => {
  const base = scoreboardGame('pre');
  const game = { ...base, competitions: [{ competitors: ['SE Louisiana Lions', 'Oregon State Beavers'].map(displayName => ({
    team: { displayName }
  })) }] };
  const ticker = 'KXNCAAMBGAME-SELAORST';
  const event = { event_ticker: ticker, title: 'Southeastern Louisiana vs Oregon St.' };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') {
      assert.equal(url.searchParams.get('groups'), '50');
      return Response.json({ events: [game] });
    }
    if (url.searchParams.has('series_ticker')) return Response.json({
      events: [event], milestones: [{ start_date: game.date, primary_event_tickers: [ticker] }]
    });
    assert.equal(url.searchParams.get('tickers'), ticker);
    return Response.json({ events: [{ ...event, markets: [
      { ...market, ticker: ticker + '-SELA', title: 'Southeastern Louisiana wins' }
    ] }] });
  });
  const response = await worker.fetch(request('/api/markets/scan?league=ncaam&min=50&max=72', 'POST'), { ASSETS: assets });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.partialCoverage, false);
  assert.equal(body.markets.length, 1);
});

test('women’s college volleyball uses ESPN and the Kalshi match series', async t => {
  const fixture = scoreboardGame('pre');
  const game = { ...fixture, competitions: [{ competitors: ['Cincinnati Bearcats', 'Iowa State Cyclones'].map(displayName => ({
    team: { displayName }
  })) }] };
  const ticker = 'KXNCAAWVMATCH-CINISU';
  const event = { event_ticker: ticker, title: 'Cincinnati vs Iowa State' };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'site.api.espn.com') {
      assert.match(url.pathname, /volleyball\/womens-college-volleyball\/scoreboard$/);
      return Response.json({ events: [game] });
    }
    if (url.searchParams.has('series_ticker')) {
      assert.equal(url.searchParams.get('series_ticker'), 'KXNCAAWVMATCH');
      return Response.json({ events: [event], milestones: [{ start_date: game.date, primary_event_tickers: [ticker] }] });
    }
    assert.equal(url.searchParams.get('tickers'), ticker);
    return Response.json({ events: [{ ...event, markets: [
      { ...market, ticker: ticker + '-ISU', title: 'Iowa State wins' }
    ] }] });
  });
  const response = await worker.fetch(request('/api/markets/scan?league=ncaav&min=50&max=72', 'POST'), { ASSETS: assets });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.partialCoverage, false);
  assert.deepEqual(body.markets.map((item: { ticker: string }) => item.ticker), [ticker + '-ISU']);
});

test('volleyball research reads completed team schedules and reports sets', async t => {
  const game = { id: 'volley-1', date: new Date(Date.now() - 86400000).toISOString(),
    competitions: [{ status: { type: { completed: true } }, competitors: [
      { homeAway: 'home', team: { id: '221' }, score: { value: 3 } },
      { homeAway: 'away', team: { id: '97' }, score: { displayValue: '1' } }
    ] }] };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.match(new URL(String(input)).pathname, /volleyball\/womens-college-volleyball\/teams\/(221|97)\/schedule$/);
    return Response.json({ events: [game] });
  });
  const response = await worker.fetch(request('/api/leagues/ncaav/compare?left=221&right=97&sample=5'), { ASSETS: assets });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.metricProfile.unit, 'sets');
  assert.equal(body.left.pointsFor, 3);
  assert.equal(body.right.pointsFor, 1);
  assert.equal(body.h2h.games, 1);
});
