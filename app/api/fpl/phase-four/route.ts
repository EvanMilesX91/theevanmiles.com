import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { runPhaseFour, type PhaseFourSnapshot } from '@/lib/fpl/phase4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_MS = 15 * 60 * 1_000;
let cached: { snapshot: PhaseFourSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<PhaseFourSnapshot> | null = null;

async function getSnapshot(): Promise<PhaseFourSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  if (!inFlight) {
    inFlight = runPhaseFour({ persist: process.env.VERCEL !== '1' })
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
    return NextResponse.json({ error: 'phase_four_refresh_failed', detail: error instanceof Error ? error.message : 'Unknown FPL refresh error.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
