import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PhaseTwoSnapshot } from './types';

export async function writePhaseTwoSnapshot(snapshot: PhaseTwoSnapshot, root = process.cwd()): Promise<void> {
  const directory = path.join(root, 'data', 'fpl', 'phase2', 'snapshots');
  await fs.mkdir(directory, { recursive: true });
  const stamp = snapshot.generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  await Promise.all([
    fs.writeFile(path.join(directory, `${stamp}.json`), body, 'utf8'),
    fs.writeFile(path.join(root, 'data', 'fpl', 'phase2', 'latest.json'), body, 'utf8'),
  ]);
}
