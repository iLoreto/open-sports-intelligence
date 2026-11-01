import { handleHealth } from './health';
import { handleMarkets } from './markets';

interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === '/api/markets') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return handleMarkets(request);
    }

    if (path === '/api/health') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return handleHealth();
    }

    if (path.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
