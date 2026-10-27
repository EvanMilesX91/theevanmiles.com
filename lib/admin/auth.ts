import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const ADMIN_COOKIE = 'admin_session';
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
export const ADMIN_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function password(): string { return process.env.ADMIN_PASSWORD || ''; }
function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || '';
}
function digest(value: string): Buffer { return createHash('sha256').update(value, 'utf8').digest(); }
export function adminConfigured(): boolean { return password().length >= 12 && secret().length >= 32; }
export function verifyAdminPassword(value: unknown): boolean {
  return adminConfigured() && typeof value === 'string' && value.length <= 512 && timingSafeEqual(digest(value), digest(password()));
}
function signature(payload: string): string {
  return createHmac('sha256', secret()).update(`admin:${payload}:${digest(password()).toString('hex')}`).digest('base64url');
}
export function createAdminSession(now = Date.now()): string {
  if (!adminConfigured()) throw new Error('Admin sign-in is not configured.');
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ aud: 'admin', v: 1, issued, expires: issued + ADMIN_SESSION_SECONDS })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function adminAuthenticated(token: string | undefined, now = Date.now()): boolean {
  if (!adminConfigured() || !token || token.length > 1024) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
    if (!timingSafeEqual(Buffer.from(parts[1]), Buffer.from(signature(parts[0])))) return false;
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    return data.aud === 'admin' && data.v === 1 && Number.isSafeInteger(data.issued) && Number.isSafeInteger(data.expires) &&
      data.issued <= seconds && data.expires > seconds && data.expires - data.issued === ADMIN_SESSION_SECONDS;
  } catch { return false; }
}
export function adminOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const allowed = new Set(['https://theevanmiles.com', 'https://www.theevanmiles.com']);
  for (const raw of [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_BASE_URL, process.env.ADMIN_SITE_ORIGIN]) {
    if (raw) { try { allowed.add(new URL(raw).origin); } catch { /* Invalid settings never authorize an origin. */ } }
  }
  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
  }
  return allowed.has(origin);
}
export function requireAdmin(request: NextRequest): NextResponse | null {
  if (!adminAuthenticated(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Please sign in to the admin area.' }, { status: 401, headers: ADMIN_HEADERS });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !adminOriginAllowed(request)) {
    return NextResponse.json({ error: 'Only this website may update the admin area.' }, { status: 403, headers: ADMIN_HEADERS });
  }
  return null;
}
export function cronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization');
  return !!expected && expected.length >= 16 && !!supplied && supplied.length <= 1024 &&
    timingSafeEqual(digest(supplied), digest(`Bearer ${expected}`));
}
