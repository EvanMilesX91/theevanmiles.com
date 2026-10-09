import { NextRequest, NextResponse } from 'next/server';
import { createWaypointSession, isWaypointAuthenticated, isWaypointConfigured, SESSION_SECONDS, verifyWaypointPassword, WAYPOINT_COOKIE, waypointOriginAllowed } from '@/lib/waypoint/auth';
import { callWaypointBackend, readSmallJson, WaypointBackendError } from '@/lib/waypoint/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: isWaypointAuthenticated(request.cookies.get(WAYPOINT_COOKIE)?.value), configured: isWaypointConfigured() }, { headers });
}

export async function POST(request: NextRequest) {
  if (!waypointOriginAllowed(request)) return NextResponse.json({ detail: 'Open Waypoint on this website to sign in.' }, { status: 403, headers });
  if (!isWaypointConfigured()) return NextResponse.json({ detail: 'Set a Waypoint password of at least 12 characters and a session secret in the server settings.' }, { status: 503, headers });
  try {
    const body = await readSmallJson(request, 2048) as { password?: unknown } | null;
    // The database-backed bucket is shared by every serverless instance. Fail closed.
    const limitResponse = await callWaypointBackend('auth/attempt', { method: 'POST', body: JSON.stringify({ key: 'owner-login' }) });
    if (!limitResponse.ok) throw new WaypointBackendError('Sign-in is temporarily unavailable while the engine connects.');
    const limit = await limitResponse.json();
    if (typeof limit.allowed !== 'boolean') throw new WaypointBackendError('Sign-in is temporarily unavailable.');
    if (!limit.allowed) return NextResponse.json({ detail: 'Too many sign-in attempts. Please try again later.' }, { status: 429, headers: { ...headers, 'Retry-After': String(Math.max(1, Number(limit.retry_after) || 900)) } });
    if (!verifyWaypointPassword(body?.password)) return NextResponse.json({ detail: 'Incorrect password.' }, { status: 401, headers });
    await callWaypointBackend('auth/attempt', { method: 'POST', body: JSON.stringify({ key: 'owner-login', success: true }) });
    const response = NextResponse.json({ authenticated: true, configured: true }, { headers });
    response.cookies.set(WAYPOINT_COOKIE, createWaypointSession(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS });
    return response;
  } catch (error) {
    return NextResponse.json({ detail: error instanceof WaypointBackendError ? error.message : 'Sign-in is temporarily unavailable.' }, { status: error instanceof WaypointBackendError ? error.status : 503, headers });
  }
}

export async function DELETE(request: NextRequest) {
  if (!waypointOriginAllowed(request)) return NextResponse.json({ detail: 'Open Waypoint on this website to sign out.' }, { status: 403, headers });
  const response = NextResponse.json({ authenticated: false }, { headers });
  response.cookies.set(WAYPOINT_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
