import { createHash } from 'node:crypto';
import { runPhaseFive, type PhaseFiveSnapshot, type RunPhaseFiveOptions } from '../phase5';
import type { DashboardSnapshotStore, OperationalAlert, OperationalSummary, PhaseSixSnapshot, RefreshTrigger, SnapshotFreshness, StoredDashboardRecord } from './types';
import { loadCalibrationSummary, refreshProjectionCalibration, summarizeCalibration, type CalibrationDashboardSummary, type CalibrationRefreshResult, type ProjectionCalibrationStore } from './calibration';
import { deriveModelLearning } from './learning';

const FRESH_MINUTES = 26 * 60;
const AGING_MINUTES = 48 * 60;

function buildOperationalSummary(snapshot: PhaseFiveSnapshot, now: Date): OperationalSummary {
  const deadline = snapshot.deadlineTime ? new Date(snapshot.deadlineTime) : null;
  const hoursToDeadline = deadline && Number.isFinite(deadline.getTime()) ? Math.round((deadline.getTime() - now.getTime()) / 360_000) / 10 : null;
  const alerts: OperationalAlert[] = snapshot.sourceHealth.flatMap((source): OperationalAlert[] => source.status === 'healthy' ? [] : [{
    key: `source_${source.key}`,
    severity: source.status === 'failed' && source.key !== 'predicted_lineups_shadow' ? 'high' as const : 'medium' as const,
    message: `${source.key}: ${source.message}`,
  }]);
  if (snapshot.ledger.stale) alerts.unshift({ key: 'ledger_stale', severity: 'critical', message: `The confirmed ledger targets GW${snapshot.ledger.nextGameweek}, but the model is preparing GW${snapshot.nextGameweek}.` });
  if (hoursToDeadline !== null && hoursToDeadline >= 0 && hoursToDeadline <= 8) alerts.push({ key: 'deadline_window', severity: 'low', message: `${hoursToDeadline.toFixed(1)} hours remain until the GW${snapshot.nextGameweek} deadline; deadline-mode refreshes are active.` });
  return { nextDeadline: snapshot.deadlineTime, hoursToDeadline, deadlineMode: hoursToDeadline !== null && hoursToDeadline >= 0 && hoursToDeadline <= 8, alerts };
}

export function classifySnapshotFreshness(refreshedAt: string, now = new Date()): { freshness: SnapshotFreshness; ageMinutes: number } {
  const ageMinutes = Math.max(0, Math.round((now.getTime() - new Date(refreshedAt).getTime()) / 60_000));
  if (!Number.isFinite(ageMinutes)) return { freshness: 'stale', ageMinutes: Number.MAX_SAFE_INTEGER };
  if (ageMinutes <= FRESH_MINUTES) return { freshness: 'fresh', ageMinutes };
  if (ageMinutes <= AGING_MINUTES) return { freshness: 'aging', ageMinutes };
  return { freshness: 'stale', ageMinutes };
}

export function presentStoredDashboard(
  record: StoredDashboardRecord,
  backend: DashboardSnapshotStore['backend'],
  now = new Date(),
  calibration: CalibrationDashboardSummary = summarizeCalibration([], 'memory'),
  immutableSnapshots = 0,
): PhaseSixSnapshot {
  const freshness = classifySnapshotFreshness(record.refreshedAt, now);
  return {
    ...record.snapshot,
    automation: {
      pipelineVersion: record.pipelineVersion,
      refreshedAt: record.refreshedAt,
      ...freshness,
      trigger: record.trigger,
      durationMs: record.durationMs,
      checksum: record.checksum,
      backend,
      immutableSnapshots,
    },
    calibration,
    learning: deriveModelLearning(calibration),
    operations: buildOperationalSummary(record.snapshot, now),
    modelVersions: {
      projection: 'phase2-transparent-v2', decision: 'phase3-decision-v1', explainability: 'phase4-explainability-v1',
      dashboard: 'phase5-dashboard-v1', automation: 'phase6-automation-v1', revision: '2026-10-28.3',
    },
  };
}

export interface RefreshAutomatedDashboardOptions {
  store: DashboardSnapshotStore;
  trigger: RefreshTrigger;
  now?: Date;
  runner?: (options: RunPhaseFiveOptions) => Promise<PhaseFiveSnapshot>;
  runOptions?: RunPhaseFiveOptions;
  calibrationStore?: ProjectionCalibrationStore;
  onCalibration?: (result: CalibrationRefreshResult) => void;
}

export async function refreshAutomatedDashboard(options: RefreshAutomatedDashboardOptions): Promise<PhaseSixSnapshot> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const calibrationBeforeRun = options.calibrationStore ? await loadCalibrationSummary(options.calibrationStore) : summarizeCalibration([], 'memory');
  const learningAdjustment = deriveModelLearning(calibrationBeforeRun);
  const snapshot = await (options.runner ?? runPhaseFive)({ ...options.runOptions, persist: false, now, learningAdjustment });
  const record: StoredDashboardRecord = {
    schemaVersion: 6,
    pipelineVersion: 'phase6-automation-v1',
    refreshedAt: now.toISOString(),
    trigger: options.trigger,
    durationMs: Math.max(0, Date.now() - started),
    checksum: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16),
    snapshot,
  };
  await options.store.write(record);
  const immutableSnapshots = await options.store.historyCount();
  let calibration = summarizeCalibration([], 'memory');
  if (options.calibrationStore) {
    const result = await refreshProjectionCalibration({
      snapshot,
      store: options.calibrationStore,
      fetcher: options.runOptions?.fetcher,
      now,
    });
    options.onCalibration?.(result);
    calibration = await loadCalibrationSummary(options.calibrationStore);
  }
  return presentStoredDashboard(record, options.store.backend, now, calibration, immutableSnapshots);
}

export async function loadAutomatedDashboard(store: DashboardSnapshotStore, now = new Date(), calibrationStore?: ProjectionCalibrationStore): Promise<PhaseSixSnapshot | null> {
  const record = await store.read();
  if (!record) return null;
  const calibration = calibrationStore ? await loadCalibrationSummary(calibrationStore) : summarizeCalibration([], 'memory');
  return presentStoredDashboard(record, store.backend, now, calibration, await store.historyCount());
}
