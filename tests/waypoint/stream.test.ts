import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createWaypointSession, WAYPOINT_COOKIE } from '../../lib/waypoint/auth';
import { marketFreshness, stockStateSafe } from '../../lib/waypoint/api';
import type { Dashboard, Stock } from '../../lib/waypoint/types';

vi.mock('@/lib/waypoint/auth', () => import('../../lib/waypoint/auth'));
vi.mock('@/lib/waypoint/backend', () => import('../../lib/waypoint/backend'));
import { GET } from '../../app/api/waypoint/events/route';

beforeEach(() => {
  vi.stubEnv('WAYPOINT_PASSWORD', 'stream-test-password-only');
  vi.stubEnv('WAYPOINT_SESSION_SECRET', 'stream-test-signing-key-that-is-long-enough');
  vi.stubEnv('WAYPOINT_SERVICE_TOKEN', 'stream-test-service-key-that-is-long-enough');
  vi.stubEnv('WAYPOINT_BACKEND_URL', 'https://engine.example');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function request(auth = true) {
  return new NextRequest('https://www.theevanmiles.com/api/waypoint/events', {
    headers: auth ? { cookie: `${WAYPOINT_COOKIE}=${createWaypointSession()}` } : {},
  });
}

describe('Private live events', () => {
  it('rejects anonymous streams before opening an engine connection', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await GET(request(false))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('streams the first chunk without waiting for upstream completion and aborts on cancellation', async () => {
    let signal: AbortSignal | undefined;
    const cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: {}\n\n')); },
        cancel: cancelled,
      }), { headers: { 'content-type': 'text/event-stream' } });
    }));
    const response = await GET(request());
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot');
    expect(signal!.aborted).toBe(false);
    await reader.cancel();
    expect(signal!.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('explains serverless unavailability without a silent polling fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })));
    const text = await (await GET(request())).text();
    expect(text).toContain('event: unavailable');
    expect(text).toContain('streaming_worker_required');
    expect(text).toContain('"retryable":false');
  });
});

describe('Independent market freshness', () => {
  const now = Date.now();
  const stock = { market: { timestamp: new Date(now - 1000).toISOString(), stale: false },
    watchlist_tier: 'HOT', actionable: true, freshness: { status: 'current' } } as Stock;
  const data = { mode: 'live', data_status: { stream: { connected: true }, price_stale_seconds: 30 } } as Dashboard;
  it('ages out without another server message and immediately fails on transport loss', () => {
    expect(stockStateSafe(stock, data, now, true)).toBe(true);
    expect(stockStateSafe(stock, data, now + 31000, true)).toBe(false);
    expect(stockStateSafe(stock, data, now, false)).toBe(false);
    expect(stockStateSafe({ ...stock, watchlist_tier: 'WARM' }, data, now, true)).toBe(false);
  });
  it('does not call a fresh price stale merely because company research is incomplete', () => {
    const missingResearch = { ...stock, actionable: false, freshness: { ...stock.freshness, status: 'missing' as const } };
    expect(marketFreshness(missingResearch, data, now, true).stale).toBe(false);
    expect(stockStateSafe(missingResearch, data, now, true)).toBe(false);
  });
});
