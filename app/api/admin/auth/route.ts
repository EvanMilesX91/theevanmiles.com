import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, ADMIN_HEADERS, ADMIN_SESSION_SECONDS, adminAuthenticated, adminConfigured, adminOriginAllowed, createAdminSession, verifyAdminPassword } from '@/lib/admin/auth';
import { readSmallJson, RequestBodyError } from '@/lib/http/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// In-memory store for rate limiting
// Note: This resets on server restart/redeploy, which is fine for basic protection
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getClientIP(request: NextRequest): string {
  // Vercel provides the real IP in x-forwarded-for
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  // Fallback for local development
  return request.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(ip: string): { limited: boolean; remainingAttempts: number; lockoutEndsAt?: number } {
  const record = loginAttempts.get(ip);
  
  if (!record) {
    return { limited: false, remainingAttempts: MAX_ATTEMPTS };
  }
  
  const now = Date.now();
  const timeSinceFirst = now - record.firstAttempt;
  
  // If lockout period has passed, reset
  if (timeSinceFirst > LOCKOUT_DURATION_MS) {
    loginAttempts.delete(ip);
    return { limited: false, remainingAttempts: MAX_ATTEMPTS };
  }
  
  // If max attempts reached, they're locked out
  if (record.count >= MAX_ATTEMPTS) {
    const lockoutEndsAt = record.firstAttempt + LOCKOUT_DURATION_MS;
    return { limited: true, remainingAttempts: 0, lockoutEndsAt };
  }
  
  return { limited: false, remainingAttempts: MAX_ATTEMPTS - record.count };
}

function recordFailedAttempt(ip: string): void {
  const record = loginAttempts.get(ip);
  const now = Date.now();
  
  if (!record) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count += 1;
  }
}

function clearAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

export async function POST(request: NextRequest) {
  if (!adminOriginAllowed(request)) return NextResponse.json({ error: 'Open this website to sign in.' }, { status: 403, headers: ADMIN_HEADERS });
  if (!adminConfigured()) return NextResponse.json({ error: 'Admin sign-in is not configured. Set ADMIN_PASSWORD (12+ characters) and ADMIN_SESSION_SECRET (32+ characters).' }, { status: 503, headers: ADMIN_HEADERS });
  try {
    const ip = getClientIP(request);
    
    // Check if IP is rate limited
    const { limited, remainingAttempts, lockoutEndsAt } = isRateLimited(ip);
    
    if (limited) {
      const minutesRemaining = Math.ceil((lockoutEndsAt! - Date.now()) / 60000);
      return NextResponse.json(
        { 
          error: 'Too many failed attempts. Please try again later.',
          lockoutMinutesRemaining: minutesRemaining 
        },
        { status: 429, headers: { ...ADMIN_HEADERS, 'Retry-After': String(Math.max(1, Math.ceil((lockoutEndsAt! - Date.now()) / 1000))) } }
      );
    }
    
    const body = await readSmallJson(request, 2048) as { password?: unknown } | null;
    
    if (verifyAdminPassword(body?.password)) {
      // Successful login - clear any failed attempts
      clearAttempts(ip);
      const response = NextResponse.json({ success: true }, { headers: ADMIN_HEADERS });
      response.cookies.set(ADMIN_COOKIE, createAdminSession(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: ADMIN_SESSION_SECONDS });
      return response;
    } else {
      // Failed login - record attempt
      recordFailedAttempt(ip);
      const newRemaining = remainingAttempts - 1;
      
      return NextResponse.json(
        { 
          error: 'Invalid password',
          attemptsRemaining: newRemaining,
          ...(newRemaining === 0 && { message: 'Account locked for 15 minutes.' })
        },
        { status: 401, headers: ADMIN_HEADERS }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: error instanceof RequestBodyError ? error.status : 500, headers: ADMIN_HEADERS }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: adminAuthenticated(request.cookies.get(ADMIN_COOKIE)?.value), configured: adminConfigured() }, { headers: ADMIN_HEADERS });
}

export async function DELETE(request: NextRequest) {
  if (!adminOriginAllowed(request)) return NextResponse.json({ error: 'Open this website to sign out.' }, { status: 403, headers: ADMIN_HEADERS });
  const response = NextResponse.json({ authenticated: false }, { headers: ADMIN_HEADERS });
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
