import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import {
  createDashboardSnapshotStore,
  loadAutomatedDashboard,
  refreshAutomatedDashboard,
  type PhaseSixSnapshot,
} from '@/lib/fpl/phase6';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MEMORY_CACHE_MS = 2 * 60 * 1_000;
let cached: { snapshot: PhaseSixSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<PhaseSixSnapshot> | null = null;

async function getSnapshot(): Promise<PhaseSixSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  if (!inFlight) {
    inFlight = (async () => {
      const store = createDashboardSnapshotStore({ preferRemote: process.env.NODE_ENV === 'production' });
      const stored = await loadAutomatedDashboard(store);
      const snapshot = stored ?? await refreshAutomatedDashboard({ store, trigger: 'bootstrap' });
      cached = { snapshot, expiresAt: Date.now() + MEMORY_CACHE_MS };
      return snapshot;
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const snapshot = await getSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-FPL-Snapshot-Age-Minutes': String(snapshot.automation.ageMinutes),
        'X-FPL-Snapshot-Freshness': snapshot.automation.freshness,
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: 'phase_six_snapshot_unavailable',
      detail: error instanceof Error ? error.message : 'Unknown automated FPL snapshot error.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
