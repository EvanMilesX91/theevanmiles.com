import { describe, expect, it } from 'vitest';
import type { PhaseFiveSnapshot } from '@/lib/fpl/phase5';
import {
  classifySnapshotFreshness,
  createHistoricalCalibrationRecord,
  createCalibrationForecast,
  deriveModelLearning,
  evaluateCalibrationRecord,
  loadAutomatedDashboard,
  refreshProjectionCalibration,
  refreshAutomatedDashboard,
  summarizeCalibration,
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
    deadlineTime: '2026-10-26T10:15:00.000Z',
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
    expect(refreshed.operations).toMatchObject({ hoursToDeadline: 5, deadlineMode: true });
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
        { id: 1, name: 'One', owned: true, price: 5, xPts1: 6, expectedMinutes: 90, confidence: 80, pricePressure: { direction: 'likely_rise', confidence: 60 }, shadowLineupPrediction: 'starter', shadowLineupConfidence: 80, shadowLineupContradiction: false },
        { id: 2, name: 'Two', owned: true, price: 6, xPts1: 4, expectedMinutes: 70, confidence: 60, pricePressure: { direction: 'stable', confidence: 30 }, shadowLineupPrediction: 'bench', shadowLineupConfidence: 80, shadowLineupContradiction: false },
      ],
      lineup: { starterIds: [1, 2], captainId: 1 },
    } as unknown as PhaseFiveSnapshot;
    const forecast = createCalibrationForecast(snapshot, new Date('2026-10-20T12:00:00.000Z'));
    const evaluated = evaluateCalibrationRecord(forecast, {
      elements: [
        { id: 1, stats: { total_points: 8, minutes: 90 } },
        { id: 2, stats: { total_points: 2, minutes: 60 } },
      ],
    }, new Date('2026-10-27T12:00:00.000Z'), new Map([[1, 5.1], [2, 6]]));
    expect(evaluated.evaluation?.selectedXi).toMatchObject({ projectedPoints: 10, actualPoints: 10, meanAbsoluteError: 2, bias: 0 });
    expect(evaluated.evaluation?.selectedXiProjectedWithCaptain).toBe(16);
    expect(evaluated.evaluation?.selectedXiActualWithCaptain).toBe(18);
    expect(evaluated.evaluation?.prices).toMatchObject({ directionalCalls: 1, directionalAccuracy: 100 });
    expect(evaluated.evaluation?.shadowLineups).toMatchObject({ predictions: 2, accuracy: 50 });
    const summary = summarizeCalibration([evaluated], 'memory');
    expect(summary).toMatchObject({
      status: 'measured',
      evaluatedGameweeks: [9],
      forwardEvaluatedGameweeks: [9],
      historicalEvaluatedGameweeks: [],
      effectiveGameweeks: 1,
      pendingGameweeks: [],
      aggregate: { selectedXiMeanAbsoluteError: 2, selectedXiBias: 0, projectedWithCaptain: 16, actualWithCaptain: 18 },
      latestEvaluation: { gameweek: 9, projectedWithCaptain: 16, actualWithCaptain: 18 },
    });
  });

  it('labels an unevaluated forecast as collecting instead of inventing accuracy', () => {
    const snapshot = { ...phaseFive(), players: [], lineup: { starterIds: [], captainId: 0 } } as unknown as PhaseFiveSnapshot;
    expect(summarizeCalibration([createCalibrationForecast(snapshot)], 'memory')).toMatchObject({
      status: 'collecting', trackedGameweeks: 1, evaluatedGameweeks: [], pendingGameweeks: [9], aggregate: null,
    });
  });

  it('locks model learning for four Gameweeks and caps corrections once active', () => {
    const snapshot = { ...phaseFive(), players: [{ id: 1, name: 'One', owned: true, price: 5, xPts1: 6, expectedMinutes: 80, confidence: 80, pricePressure: { direction: 'stable', confidence: 30 } }], lineup: { starterIds: [1], captainId: 1 } } as unknown as PhaseFiveSnapshot;
    const records = [9, 10, 11, 12].map((gameweek) => evaluateCalibrationRecord({ ...createCalibrationForecast({ ...snapshot, nextGameweek: gameweek } as PhaseFiveSnapshot), gameweek }, { elements: [{ id: 1, stats: { total_points: 3, minutes: 60 } }] }));
    const locked = deriveModelLearning(summarizeCalibration(records.slice(0, 3), 'memory'));
    const active = deriveModelLearning(summarizeCalibration(records, 'memory'));
    expect(locked.active).toBe(false);
    expect(active).toMatchObject({ active: true, evaluatedGameweeks: 4, effectiveGameweeks: 4, forwardGameweeks: 4, historicalGameweeks: 0, pointsBiasCorrection: 0.75, minutesBiasCorrection: 8 });
  });

  it('uses historical backtests at half weight and keeps predicted-lineup learning forward-only', () => {
    const snapshot = { ...phaseFive(), players: [{ id: 1, name: 'One', owned: true, price: 5, xPts1: 6, expectedMinutes: 80, confidence: 80, pricePressure: { direction: 'stable', confidence: 30 } }], lineup: { starterIds: [1], captainId: 1 } } as unknown as PhaseFiveSnapshot;
    const evaluated = (gameweek: number, evidenceKind: 'forward' | 'historical_backtest') => evaluateCalibrationRecord({
      ...createCalibrationForecast({ ...snapshot, nextGameweek: gameweek } as PhaseFiveSnapshot),
      gameweek,
      evidenceKind,
      evidenceWeight: evidenceKind === 'historical_backtest' ? 0.5 : 1,
    }, { elements: [{ id: 1, stats: { total_points: 3, minutes: 60 } }] });
    const historical = [2, 3, 4, 5].map((gameweek) => evaluated(gameweek, 'historical_backtest'));
    const warmStart = summarizeCalibration(historical, 'memory');
    expect(warmStart).toMatchObject({
      historicalEvaluatedGameweeks: [2, 3, 4, 5],
      forwardEvaluatedGameweeks: [],
      effectiveGameweeks: 2,
    });
    expect(deriveModelLearning(warmStart)).toMatchObject({ active: false, effectiveGameweeks: 2, historicalGameweeks: 4, forwardGameweeks: 0, shadowLineupPromotion: 'locked' });
    const active = deriveModelLearning(summarizeCalibration([...historical, evaluated(9, 'forward'), evaluated(10, 'forward')], 'memory'));
    expect(active).toMatchObject({ active: true, effectiveGameweeks: 4, historicalGameweeks: 4, forwardGameweeks: 2, shadowLineupPromotion: 'locked' });
  });

  it('converts an archived pre-deadline squad into reduced-weight calibration evidence', () => {
    const player = (id: number, name: string, xPts: number) => ({
      id, name, price: 5, confidence: 70, expectedMinutesNext: 80, xPts1: xPts,
      fixtures: [{ gameweek: 4, kickoffTime: '2026-09-12T14:00:00.000Z' }],
      gameweekProjections: [{ gameweek: 4, expectedMinutes: 79, xPts }],
      pricePrediction: { direction: 'rise', likelihood: 5, confidence: 90 },
    });
    const one = player(1, 'One', 6);
    const two = player(2, 'Two', 4);
    const record = createHistoricalCalibrationRecord({
      modelVersion: 'legacy-v1', generatedAt: '2026-09-12T08:00:00.000Z', nextGameweek: 4,
      primary: { players: [one, two], starters: [one], captain: one },
    });
    expect(record).toMatchObject({
      gameweek: 4,
      evidenceKind: 'historical_backtest',
      evidenceWeight: 0.5,
      sourceModelVersion: 'legacy-v1',
    });
    expect(record.players[0]).toMatchObject({ playerId: 1, starter: true, captain: true, projectedPoints: 6, projectedMinutes: 79, priceDirection: 'likely_rise' });
    const evaluated = evaluateCalibrationRecord(record, { elements: [{ id: 1, stats: { total_points: 5, minutes: 90 } }, { id: 2, stats: { total_points: 2, minutes: 20 } }] }, new Date(), new Map([[1, 5.1]]));
    expect(evaluated.evaluation?.prices).toMatchObject({ players: 0, directionalCalls: 0 });
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

  it('replaces a stale-ledger forecast once the owner confirms the actual squad', async () => {
    const store = new MemoryCalibrationStore();
    const stale = { ...phaseFive(), nextGameweek: 9, ledger: { ...phaseFive().ledger, stale: true }, players: [], lineup: { starterIds: [], captainId: 0 } } as unknown as PhaseFiveSnapshot;
    const confirmed = { ...stale, ledger: { ...stale.ledger, stale: false } };
    const fetcher = async () => new Response(JSON.stringify({ events: [] }), { status: 200 });
    await refreshProjectionCalibration({ snapshot: stale, store, fetcher, now: new Date('2026-10-27T10:00:00.000Z') });
    const result = await refreshProjectionCalibration({ snapshot: confirmed, store, fetcher, now: new Date('2026-10-27T13:00:00.000Z') });
    expect(result).toMatchObject({ forecastCreated: false, forecastReplaced: true });
    expect(store.records[0]).toMatchObject({ capturedAt: '2026-10-27T13:00:00.000Z', ledgerStale: false });
  });
});
