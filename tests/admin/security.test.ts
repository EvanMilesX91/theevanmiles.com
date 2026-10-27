import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, adminAuthenticated, createAdminSession, verifyAdminPassword } from '../../lib/admin/auth';

const database = vi.hoisted(() => {
  const query: Record<string, any> = { data: [], error: null, count: 0 };
  for (const method of ['select', 'insert', 'lte', 'eq', 'update']) query[method] = vi.fn(() => query);
  query.single = vi.fn(async () => ({ data: { id: 'test-only-id' }, error: null }));
  return { from: vi.fn(() => query), rpc: vi.fn(async () => ({ data: [], error: null })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => database }));
vi.mock('@/lib/admin/auth', () => import('../../lib/admin/auth'));
vi.mock('@/lib/http/request', () => import('../../lib/http/request'));
vi.mock('@/lib/spotify/oauth', () => import('../../lib/spotify/oauth'));

import { GET as status, POST as login, DELETE as logout } from '../../app/api/admin/auth/route';
import { POST as createGate } from '../../app/api/admin/create-gate/route';
import { POST as createPresave } from '../../app/api/admin/create-presave/route';
import { POST as sync } from '../../app/api/admin/sync-to-database/route';
import { GET as stats } from '../../app/api/admin/stats/route';
import { GET as scan } from '../../app/api/admin/scan-storage/route';
import { GET as cron, POST as cronPost } from '../../app/api/cron/release-day/route';

const origin = 'https://www.theevanmiles.com';
const password = 'test-only-admin-password-never-a-real-secret';
const sessionSecret = 'test-only-session-secret-never-a-real-secret';
const cronSecret = 'test-only-cron-secret-never-a-real-secret';
let requestNumber = 0;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ADMIN_PASSWORD', password);
  vi.stubEnv('ADMIN_SESSION_SECRET', sessionSecret);
  vi.stubEnv('CRON_SECRET', cronSecret);
});
afterEach(() => { vi.unstubAllEnvs(); });
function req(method = 'GET', options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new NextRequest(`${origin}/api/admin/test`, {
    method,
    headers: {
      origin,
      'x-forwarded-for': `192.0.2.${++requestNumber}`,
      ...(options.token ? { cookie: `${ADMIN_COOKIE}=${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe('Admin signed sessions', () => {
  it('rejects the old localStorage/header token, missing configuration and missing password', () => {
    expect(adminAuthenticated('authenticated')).toBe(false);
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect(verifyAdminPassword(undefined)).toBe(false);
    expect(verifyAdminPassword('')).toBe(false);
    expect(() => createAdminSession()).toThrow();
  });
  it('expires sessions, rejects tampering and revokes them on password rotation', () => {
    const now = Date.now();
    const token = createAdminSession(now);
    expect(adminAuthenticated(token, now)).toBe(true);
    expect(adminAuthenticated(token, now + ADMIN_SESSION_SECONDS * 1000)).toBe(false);
    expect(adminAuthenticated(token, now - 2000)).toBe(false);
    expect(adminAuthenticated(token.replace(/.$/, '!'), now)).toBe(false);
    const [payload, signature] = token.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...data, expires: data.expires + 3600 })).toString('base64url');
    expect(adminAuthenticated(`${forged}.${signature}`, now)).toBe(false);
    vi.stubEnv('ADMIN_PASSWORD', 'a-different-test-only-password');
    expect(adminAuthenticated(token, now)).toBe(false);
  });
  it('rejects missing admin signing configuration', () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', '');
    expect(verifyAdminPassword(password)).toBe(false);
    expect(() => createAdminSession()).toThrow();
  });
});

describe('Admin route boundaries', () => {
  it.each([
    ['create gate', 'POST', createGate], ['create presave', 'POST', createPresave],
    ['sync storage', 'POST', sync], ['read stats', 'GET', stats], ['scan storage', 'GET', scan],
  ] as const)('blocks unauthenticated %s despite the old spoofed header', async (_name, method, handler) => {
    const response = await handler(req(method, { headers: { 'x-admin-auth': 'authenticated' }, ...(method === 'POST' ? { body: {} } : {}) }));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(database.from).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it.each([createGate, createPresave, sync])('blocks cross-site writes even with a valid signed session', async handler => {
    const response = await handler(req('POST', { token: createAdminSession(), body: {}, headers: { origin: 'https://attacker.example' } }));
    expect(response.status).toBe(403);
    expect(database.from).not.toHaveBeenCalled();
  });
  it('permits an authenticated same-origin creation while keeping the service role server-side', async () => {
    const response = await createGate(req('POST', { token: createAdminSession(), body: {
      slug: 'test', title: 'Test gate', file_url: 'file.wav', cover_url: 'https://example.com/cover.jpg', requirements: { email: true },
    } }));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(database.from).toHaveBeenCalledWith('gates');
  });
});

describe('Admin sign-in and sign-out', () => {
  it('returns auth status without granting access from a forged header', async () => {
    expect(await (await status(req('GET', { headers: { 'x-admin-auth': 'authenticated' } }))).json()).toEqual({ authenticated: false, configured: true });
  });
  it('fails closed when the password is unconfigured', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const response = await login(req('POST', { body: {} }));
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('rejects missing origins and oversized login bodies', async () => {
    expect((await login(req('POST', { body: { password }, headers: { origin: '' } }))).status).toBe(403);
    expect((await login(req('POST', { body: { password: 'x'.repeat(2100) } }))).status).toBe(413);
  });
  it('issues only a protected session after valid credentials and clears it on logout', async () => {
    const response = await login(req('POST', { body: { password } }));
    expect(response.status).toBe(200);
    expect(adminAuthenticated(response.cookies.get(ADMIN_COOKIE)?.value)).toBe(true);
    const cookie = response.headers.get('set-cookie') ?? '';
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=strict']) expect(cookie).toContain(flag);
    const denied = await logout(req('DELETE', { headers: { origin: 'https://attacker.example' } }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('set-cookie')).toBeNull();
    expect((await logout(req('DELETE'))).headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('Release cron authorization', () => {
  it.each([undefined, '', 'short'])('denies missing or weak configured secret %s before touching user tokens', async secret => {
    vi.stubEnv('CRON_SECRET', secret);
    expect((await cron(req())).status).toBe(401);
    expect((await cronPost(req('POST'))).status).toBe(401);
    expect(database.from).not.toHaveBeenCalled();
  });
  it('rejects wrong secrets and accepts the configured bearer', async () => {
    expect((await cron(req('GET', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect(database.from).not.toHaveBeenCalled();
    expect((await cron(req('GET', { headers: { authorization: `Bearer ${cronSecret}` } }))).status).toBe(200);
    expect(database.from).toHaveBeenCalledWith('presaves');
  });
});
