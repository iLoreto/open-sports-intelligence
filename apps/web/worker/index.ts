import { handleHealth } from './health';
import { handleMarkets, scanMarkets } from './markets';
import { historyResponse, persistSnapshot, type RadarDatabase } from './persistence';

interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Optional until the user provisions D1 and applies the migration. */
  RADAR_DB?: RadarDatabase;
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === '/api/markets') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return handleMarkets(request, env.RADAR_DB);
    }

    if (path === '/api/history') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return historyResponse(request, env.RADAR_DB);
    }

    if (path === '/api/health') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return handleHealth();
    }

    if (path.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: unknown, env: Environment): Promise<void> {
    if (!env.RADAR_DB) {
      console.warn('RADAR_DB is not bound; scheduled snapshots are disabled.');
      return;
    }
    const snapshot = await scanMarkets();
    await persistSnapshot(env.RADAR_DB, snapshot);
    console.log(`Stored ${snapshot.markets.length} market prices at ${snapshot.scannedAt}`);
  }
};
