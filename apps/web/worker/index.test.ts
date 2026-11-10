import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.ts';

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

test('market scan returns non-empty moneyline results and honors league filter', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
	const url = new URL(String(input));
	if (url.pathname.endsWith('/events')) {
	  return Response.json({
		events: [{
		  event_ticker: 'NBA-1',
		  title: 'NBA: Alpha at Beta',
		  category: 'Sports',
		  markets: [{
			ticker: 'NBA-1-ML',
			title: 'Alpha to win',
			status: 'open',
			yes_ask_dollars: '0.58',
			no_ask_dollars: '0.42',
			yes_bid_dollars: '0.56',
			last_price_dollars: '0.57',
			volume_24h_fp: '91.3'
		  }, {
			ticker: 'NBA-1-TOTAL',
			title: 'Over total',
			status: 'active',
			yes_ask_dollars: '0.83',
			no_ask_dollars: '0.61',
			yes_bid_dollars: '0.80',
			last_price_dollars: '0.82',
			volume_24h_fp: '55.0'
		  }]
		}, {
		  event_ticker: 'NFL-1',
		  title: 'NFL: Gamma vs Delta',
		  category: 'Sports',
		  markets: [{
			ticker: 'NFL-1-ML',
			title: 'Gamma to win',
			status: 'open',
			yes_ask_dollars: '0.47',
			no_ask_dollars: '0.53',
			yes_bid_dollars: '0.45',
			last_price_dollars: '0.48',
			volume_24h_fp: '77.0'
		  }]
		}],
		cursor: ''
	  });
	}

	if (url.pathname.endsWith('/markets')) {
	  return Response.json({ markets: [{
		ticker: 'UNRELATED-MARKET',
		event_ticker: 'NOT-A-SPORT-EVENT',
		title: 'Unrelated',
		status: 'open',
		yes_ask_dollars: '0.20',
		no_ask_dollars: '0.80'
	  }, {
		ticker: 'NBA-BOS-PHI-ML',
		event_ticker: 'KX_UNKNOWN_NBA',
		title: 'Yes Boston',
		status: 'open',
		yes_ask_dollars: '0.54',
		no_ask_dollars: '0.46'
	  }], cursor: '' });
	}

	throw new Error('Unexpected URL ' + url.toString());
  };

  try {
	const nbaResponse = await worker.fetch(request('/api/markets/scan?provider=kalshi&league=nba&min=1&max=99', 'POST'), { ASSETS: assets });
	assert.equal(nbaResponse.status, 200);
	const nbaBody = await nbaResponse.json() as any;
	assert.ok(Array.isArray(nbaBody.markets));
	assert.equal(nbaBody.markets.length, 4);
	assert.deepEqual(nbaBody.markets.map((market: any) => [market.ticker, market.side, market.askCents]), [
	  ['NBA-1-ML', 'NO', 42],
	  ['NBA-BOS-PHI-ML', 'NO', 46],
	  ['NBA-BOS-PHI-ML', 'YES', 54],
	  ['NBA-1-ML', 'YES', 58]
	]);

	const nflResponse = await worker.fetch(request('/api/markets/scan?provider=kalshi&league=nfl&min=1&max=99', 'POST'), { ASSETS: assets });
	assert.equal(nflResponse.status, 200);
	const nflBody = await nflResponse.json() as any;
	assert.deepEqual(nflBody.markets.map((market: any) => [market.ticker, market.side, market.askCents]), [
	  ['NFL-1-ML', 'YES', 47],
	  ['NFL-1-ML', 'NO', 53]
	]);
  } finally {
	globalThis.fetch = originalFetch;
  }
});
