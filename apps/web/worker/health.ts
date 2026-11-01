export function handleHealth(): Response {
  return Response.json({
    status: 'ok',
    service: 'open-sports-intelligence',
    time: new Date().toISOString(),
    mode: 'read-only'
  }, { headers: { 'Cache-Control': 'no-store' } });
}
