import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { runPhaseOne } from '@/lib/fpl/phase1';
import type { PhaseOneSnapshot } from '@/lib/fpl/phase1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_MS = 15 * 60 * 1_000;
let cached: { snapshot: PhaseOneSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<PhaseOneSnapshot> | null = null;

async function getSnapshot(): Promise<PhaseOneSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  if (!inFlight) {
    inFlight = runPhaseOne({ persist: process.env.VERCEL !== '1' })
      .then((snapshot) => {
        cached = { snapshot, expiresAt: Date.now() + CACHE_MS };
        return snapshot;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const snapshot = await getSnapshot();
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: 'phase_one_refresh_failed',
      detail: error instanceof Error ? error.message : 'Unknown FPL refresh error.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
