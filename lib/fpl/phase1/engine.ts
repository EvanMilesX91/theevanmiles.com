import { generateProactiveAlerts } from './alerts';
import { detectChanges } from './changes';
import { buildMonitoredPlayers } from './features';
import { cloneLedger, DEFAULT_OWNER_LEDGER, validateLedgerShape } from './ledger';
import { fetchPhaseOneOfficialData, type FetchLike, type PhaseOneOfficialData } from './provider';
import { getPhaseOnePaths, readLatestSnapshot, readLedger, writeLedger, writeSnapshot } from './store';
import type { PhaseOneSnapshot, SquadLedger } from './types';

export interface RunPhaseOneOptions {
  fetcher?: FetchLike;
  persist?: boolean;
  root?: string;
  ledger?: SquadLedger;
  previousSnapshot?: PhaseOneSnapshot | null;
  now?: Date;
  officialData?: PhaseOneOfficialData;
}

function calculateStructuralDebt(snapshot: Pick<PhaseOneSnapshot, 'players' | 'alerts'>): PhaseOneSnapshot['structuralDebt'] {
  const owned = snapshot.players.filter((player) => player.owned);
  const deadSlots = owned.filter((player) => !player.eligible || player.status === 'u').length;
  const premiumUnderperformers = snapshot.alerts.filter((alert) => alert.kind === 'premium_underperformer').length;
  const unreliableOwnedPlayers = owned.filter((player) => player.rolling3.minutes < 180 && player.seasonMinutes > 0).length;
  const weakValueSlots = owned.filter((player) => player.valueSignal < 8 && player.position !== 'GK').length;
  const score = Math.min(100, deadSlots * 30 + premiumUnderperformers * 20 + unreliableOwnedPlayers * 15 + weakValueSlots * 5);
  const reasons: string[] = [];
  if (deadSlots) reasons.push(`${deadSlots} confirmed squad slot${deadSlots === 1 ? '' : 's'} currently has no dependable playing utility.`);
  if (premiumUnderperformers) reasons.push(`${premiumUnderperformers} premium asset${premiumUnderperformers === 1 ? '' : 's'} is below the rolling return threshold.`);
  if (unreliableOwnedPlayers) reasons.push(`${unreliableOwnedPlayers} owned player${unreliableOwnedPlayers === 1 ? '' : 's'} has a recent minutes warning.`);
  if (weakValueSlots) reasons.push(`${weakValueSlots} outfield slot${weakValueSlots === 1 ? '' : 's'} is below the provisional value-signal threshold.`);
  if (!reasons.length) reasons.push('No automatic structural-debt trigger fired.');
  return { score, deadSlots, premiumUnderperformers, unreliableOwnedPlayers, reasons };
}

export async function runPhaseOne(options: RunPhaseOneOptions = {}): Promise<PhaseOneSnapshot> {
  const paths = getPhaseOnePaths(options.root);
  const persist = options.persist ?? process.env.VERCEL !== '1';
  const official = options.officialData ?? await fetchPhaseOneOfficialData(options.fetcher);
  const storedLedger = options.ledger ?? await readLedger(paths);
  const ledger = cloneLedger(storedLedger ?? DEFAULT_OWNER_LEDGER);
  const ledgerProblems = validateLedgerShape(ledger);
  if (ledgerProblems.length) throw new Error(`Owner ledger is invalid: ${ledgerProblems.join(' ')}`);
  const previousSnapshot = options.previousSnapshot === undefined ? await readLatestSnapshot(paths) : options.previousSnapshot;
  const players = buildMonitoredPlayers({
    bootstrap: official.bootstrap,
    fixtures: official.fixtures,
    eventLives: official.eventLives,
    ledger,
    nextGameweek: official.nextGameweek,
  });
  const changes = detectChanges(previousSnapshot, players);
  const alerts = generateProactiveAlerts({ players, ledger, changes });
  if (ledger.nextGameweek < official.nextGameweek) {
    alerts.unshift({
      kind: 'structural_warning',
      severity: 'critical',
      playerId: null,
      playerName: null,
      replacementId: null,
      replacementName: null,
      confidence: 100,
      reason: `The confirmed ledger stops before Gameweek ${official.nextGameweek}. Confirm the Gameweek ${ledger.nextGameweek} transfer, XI, captain and score before the engine advances squad state.`,
      evidence: [
        `Confirmed ledger next Gameweek: ${ledger.nextGameweek}`,
        `Official FPL next Gameweek: ${official.nextGameweek}`,
        'No proposed transfer has been recorded as completed.',
      ],
    });
  }
  const generatedAt = (options.now ?? new Date()).toISOString();
  const partial = { players, alerts };
  const snapshot: PhaseOneSnapshot = {
    schemaVersion: 1,
    generatedAt,
    currentGameweek: official.currentGameweek,
    nextGameweek: official.nextGameweek,
    sourceHealth: official.sourceHealth,
    ledger,
    players,
    changes,
    alerts,
    structuralDebt: calculateStructuralDebt(partial),
  };
  if (persist) {
    if (!storedLedger) await writeLedger(ledger, paths);
    await writeSnapshot(snapshot, paths);
  }
  return snapshot;
}
