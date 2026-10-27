import type { PhaseFiveSnapshot } from '../phase5';
import type { CalibrationDashboardSummary } from './calibration';
import type { ModelLearningProfile } from './learning';

export type RefreshTrigger = 'scheduled' | 'manual' | 'bootstrap';
export type SnapshotFreshness = 'fresh' | 'aging' | 'stale';
export type SnapshotBackend = 'local' | 'supabase' | 'memory';

export interface StoredDashboardRecord {
  schemaVersion: 6;
  pipelineVersion: 'phase6-automation-v1';
  refreshedAt: string;
  trigger: RefreshTrigger;
  durationMs: number;
  checksum: string;
  snapshot: PhaseFiveSnapshot;
}

export interface AutomationMetadata {
  pipelineVersion: 'phase6-automation-v1';
  refreshedAt: string;
  ageMinutes: number;
  freshness: SnapshotFreshness;
  trigger: RefreshTrigger;
  durationMs: number;
  checksum: string;
  backend: SnapshotBackend;
}

export interface OperationalAlert {
  key: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
}

export interface OperationalSummary {
  nextDeadline: string | null;
  hoursToDeadline: number | null;
  deadlineMode: boolean;
  alerts: OperationalAlert[];
}

export interface ModelVersions {
  projection: 'phase2-transparent-v2';
  decision: 'phase3-decision-v1';
  explainability: 'phase4-explainability-v1';
  dashboard: 'phase5-dashboard-v1';
  automation: 'phase6-automation-v1';
  revision: '2026-10-28';
}

export type PhaseSixSnapshot = PhaseFiveSnapshot & {
  automation: AutomationMetadata;
  calibration: CalibrationDashboardSummary;
  learning: ModelLearningProfile;
  operations: OperationalSummary;
  modelVersions: ModelVersions;
};

export interface DashboardSnapshotStore {
  backend: SnapshotBackend;
  read(): Promise<StoredDashboardRecord | null>;
  write(record: StoredDashboardRecord): Promise<void>;
}
