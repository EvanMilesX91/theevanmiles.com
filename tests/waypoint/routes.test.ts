import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createWaypointSession, isWaypointAuthenticated, WAYPOINT_COOKIE } from '../../lib/waypoint/auth';

// Resolve the app's aliases without replacing either boundary implementation.
vi.mock('@/lib/waypoint/auth', () => import('../../lib/waypoint/auth'));
vi.mock('@/lib/waypoint/backend', () => import('../../lib/waypoint/backend'));

import { GET as getProxy, POST as postProxy, PATCH as patchProxy } from '../../app/api/waypoint/[...path]/route';
import { GET as getAuth, POST as postAuth, DELETE as deleteAuth } from '../../app/api/waypoint/auth/route';

const origin = 'https://www.theevanmiles.com';
const password = 'route-test-password-never-a-real-credential';
const serviceToken = 'route-test-service-token-never-a-real-credential';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('WAYPOINT_PASSWORD', password);
  vi.stubEnv('WAYPOINT_SESSION_SECRET', 'route-test-session-secret-never-a-real-credential');
  vi.stubEnv('WAYPOINT_BACKEND_URL', 'https://waypoint-engine.example');
  vi.stubEnv('WAYPOINT_SERVICE_TOKEN', serviceToken);
  vi.stubEnv('WAYPOINT_BACKEND_BYPASS_SECRET', 'test-only-automation-bypass');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', origin);
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', origin);
  vi.stubEnv('WAYPOINT_SITE_ORIGIN', origin);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(path: string, options: { method?: string; session?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new NextRequest(`${origin}/api/waypoint/${path}`, {
    method: options.method ?? 'GET',
    headers: {
      origin,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.session ? { cookie: `${WAYPOINT_COOKIE}=${options.session}` } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function context(path: string) { return { params: Promise.resolve({ path: path.split('/') }) }; }

describe('Waypoint protected proxy routes', () => {
  it('rejects unauthenticated account reads without reaching the engine', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await getProxy(request('dashboard'), context('dashboard'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a forged session rather than accepting its claimed expiry', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const [payload, signature] = createWaypointSession().split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), expires: 9999999999 })).toString('base64url');
    const response = await getProxy(request('dashboard', { session: `${forged}.${signature}` }), context('dashboard'));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { origin: 'https://attacker.example' },
    { origin, 'sec-fetch-site': 'cross-site' },
    { origin: '' },
  ])('blocks cross-site or missing-origin mutations before any upstream call (%j)', async (headers) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await patchProxy(request('settings', { method: 'PATCH', session: createWaypointSession(), body: { horizon: 'years' }, headers }), context('settings'));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['jobs/tick', 'jobs/refresh', 'auth/attempt', 'events', '../jobs/tick'])('keeps the privileged %s path out of the browser proxy', async (path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await postProxy(request(path, { method: 'POST', session: createWaypointSession(), body: {} }), context(path));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses only server service headers upstream and does not return them or upstream cookies to the browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ total_eur: 20 }, 200, {
      authorization: `Bearer ${serviceToken}`,
      'x-service-token': serviceToken,
      'set-cookie': 'engine-session=upstream-private-value',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await getProxy(request('dashboard', {
      session: createWaypointSession(),
      headers: { authorization: 'Bearer browser-controlled-value', 'x-service-token': 'browser-controlled-value' },
    }), context('dashboard'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total_eur: 20 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://waypoint-engine.example/api/dashboard');
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken}` } });
    expect(new Headers(init.headers).get('cookie')).toBeNull();
    expect(new Headers(init.headers).get('x-service-token')).toBeNull();
    expect(new Headers(init.headers).get('x-vercel-protection-bypass')).toBe('test-only-automation-bypass');
    for (const header of ['authorization', 'x-service-token', 'set-cookie', 'x-vercel-protection-bypass']) expect(response.headers.get(header)).toBeNull();
  });

  it('preserves the bodyless refresh contract used by the dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ stocks: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await postProxy(request('refresh', { method: 'POST', session: createWaypointSession() }), context('refresh'));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('hides engine authorization errors instead of signing the browser out or revealing upstream detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: serviceToken }, 403)));
    const response = await getProxy(request('dashboard', { session: createWaypointSession() }), context('dashboard'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(serviceToken);
  });
});

describe('Waypoint sign-in routes', () => {
  it('returns only access state from the public status route', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await getAuth(request('auth'));
    expect(await response.json()).toEqual({ authenticated: false, configured: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-site password submission before checking the durable limiter', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await postAuth(request('auth', { method: 'POST', body: { password }, headers: { origin: 'https://attacker.example' } }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['unreachable', 'server_error', 'invalid_result'])('fails closed with a correct password when the durable limiter is %s', async (failure) => {
    const fetchMock = failure === 'unreachable'
      ? vi.fn().mockRejectedValue(new Error('transport failure'))
      : vi.fn().mockResolvedValue(failure === 'server_error' ? json({ detail: 'database unavailable' }, 503) : json({ allowed: 'yes' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await postAuth(request('auth', { method: 'POST', body: { password } }));
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('honours the shared rate limit even for the correct password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ allowed: false, retry_after: 321 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await postAuth(request('auth', { method: 'POST', body: { password } }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('321');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('issues an HttpOnly, secure, strict session only after a permitted correct password', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ allowed: true })).mockResolvedValueOnce(json({ allowed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await postAuth(request('auth', { method: 'POST', body: { password } }));
    expect(response.status).toBe(200);
    expect(isWaypointAuthenticated(response.cookies.get(WAYPOINT_COOKIE)?.value)).toBe(true);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=strict');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://waypoint-engine.example/api/auth/attempt');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ key: 'owner-login' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ key: 'owner-login', success: true });
  });

  it('does not clear a session through cross-site logout', async () => {
    const response = await deleteAuth(request('auth', { method: 'DELETE', session: createWaypointSession(), headers: { origin: 'https://attacker.example' } }));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
