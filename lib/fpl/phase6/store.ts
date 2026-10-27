import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DashboardSnapshotStore, StoredDashboardRecord } from './types';

type Fetcher = typeof fetch;

function isStoredRecord(value: unknown): value is StoredDashboardRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredDashboardRecord>;
  return record.schemaVersion === 6 && record.pipelineVersion === 'phase6-automation-v1' &&
    typeof record.refreshedAt === 'string' && Number.isFinite(new Date(record.refreshedAt).getTime()) &&
    ['scheduled', 'manual', 'bootstrap'].includes(record.trigger ?? '') &&
    typeof record.durationMs === 'number' && Number.isFinite(record.durationMs) && record.durationMs >= 0 &&
    typeof record.checksum === 'string' && /^[a-f0-9]{16}$/.test(record.checksum) &&
    !!record.snapshot && record.snapshot.schemaVersion === 5;
}

export class LocalDashboardSnapshotStore implements DashboardSnapshotStore {
  readonly backend = 'local' as const;
  readonly filePath: string;

  constructor(root = process.cwd()) {
    this.filePath = path.join(root, 'data', 'fpl', 'phase6', 'latest.json');
  }

  async read(): Promise<StoredDashboardRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (!isStoredRecord(parsed)) throw new Error('The stored Phase 6 dashboard record has an invalid schema.');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(record: StoredDashboardRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, 'utf8');
    await rename(temporary, this.filePath);
  }
}

export class SupabaseDashboardSnapshotStore implements DashboardSnapshotStore {
  readonly backend = 'supabase' as const;
  private readonly endpoint: string;

  constructor(private readonly url: string, private readonly serviceKey: string, private readonly fetcher: Fetcher = fetch) {
    this.endpoint = `${url.replace(/\/$/, '')}/rest/v1/fpl_dashboard_snapshots`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, ...extra };
  }

  async read(): Promise<StoredDashboardRecord | null> {
    const response = await this.fetcher(`${this.endpoint}?id=eq.latest&select=payload`, {
      headers: this.headers({ Accept: 'application/json' }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Phase 6 Supabase read failed (${response.status}). Apply the FPL snapshot migration before enabling automation.`);
    const rows = await response.json() as Array<{ payload?: unknown }>;
    if (!rows[0]) return null;
    if (!isStoredRecord(rows[0].payload)) throw new Error('The Supabase Phase 6 payload has an invalid schema.');
    return rows[0].payload;
  }

  async write(record: StoredDashboardRecord): Promise<void> {
    const response = await this.fetcher(`${this.endpoint}?on_conflict=id`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({
        id: 'latest', generated_at: record.snapshot.generatedAt, refreshed_at: record.refreshedAt,
        trigger: record.trigger, duration_ms: record.durationMs, checksum: record.checksum, payload: record,
        updated_at: record.refreshedAt,
      }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Phase 6 Supabase write failed (${response.status}).`);
  }
}

export function createDashboardSnapshotStore(options: { root?: string; preferRemote?: boolean; fetcher?: Fetcher } = {}): DashboardSnapshotStore {
  if (!options.preferRemote) return new LocalDashboardSnapshotStore(options.root);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Phase 6 production persistence requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return new SupabaseDashboardSnapshotStore(url, key, options.fetcher);
}
