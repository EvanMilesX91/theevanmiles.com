import { NextRequest, NextResponse } from 'next/server';

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
        { status: 429 }
      );
    }
    
    const { password } = await request.json();
    
    if (password === process.env.ADMIN_PASSWORD) {
      // Successful login - clear any failed attempts
      clearAttempts(ip);
      return NextResponse.json({ success: true });
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
        { status: 401 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}