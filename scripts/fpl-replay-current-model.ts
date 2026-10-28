import path from 'node:path';
import { createProjectionCalibrationStore, replayCurrentModelFromArchive, summarizeCalibration } from '../lib/fpl/phase6';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const root = process.cwd();
  const archiveDirectory = path.resolve(argument('--archive-dir') ?? path.join(root, 'data', 'fpl'));
  const gameweeks = (argument('--gameweeks') ?? '2,3,4,5').split(',').map(Number).filter(Number.isInteger);
  const store = createProjectionCalibrationStore({ root, preferRemote: process.argv.includes('--remote') });
  const results = [];
  for (const gameweek of gameweeks) results.push(await replayCurrentModelFromArchive({ archiveDirectory, gameweek, store }));
  const summary = summarizeCalibration(await store.readAll(), store.backend);
  console.log(JSON.stringify({ replayedGameweeks: results.map((record) => record.gameweek), evidenceKind: 'current_model_replay',
    effectiveGameweeks: summary.effectiveGameweeks, pointsMae: summary.aggregate?.selectedXiMeanAbsoluteError,
    decisionAudits: results.map((record) => ({ gameweek: record.gameweek, audit: record.evaluation?.decision ?? null })) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
