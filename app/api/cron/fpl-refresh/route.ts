import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_HEADERS, cronAuthorized } from '@/lib/admin/auth';
import { createDashboardSnapshotStore, createProjectionCalibrationStore, refreshAutomatedDashboard } from '@/lib/fpl/phase6';
import type { CalibrationRefreshResult, RefreshTrigger } from '@/lib/fpl/phase6';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function refresh(request: NextRequest, trigger: RefreshTrigger) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ADMIN_HEADERS });
  }
  try {
    const store = createDashboardSnapshotStore({ preferRemote: process.env.VERCEL === '1' });
    const calibrationStore = createProjectionCalibrationStore({ preferRemote: process.env.VERCEL === '1' });
    let calibration: CalibrationRefreshResult | null = null;
    const snapshot = await refreshAutomatedDashboard({ store, calibrationStore, trigger, onCalibration: (result) => { calibration = result; } });
    return NextResponse.json({
      ok: true,
      refreshedAt: snapshot.automation.refreshedAt,
      durationMs: snapshot.automation.durationMs,
      checksum: snapshot.automation.checksum,
      backend: snapshot.automation.backend,
      nextGameweek: snapshot.nextGameweek,
      players: snapshot.players.length,
      action: snapshot.finalCommittee.action,
      calibration,
    }, { headers: ADMIN_HEADERS });
  } catch (error) {
    return NextResponse.json({
      error: 'fpl_refresh_failed',
      detail: error instanceof Error ? error.message : 'Unknown FPL automation error.',
    }, { status: 503, headers: ADMIN_HEADERS });
  }
}

export async function GET(request: NextRequest) {
  return refresh(request, 'scheduled');
}

export async function POST(request: NextRequest) {
  return refresh(request, 'manual');
}
