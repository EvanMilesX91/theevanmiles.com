import { describe, expect, it } from 'vitest';
import type { PhaseFiveSnapshot } from '@/lib/fpl/phase5';
import {
  classifySnapshotFreshness,
  createCalibrationForecast,
  evaluateCalibrationRecord,
  loadAutomatedDashboard,
  refreshProjectionCalibration,
  refreshAutomatedDashboard,
  type DashboardSnapshotStore,
  type ProjectionCalibrationRecord,
  type ProjectionCalibrationStore,
  type StoredDashboardRecord,
} from '@/lib/fpl/phase6';

function phaseFive(generatedAt = '2026-10-26T05:15:00.000Z'): PhaseFiveSnapshot {
  return {
    schemaVersion: 5,
    viewVersion: 'phase5-dashboard-v1',
    generatedAt,
    currentGameweek: 8,
    nextGameweek: 9,
    sourceHealth: [],
    ledger: { managerName: 'Dominika', teamName: 'Test XI', nextGameweek: 9, bank: 0.5, freeTransfers: 1, stale: false },
    players: [],
    modelNotes: [],
  } as unknown as PhaseFiveSnapshot;
}

class MemoryStore implements DashboardSnapshotStore {
  readonly backend = 'memory' as const;
  record: StoredDashboardRecord | null = null;
  read = async () => this.record;
  write = async (record: StoredDashboardRecord) => { this.record = record; };
}

class MemoryCalibrationStore implements ProjectionCalibrationStore {
  readonly backend = 'memory' as const;
  records: ProjectionCalibrationRecord[] = [];
  readAll = async () => this.records;
  write = async (record: ProjectionCalibrationRecord) => {
    this.records = [...this.records.filter((item) => item.gameweek !== record.gameweek), record];
  };
}

describe('Phase 6 automation', () => {
  it('classifies daily snapshots without pretending old data is current', () => {
    const refreshed = '2026-10-26T05:15:00.000Z';
    expect(classifySnapshotFreshness(refreshed, new Date('2026-10-27T05:14:00.000Z')).freshness).toBe('fresh');
    expect(classifySnapshotFreshness(refreshed, new Date('2026-10-27T12:00:00.000Z')).freshness).toBe('aging');
    expect(classifySnapshotFreshness(refreshed, new Date('2026-10-28T06:00:00.000Z')).freshness).toBe('stale');
  });

  it('runs once, writes a checksummed record and serves the stored result', async () => {
    const store = new MemoryStore();
    let runs = 0;
    const refreshed = await refreshAutomatedDashboard({
      store,
      trigger: 'scheduled',
      now: new Date('2026-10-26T05:15:00.000Z'),
      runner: async () => { runs += 1; return phaseFive(); },
    });

    expect(runs).toBe(1);
    expect(refreshed.automation).toMatchObject({ backend: 'memory', freshness: 'fresh', trigger: 'scheduled' });
    expect(refreshed.automation.checksum).toMatch(/^[a-f0-9]{16}$/);
    expect(store.record?.schemaVersion).toBe(6);

    const loaded = await loadAutomatedDashboard(store, new Date('2026-10-26T06:15:00.000Z'));
    expect(loaded?.automation.ageMinutes).toBe(60);
    expect(runs).toBe(1);
  });

  it('returns no dashboard before the first successful refresh', async () => {
    expect(await loadAutomatedDashboard(new MemoryStore())).toBeNull();
  });

  it('freezes a projection and calculates post-Gameweek error from official points', () => {
    const snapshot = {
      ...phaseFive(),
      players: [
        { id: 1, name: 'One', owned: true, xPts1: 6, expectedMinutes: 90, confidence: 80 },
        { id: 2, name: 'Two', owned: true, xPts1: 4, expectedMinutes: 70, confidence: 60 },
      ],
      lineup: { starterIds: [1, 2], captainId: 1 },
    } as unknown as PhaseFiveSnapshot;
    const forecast = createCalibrationForecast(snapshot, new Date('2026-10-20T12:00:00.000Z'));
    const evaluated = evaluateCalibrationRecord(forecast, {
      elements: [
        { id: 1, stats: { total_points: 8, minutes: 90 } },
        { id: 2, stats: { total_points: 2, minutes: 60 } },
      ],
    }, new Date('2026-10-27T12:00:00.000Z'));
    expect(evaluated.evaluation?.selectedXi).toMatchObject({ projectedPoints: 10, actualPoints: 10, meanAbsoluteError: 2, bias: 0 });
    expect(evaluated.evaluation?.selectedXiProjectedWithCaptain).toBe(16);
    expect(evaluated.evaluation?.selectedXiActualWithCaptain).toBe(18);
  });

  it('keeps the first pre-deadline forecast instead of overwriting it', async () => {
    const store = new MemoryCalibrationStore();
    const first = { ...phaseFive(), nextGameweek: 9, players: [], lineup: { starterIds: [], captainId: 0 } } as unknown as PhaseFiveSnapshot;
    const second = { ...first, generatedAt: '2026-10-27T13:00:00.000Z' };
    const fetcher = async () => new Response(JSON.stringify({ events: [] }), { status: 200 });
    await refreshProjectionCalibration({ snapshot: first, store, fetcher, now: new Date('2026-10-27T10:00:00.000Z') });
    await refreshProjectionCalibration({ snapshot: second, store, fetcher, now: new Date('2026-10-27T13:00:00.000Z') });
    expect(store.records).toHaveLength(1);
    expect(store.records[0].capturedAt).toBe('2026-10-27T10:00:00.000Z');
  });
});
