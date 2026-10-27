import { fetchPhaseOneOfficialData, type FetchLike, type PhaseOneOfficialData, type SquadLedger } from '../phase1';
import type { ModelLearningAdjustment } from '../phase2';
import { runPhaseThree, optimizeTransfers } from '../phase3';
import { COUNCIL_WEIGHTS } from './config';
import { buildPlayerCouncils } from './council';
import { buildNotableOmissions, buildTransferComparisons } from './comparison';
import { buildRedTeamReview } from './red-team';
import { writePhaseFourSnapshot } from './store';
import type { EvidenceStatement, FinalCommittee, PhaseFourSnapshot } from './types';

export interface RunPhaseFourOptions {
  fetcher?: FetchLike;
  persist?: boolean;
  root?: string;
  ledger?: SquadLedger;
  officialData?: PhaseOneOfficialData;
  now?: Date;
  lineupUrl?: string;
  learningAdjustment?: ModelLearningAdjustment;
}

function resultingIds(ownedIds: number[], moves: Array<{ outPlayerId: number; inPlayerId: number }>): Set<number> {
  const ids = new Set(ownedIds);
  for (const move of moves) {
    ids.delete(move.outPlayerId);
    ids.add(move.inPlayerId);
  }
  return ids;
}

export async function runPhaseFour(options: RunPhaseFourOptions = {}): Promise<PhaseFourSnapshot> {
  const root = options.root ?? process.cwd();
  const persist = options.persist ?? process.env.VERCEL !== '1';
  const officialData = options.officialData ?? await fetchPhaseOneOfficialData(options.fetcher);
  const phaseThree = await runPhaseThree({ ...options, root, persist, officialData });
  const captainIds = new Set(phaseThree.ownedLineup.captaincy.map((candidate) => candidate.playerId));
  const councils = buildPlayerCouncils(phaseThree.players, phaseThree.phaseTwo.phaseOne.players, captainIds);
  const expanded = optimizeTransfers({ players: phaseThree.players, ledger: phaseThree.phaseTwo.phaseOne.ledger, monitored: phaseThree.phaseTwo.phaseOne.players });
  const primary = phaseThree.transferDecision.bestScenario;
  const ownedIds = phaseThree.phaseTwo.phaseOne.ledger.squad.map((entry) => entry.elementId);
  const selectedIds = resultingIds(ownedIds, primary.moves);
  const transferComparisons = buildTransferComparisons(primary, phaseThree.players, councils);
  const notableOmissions = buildNotableOmissions({ players: phaseThree.players, councils, selectedIds });
  const staleLedger = phaseThree.transferDecision.status === 'provisional_stale_ledger';
  const redTeam = buildRedTeamReview({
    primary, scenarios: expanded.scenarios, baseline: expanded.baseline, players: phaseThree.players, councils, ownedIds,
    sourceHealth: phaseThree.sourceHealth, staleLedger,
  });
  const councilById = new Map(councils.map((council) => [council.playerId, council]));
  const xiCouncil = primary.lineup.starterIds.map((id) => councilById.get(id)).filter((council): council is NonNullable<typeof council> => Boolean(council));
  const committeeConfidence = Math.round(xiCouncil.reduce((sum, council) => sum + council.confidence, 0) / Math.max(1, xiCouncil.length));
  const moves = primary.moves.map((move) => `${move.outPlayerName} → ${move.inPlayerName}`).join('; ');
  const action = staleLedger ? 'wait_for_ledger_confirmation' : phaseThree.transferDecision.action;
  const decisionLine = staleLedger
    ? `WAIT: confirm the missing ledger state before acting on the provisional ${moves || 'roll'} scenario.`
    : action === 'transfer' ? `TRANSFER: ${moves}.` : 'ROLL: no transfer clears the net-gain and Red Team thresholds.';
  const evidenceChain: EvidenceStatement[] = [
    { kind: 'fact', statement: `Confirmed ledger next Gameweek: ${phaseThree.phaseTwo.phaseOne.ledger.nextGameweek}; official next Gameweek: ${officialData.nextGameweek}.` },
    { kind: 'data', statement: `The proposed XI has ${primary.lineup.xPts1BeforeCaptain} model xPts before captaincy and passes the legal-formation validator: ${primary.lineup.validation.pass}.` },
    { kind: 'model_estimate', statement: primary.moves.length ? `${moves} projects ${primary.netGain3} net points over three Gameweeks and ${primary.netGain6} over six after hits.` : 'The roll baseline has zero incremental model gain by definition.' },
    { kind: 'interpretation', statement: redTeam.strongestObjection },
    { kind: 'decision', statement: decisionLine },
  ];
  const finalCommittee: FinalCommittee = {
    status: staleLedger ? 'blocked_pending_ledger' : 'executable', action,
    primaryScenario: primary, alternativeScenario: redTeam.alternativeScenario,
    confidence: staleLedger ? Math.min(committeeConfidence, 45) : committeeConfidence,
    decisionLine,
    rationale: [
      primary.explanation,
      `The selected XI averages ${committeeConfidence}% Council evidence confidence.`,
      `Red Team verdict: ${redTeam.verdict}; strongest objection: ${redTeam.strongestObjection}`,
    ],
    evidenceChain,
  };
  const explanationHealth = { key: 'decision_council', status: 'healthy' as const, retrievedAt: new Date().toISOString(), records: councils.length, message: 'Ten deterministic, feature-distinct lenses scored every player; disagreements are retained rather than averaged away.' };
  const snapshot: PhaseFourSnapshot = {
    schemaVersion: 4, modelVersion: 'phase4-explainability-v1', generatedAt: (options.now ?? new Date()).toISOString(),
    currentGameweek: officialData.currentGameweek, nextGameweek: officialData.nextGameweek,
    sourceHealth: [...phaseThree.sourceHealth, explanationHealth], phaseThree, councils, transferComparisons, notableOmissions,
    redTeam, finalCommittee, councilWeights: COUNCIL_WEIGHTS,
    modelNotes: [
      'Council lenses are deterministic feature views, not simulated personalities or independent language-model votes.',
      'Historical confidence is capped because the current clean pipeline does not yet include a verified multi-season identity-matched dataset.',
      'Council disagreement is surfaced for likely participants when the lens spread reaches 45 points or strong upside conflicts with a strong caution score.',
      'The Red Team searches for a structurally different legal transfer route and can block execution when the ledger is stale.',
      'Facts, observed data, model estimates, interpretation and the final decision are emitted as separate evidence statements.',
      'No recommendation or explanation mutates the confirmed squad ledger.',
    ],
  };
  if (persist) await writePhaseFourSnapshot(snapshot, root);
  return snapshot;
}
