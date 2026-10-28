import path from 'node:path';
import {
  backfillHistoricalCalibration,
  createProjectionCalibrationStore,
  summarizeCalibration,
} from '../lib/fpl/phase6';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const root = process.cwd();
  const archiveDirectory = path.resolve(argument('--archive-dir') ?? path.join(root, 'data', 'fpl'));
  const remote = process.argv.includes('--remote');
  const gameweeks = (argument('--gameweeks') ?? '2,3,4,5').split(',').map(Number).filter(Number.isInteger);
  if (!gameweeks.length) throw new Error('Provide at least one valid Gameweek with --gameweeks.');
  const store = createProjectionCalibrationStore({ root, preferRemote: remote });
  const result = await backfillHistoricalCalibration({ archiveDirectory, store, gameweeks });
  const summary = summarizeCalibration(await store.readAll(), store.backend);
  console.log(JSON.stringify({
    archiveDirectory,
    backend: store.backend,
    importedGameweeks: result.importedGameweeks,
    skippedGameweeks: result.skippedGameweeks,
    historicalEvaluatedGameweeks: summary.historicalEvaluatedGameweeks,
    forwardEvaluatedGameweeks: summary.forwardEvaluatedGameweeks,
    effectiveGameweeks: summary.effectiveGameweeks,
    pointsMae: summary.aggregate?.selectedXiMeanAbsoluteError ?? null,
    minutesMae: summary.aggregate?.minutesMeanAbsoluteError ?? null,
    pointsBias: summary.aggregate?.selectedXiBias ?? null,
    priceDirectionalAccuracy: summary.aggregate?.priceDirectionalAccuracy ?? null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
