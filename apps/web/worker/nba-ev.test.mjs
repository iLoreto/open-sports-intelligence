import assert from 'node:assert/strict';
import test from 'node:test';
import { compareGame, illustrativeFee, kalshiEventTicker, scanNbaEv, teamCode } from './nba-ev.ts';

const FIXTURE = {
  id: 'nba-2026nov04-mia-lac', date: '2026-11-05T03:00:00Z',
  season: { year: 2027, type: 2 }, status: { type: { state: 'pre' } },
  competitions: [{ type: { abbreviation: 'STD' }, competitors: [
    { homeAway: 'away', team: { id: '14', abbreviation: 'MIA', displayName: 'Miami Heat' } },
    { homeAway: 'home', team: { id: '12', abbreviation: 'LAC', displayName: 'LA Clippers' } }
  ] }]
};
const EVENT = 'KXNBAGAME-26NOV04MIALAC';
const market = (team, yes, no, status = 'active') => ({
  ticker: `${EVENT}-${team}`, event_ticker: EVENT, title: `${team} wins`, status,
  yes_ask_dollars: yes, no_ask_dollars: no, volume_24h_fp: '170.00'
});
const MARKETS = [market('MIA', '0.6100', '0.4700'), market('LAC', '0.4600', '0.6300')];

test('matches an exact scheduled NBA game date and both participant tickers, including LA time zone', () => {
  assert.equal(kalshiEventTicker(FIXTURE), EVENT);
  assert.equal(teamCode({ abbreviation: 'GS' }), 'GSW');
  assert.equal(teamCode({ abbreviation: 'NY' }), 'NYK');
  assert.equal(teamCode({ abbreviation: 'UTAH' }), 'UTA');
  assert.equal(teamCode({ abbreviation: '' }), null);
  assert.equal(kalshiEventTicker({ ...FIXTURE, date: '2026-11-05T08:15:00Z' }), 'KXNBAGAME-26NOV05MIALAC');
  assert.equal(compareGame(FIXTURE, [market('MIA', '0.6000', '0.4000')], 0.65, 1), null);
  assert.equal(compareGame(FIXTURE, [{ ...MARKETS[0], event_ticker: 'KXNBACHAMP-27' }, MARKETS[1]], 0.65, 1), null);
  assert.equal(compareGame(FIXTURE, MARKETS.map((item) => ({ ...item, status: 'closed' })), 0.65, 1), null);
});

test('rounds the actual 100-contract standard taker estimate once, with a zero-multiplier option', () => {
  assert.equal(illustrativeFee(0.6, 1, 100), 1.68);
  assert.equal(illustrativeFee(0.6, 1, 1), 0.02);
  assert.equal(illustrativeFee(0.6, 0, 100), 0);
  assert.equal(illustrativeFee(0, 1), null);
  assert.equal(illustrativeFee(1, 1), null);
});

test('calculates best quoted YES or NO route and withholds fee-dependent EV when multiplier is missing', () => {
  const game = compareGame(FIXTURE, MARKETS, 0.65, 1);
  assert.equal(game?.offers.length, 2);
  const home = game.offers.find((offer) => offer.outcome === 'home');
  assert.equal(home.side, 'YES');
  assert.equal(home.ticker, `${EVENT}-LAC`);
  assert.equal(home.modelProbability, 0.65);
  assert.equal(home.ask, 0.46);
  assert.ok(Math.abs(home.grossEdge - 0.19) < 1e-9);
  assert.equal(home.feePerContract, illustrativeFee(0.46, 1, 100) / 100);
  assert.ok(Math.abs(home.illustrativeNetEv - (home.modelProbability - home.ask - home.feePerContract)) < 1e-9);
  const noRoute = compareGame(FIXTURE, [
    market('MIA', '0.7200', '0.5500'), market('LAC', '0.4700', '0.2500')
  ], 0.65, 1).offers.find((offer) => offer.outcome === 'away');
  assert.equal(noRoute.side, 'NO');
  assert.equal(noRoute.ticker, `${EVENT}-LAC`);
  const unknownFee = compareGame(FIXTURE, MARKETS, 0.65, null);
  assert.ok(unknownFee.offers.every((offer) => offer.illustrativeNetEv === null && offer.grossEdge !== null));
});

test('scans the actual game-winner series with live Kalshi quotes and valid Elo input', async () => {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requested.push(path);
    if (path.includes('/markets?')) {
      const cursor = new URL(path).searchParams.get('cursor');
      return Response.json({ markets: cursor ? [MARKETS[1]] : [MARKETS[0]], cursor: cursor ? '' : 'next-slice' });
    }
    if (path.endsWith('/series/KXNBAGAME')) return Response.json({ series: {
      ticker: 'KXNBAGAME', fee_type: 'quadratic_with_maker_fees', fee_multiplier: 1
    } });
    if (path.includes('/scoreboard?dates=202611')) return Response.json({ events: [FIXTURE] });
    if (path.includes('/scoreboard?dates=202610')) return Response.json({ events: [] });
    return new Response('Unexpected test endpoint', { status: 404 });
  };
  try {
    const result = await scanNbaEv(new Date('2026-11-01T20:00:00Z'));
    assert.equal(result.model.available, true);
    assert.equal(result.counts.scheduledGames, 1);
    assert.equal(result.counts.matchedGames, 1);
    assert.equal(result.counts.marketPages, 2);
    assert.equal(result.counts.partialMarketCoverage, false);
    assert.equal(result.offers.length, 2);
    assert.equal(result.fees.multiplier, 1);
    assert.ok(result.offers.every((offer) => offer.illustrativeNetEv !== null));
    assert.ok(requested.some((url) => url.includes('series_ticker=KXNBAGAME')));
  } finally { globalThis.fetch = original; }
});

test('omits EV when live markets or Elo input are missing instead of fabricating numbers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/markets?')) return Response.json({ markets: MARKETS, cursor: '' });
    if (path.endsWith('/series/KXNBAGAME')) return Response.json({ series: { ticker: 'KXNBAGAME' } });
    if (path.includes('/scoreboard?dates=202610')) return new Response('Failed history', { status: 503 });
    if (path.includes('/scoreboard?dates=202611')) return Response.json({ events: [FIXTURE] });
    return new Response('Unknown', { status: 404 });
  };
  try {
    const result = await scanNbaEv(new Date('2026-11-01T20:00:00Z'));
    assert.equal(result.model.available, false);
    assert.equal(result.offers.length, 0);
    assert.ok(result.warnings.some((warning) => warning.includes('withheld')));
  } finally { globalThis.fetch = original; }
});
