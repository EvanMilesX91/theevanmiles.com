import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { runPhaseThree, type PhaseThreeSnapshot } from '@/lib/fpl/phase3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_MS = 15 * 60 * 1_000;
let cached: { snapshot: PhaseThreeSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<PhaseThreeSnapshot> | null = null;

async function getSnapshot(): Promise<PhaseThreeSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  if (!inFlight) {
    inFlight = runPhaseThree({ persist: process.env.VERCEL !== '1' })
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
    return NextResponse.json(await getSnapshot(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'phase_three_refresh_failed', detail: error instanceof Error ? error.message : 'Unknown FPL refresh error.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
