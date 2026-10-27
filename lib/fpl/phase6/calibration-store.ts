import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectionCalibrationRecord, ProjectionCalibrationStore } from './calibration';

type Fetcher = typeof fetch;

function isCalibrationRecord(value: unknown): value is ProjectionCalibrationRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ProjectionCalibrationRecord>;
  return record.schemaVersion === 1 && record.modelVersion === 'phase6-calibration-v1' &&
    Number.isInteger(record.gameweek) && (record.gameweek ?? 0) >= 1 && (record.gameweek ?? 0) <= 38 &&
    typeof record.capturedAt === 'string' && Array.isArray(record.players);
}

export class LocalProjectionCalibrationStore implements ProjectionCalibrationStore {
  readonly backend = 'local' as const;
  readonly directory: string;

  constructor(root = process.cwd()) {
    this.directory = path.join(root, 'data', 'fpl', 'calibration');
  }

  async readAll(): Promise<ProjectionCalibrationRecord[]> {
    try {
      const files = (await readdir(this.directory)).filter((file) => /^gw\d+\.json$/.test(file));
      const records = await Promise.all(files.map(async (file) => {
        const parsed = JSON.parse(await readFile(path.join(this.directory, file), 'utf8')) as unknown;
        if (!isCalibrationRecord(parsed)) throw new Error(`Invalid FPL calibration record: ${file}`);
        return parsed;
      }));
      return records.sort((a, b) => a.gameweek - b.gameweek);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async write(record: ProjectionCalibrationRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `gw${record.gameweek}.json`);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, 'utf8');
    await rename(temporary, destination);
  }
}

export class SupabaseProjectionCalibrationStore implements ProjectionCalibrationStore {
  readonly backend = 'supabase' as const;
  private readonly endpoint: string;

  constructor(private readonly url: string, private readonly serviceKey: string, private readonly fetcher: Fetcher = fetch) {
    this.endpoint = `${url.replace(/\/$/, '')}/rest/v1/fpl_projection_calibration`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, ...extra };
  }

  async readAll(): Promise<ProjectionCalibrationRecord[]> {
    const response = await this.fetcher(`${this.endpoint}?select=payload&order=gameweek.asc`, {
      headers: this.headers({ Accept: 'application/json' }), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`FPL calibration Supabase read failed (${response.status}). Apply the calibration migration.`);
    const rows = await response.json() as Array<{ payload?: unknown }>;
    return rows.map((row, index) => {
      if (!isCalibrationRecord(row.payload)) throw new Error(`Invalid Supabase calibration payload at row ${index}.`);
      return row.payload;
    });
  }

  async write(record: ProjectionCalibrationRecord): Promise<void> {
    const response = await this.fetcher(`${this.endpoint}?on_conflict=gameweek`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({
        gameweek: record.gameweek,
        captured_at: record.capturedAt,
        evaluated_at: record.evaluation?.evaluatedAt ?? null,
        payload: record,
        updated_at: new Date().toISOString(),
      }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`FPL calibration Supabase write failed (${response.status}).`);
  }
}

export function createProjectionCalibrationStore(options: { root?: string; preferRemote?: boolean; fetcher?: Fetcher } = {}): ProjectionCalibrationStore {
  if (!options.preferRemote) return new LocalProjectionCalibrationStore(options.root);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Production calibration persistence requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return new SupabaseProjectionCalibrationStore(url, key, options.fetcher);
}
