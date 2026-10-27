import { createHash } from 'node:crypto';
import { runPhaseFive, type PhaseFiveSnapshot, type RunPhaseFiveOptions } from '../phase5';
import type { DashboardSnapshotStore, PhaseSixSnapshot, RefreshTrigger, SnapshotFreshness, StoredDashboardRecord } from './types';
import { loadCalibrationSummary, refreshProjectionCalibration, summarizeCalibration, type CalibrationDashboardSummary, type CalibrationRefreshResult, type ProjectionCalibrationStore } from './calibration';

const FRESH_MINUTES = 26 * 60;
const AGING_MINUTES = 48 * 60;

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
    },
    calibration,
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
  const snapshot = await (options.runner ?? runPhaseFive)({ ...options.runOptions, persist: false, now });
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
  return presentStoredDashboard(record, options.store.backend, now, calibration);
}

export async function loadAutomatedDashboard(store: DashboardSnapshotStore, now = new Date(), calibrationStore?: ProjectionCalibrationStore): Promise<PhaseSixSnapshot | null> {
  const record = await store.read();
  if (!record) return null;
  const calibration = calibrationStore ? await loadCalibrationSummary(calibrationStore) : summarizeCalibration([], 'memory');
  return presentStoredDashboard(record, store.backend, now, calibration);
}
