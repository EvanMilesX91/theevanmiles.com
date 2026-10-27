import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PhaseOneSnapshot, SquadLedger } from './types';

export interface PhaseOnePaths {
  root: string;
  snapshotDirectory: string;
  latestSnapshot: string;
  ledger: string;
}

export function getPhaseOnePaths(root = process.cwd()): PhaseOnePaths {
  const snapshotDirectory = path.join(root, 'data', 'fpl', 'phase1');
  return {
    root,
    snapshotDirectory,
    latestSnapshot: path.join(snapshotDirectory, 'latest.json'),
    ledger: path.join(root, 'data', 'fpl', 'owner-ledger.json'),
  };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

export const readLatestSnapshot = (paths = getPhaseOnePaths()) => readJson<PhaseOneSnapshot>(paths.latestSnapshot);
export const readLedger = (paths = getPhaseOnePaths()) => readJson<SquadLedger>(paths.ledger);
export const writeLedger = (ledger: SquadLedger, paths = getPhaseOnePaths()) => atomicWrite(paths.ledger, ledger);

export async function writeSnapshot(snapshot: PhaseOneSnapshot, paths = getPhaseOnePaths()): Promise<void> {
  const safeTimestamp = snapshot.generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  await atomicWrite(path.join(paths.snapshotDirectory, `snapshot-${safeTimestamp}.json`), snapshot);
  await atomicWrite(paths.latestSnapshot, snapshot);
}
