import { loadEnvConfig } from '@next/env';
import {
  createDashboardSnapshotStore,
  createProjectionCalibrationStore,
  refreshAutomatedDashboard,
  type CalibrationRefreshResult,
} from '../lib/fpl/phase6';

loadEnvConfig(process.cwd());

async function main() {
  const remote = process.argv.includes('--remote');
  const root = process.cwd();
  const store = createDashboardSnapshotStore({ root, preferRemote: remote });
  const calibrationStore = createProjectionCalibrationStore({ root, preferRemote: remote });
  let calibration: CalibrationRefreshResult | null = null;
  const snapshot = await refreshAutomatedDashboard({
    store,
    calibrationStore,
    trigger: 'manual',
    onCalibration: (result) => { calibration = result; },
  });
  const lineup = snapshot.sourceHealth.find((source) => source.key === 'independent_lineups');
  const forwardMinutes = snapshot.sourceHealth.find((source) => source.key === 'forward_minutes_fpl_cat');
  const predictedLineups = snapshot.sourceHealth.find((source) => source.key === 'predicted_lineups_shadow');
  process.stdout.write(`${JSON.stringify({
    refreshedAt: snapshot.automation.refreshedAt,
    backend: snapshot.automation.backend,
    currentGameweek: snapshot.currentGameweek,
    nextGameweek: snapshot.nextGameweek,
    ledgerStale: snapshot.ledger.stale,
    action: snapshot.finalCommittee.action,
    confidence: snapshot.finalCommittee.confidence,
    players: snapshot.players.length,
    lineupSource: lineup,
    forwardMinutesSource: forwardMinutes,
    predictedLineupsSource: predictedLineups,
    calibration,
    calibrationSummary: snapshot.calibration,
    learning: snapshot.learning,
    operations: snapshot.operations,
    modelVersions: snapshot.modelVersions,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
