import { fetchPhaseOneOfficialData, type FetchLike, type PhaseOneOfficialData, type SquadLedger } from '../phase1';
import { runPhaseTwo, type ModelLearningAdjustment } from '../phase2';
import { optimizeLineup, optimizeTransfers } from './optimizer';
import { planChips } from './chips';
import { verifyPublicEntry } from './entry-sync';
import { writePhaseThreeSnapshot } from './store';
import type { PhaseThreeSnapshot, TransferDecision } from './types';
import { buildDecisionPlayers } from './value';

export interface RunPhaseThreeOptions {
  fetcher?: FetchLike;
  persist?: boolean;
  root?: string;
  ledger?: SquadLedger;
  officialData?: PhaseOneOfficialData;
  now?: Date;
  lineupUrl?: string;
  learningAdjustment?: ModelLearningAdjustment;
  entryId?: number | null;
}

export async function runPhaseThree(options: RunPhaseThreeOptions = {}): Promise<PhaseThreeSnapshot> {
  const root = options.root ?? process.cwd();
  const persist = options.persist ?? process.env.VERCEL !== '1';
  const officialData = options.officialData ?? await fetchPhaseOneOfficialData(options.fetcher);
  const phaseTwo = await runPhaseTwo({ ...options, root, persist, officialData });
  const players = buildDecisionPlayers(phaseTwo.projections, officialData.bootstrap.elements, options.learningAdjustment?.priceDirectionalAccuracy ?? null, options.learningAdjustment?.priceRiseThreshold ?? 85, options.learningAdjustment?.priceFallThreshold ?? -85);
  const playerById = new Map(players.map((player) => [player.projection.playerId, player]));
  const owned = phaseTwo.phaseOne.ledger.squad.map((entry) => playerById.get(entry.elementId)).filter((player): player is NonNullable<typeof player> => Boolean(player));
  const ownedLineup = optimizeLineup(owned);
  const optimized = optimizeTransfers({ players, ledger: phaseTwo.phaseOne.ledger, monitored: phaseTwo.phaseOne.players });
  const best = optimized.scenarios[0] ?? optimized.baseline;
  const ledgerStale = phaseTwo.phaseOne.ledger.nextGameweek < officialData.nextGameweek;
  const probabilityGate = best.hitCost > 0 ? 65 : 58;
  const worthwhile = best.decisionScore >= 0.75 && best.netGain3 > 0.75 && best.beatRollProbability3 >= probabilityGate && (best.hitCost === 0 || best.netGain6 >= 2);
  const transferDecision: TransferDecision = {
    status: ledgerStale ? 'provisional_stale_ledger' : 'ready',
    action: ledgerStale ? 'wait_for_ledger_confirmation' : worthwhile ? 'transfer' : 'roll',
    reason: ledgerStale
      ? `The confirmed ledger is for GW${phaseTwo.phaseOne.ledger.nextGameweek}, while official data is preparing GW${officialData.nextGameweek}. Confirm intervening actions before treating transfer output as executable.`
      : worthwhile ? best.explanation : `No legal transfer clears both the multi-horizon gain threshold and the ${probabilityGate}% chance-of-beating-roll gate after hit costs, so rolling is preferred.`,
    baseline: optimized.baseline,
    bestScenario: worthwhile ? best : optimized.baseline,
    alternatives: optimized.scenarios.slice(0, 5),
  };
  const entryVerification = await verifyPublicEntry({ ledger: phaseTwo.phaseOne.ledger, fetcher: options.fetcher, entryId: options.entryId });
  const chipPlan = planChips({
    players,
    ledger: phaseTwo.phaseOne.ledger,
    monitored: phaseTwo.phaseOne.players,
    fixtures: officialData.fixtures,
    teams: officialData.bootstrap.teams,
    nextGameweek: officialData.nextGameweek,
    ledgerStale,
    now: options.now ?? new Date(),
    deadlineTime: officialData.bootstrap.events.find((event) => event.id === officialData.nextGameweek)?.deadline_time ?? null,
    entryVerification,
  });
  const priceSourceHealth = {
    key: 'price_pressure_model', status: options.learningAdjustment?.priceDirectionalAccuracy != null && options.learningAdjustment.priceDirectionalAccuracy >= 60 ? 'healthy' as const : 'degraded' as const, retrievedAt: new Date().toISOString(), records: players.length,
    message: options.learningAdjustment?.priceDirectionalAccuracy != null
      ? `Uses official net transfer activity with observed directional accuracy of ${options.learningAdjustment.priceDirectionalAccuracy.toFixed(1)}%. FPL still publishes no threshold.`
      : 'Uses official net transfer activity as a relative pressure proxy. FPL publishes neither thresholds nor an official rise/fall forecast; calibration is collecting.',
  };
  const snapshot: PhaseThreeSnapshot = {
    schemaVersion: 3, modelVersion: 'phase3-decision-v1', generatedAt: (options.now ?? new Date()).toISOString(),
    currentGameweek: officialData.currentGameweek, nextGameweek: officialData.nextGameweek,
    sourceHealth: [...phaseTwo.sourceHealth, priceSourceHealth], phaseTwo, players, ownedLineup, transferDecision, chipPlan,
    modelNotes: [
      'The starting XI is selected by exhaustive legal-formation search; captaincy uses xPts, ceiling, minutes and confidence.',
      'Transfer scenarios use actual confirmed purchase/selling values, current bank, free transfers, club limits and positional constraints.',
      'One- and two-transfer routes are compared across 1/3/6 Gameweeks; hit costs are subtracted before ranking.',
      'A transfer must also clear an uncertainty-aware chance-of-beating-roll gate (58% without a hit; 65% with a hit).',
      'Value above replacement is positional and playing-minute filtered. Points-per-million is descriptive, not the optimizer objective.',
      'Limited-sample players remain selectable, but rates stay prior-shrunk and confidence-capped until role/minutes evidence arrives.',
      'No scenario mutates the owner ledger. Only an explicit user confirmation can record a completed transfer.',
      ...chipPlan.modelNotes,
    ],
  };
  if (persist) await writePhaseThreeSnapshot(snapshot, root);
  return snapshot;
}
