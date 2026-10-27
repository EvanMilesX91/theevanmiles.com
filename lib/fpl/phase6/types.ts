import type { PhaseFiveSnapshot } from '../phase5';

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

export type PhaseSixSnapshot = PhaseFiveSnapshot & {
  automation: AutomationMetadata;
};

export interface DashboardSnapshotStore {
  backend: SnapshotBackend;
  read(): Promise<StoredDashboardRecord | null>;
  write(record: StoredDashboardRecord): Promise<void>;
}
