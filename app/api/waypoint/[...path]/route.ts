import { NextRequest, NextResponse } from 'next/server';
import { isWaypointAuthenticated, WAYPOINT_COOKIE, waypointOriginAllowed } from '@/lib/waypoint/auth';
import { callWaypointBackend, readSmallJson, WaypointBackendError } from '@/lib/waypoint/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const routes: Record<string, RegExp> = {
  GET: /^(dashboard|health|backtest|shadow|notifications|performance|ml\/status|ml\/evaluate|ml\/drift|sources\/[A-Za-z0-9_.:-]{1,160}|research\/sec\/[0-9]{1,10})$/,
  POST: /^(trades|refresh|quote-check|jobs\/settle|demo\/step|watchlist\/promote|ml\/train|ml\/ingest|ml\/maintenance|ml\/outcome)$/,
  PATCH: /^settings$/,
};

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!isWaypointAuthenticated(request.cookies.get(WAYPOINT_COOKIE)?.value)) return NextResponse.json({ detail: 'Please sign in to Waypoint.' }, { status: 401, headers });
  const path = (await context.params).path.join('/');
  if (!routes[request.method]?.test(path)) return NextResponse.json({ detail: 'Route not found.' }, { status: 404, headers });
  if (request.method !== 'GET' && !waypointOriginAllowed(request)) return NextResponse.json({ detail: 'Only this website may update Waypoint.' }, { status: 403, headers });
  try {
    const body = request.method === 'GET' || path === 'refresh' ? undefined : JSON.stringify(await readSmallJson(request));
    const upstream = await callWaypointBackend(path, { method: request.method, body });
    if (upstream.status >= 500) throw new WaypointBackendError('Waypoint’s engine is temporarily unavailable. Please retry shortly.');
    if (upstream.status === 401 || upstream.status === 403) throw new WaypointBackendError('Waypoint’s engine connection needs to be configured.');
    const value = await upstream.json().catch(() => null);
    if (value === null) throw new WaypointBackendError('Waypoint’s engine returned an incomplete response.');
    return NextResponse.json(value, { status: upstream.status, headers });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof WaypointBackendError ? error.message : 'The request could not be completed.' }, { status: error instanceof WaypointBackendError ? error.status : 502, headers });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH };
