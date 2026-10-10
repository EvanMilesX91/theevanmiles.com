import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const WAYPOINT_COOKIE = 'waypoint_session';
export const SESSION_SECONDS = 12 * 60 * 60;

function ownerPassword(): string {
  return process.env.WAYPOINT_PASSWORD || process.env.ADMIN_PASSWORD || '';
}

function sessionSecret(): string {
  return process.env.WAYPOINT_SESSION_SECRET || '';
}

export function isWaypointConfigured(): boolean {
  return ownerPassword().length >= 12 && sessionSecret().length >= 32;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyWaypointPassword(value: unknown): boolean {
  return isWaypointConfigured() && typeof value === 'string' && value.length <= 512 &&
    timingSafeEqual(digest(value), digest(ownerPassword()));
}

function signature(payload: string): string {
  // Rotating either the session secret or the owner password invalidates old sessions.
  return createHmac('sha256', sessionSecret()).update(`${payload}:${digest(ownerPassword()).toString('hex')}`).digest('base64url');
}

export function createWaypointSession(now = Date.now()): string {
  if (!isWaypointConfigured()) throw new Error('Waypoint sign-in is not configured.');
  const payload = Buffer.from(JSON.stringify({ v: 1, issued: Math.floor(now / 1000), expires: Math.floor(now / 1000) + SESSION_SECONDS })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function isWaypointAuthenticated(token: string | undefined, now = Date.now()): boolean {
  if (!isWaypointConfigured() || !token || token.length > 1024) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
    if (!timingSafeEqual(Buffer.from(parts[1]), Buffer.from(signature(parts[0])))) return false;
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    return data.v === 1 && Number.isSafeInteger(data.issued) && Number.isSafeInteger(data.expires) &&
      data.issued <= seconds && data.expires > seconds && data.expires - data.issued === SESSION_SECONDS;
  } catch { return false; }
}

export function waypointOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set(['https://theevanmiles.com', 'https://www.theevanmiles.com']);
  for (const raw of [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_BASE_URL, process.env.WAYPOINT_SITE_ORIGIN]) {
    if (raw) { try { allowed.add(new URL(raw).origin); } catch { /* Ignore invalid configuration. */ } }
  }
  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
  }
  return allowed.has(origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
}
