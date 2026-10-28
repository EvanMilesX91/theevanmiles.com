import { fetchPhaseOneOfficialData, type FetchLike, type PhaseOneOfficialData, type SquadLedger } from '../phase1';
import type { ModelLearningAdjustment } from '../phase2';
import type { DecisionPlayer } from '../phase3';
import { runPhaseFour } from '../phase4';
import type { PlayerCouncil } from '../phase4';
import type { DashboardPlayer, PhaseFiveSnapshot } from './types';

export interface RunPhaseFiveOptions {
  fetcher?: FetchLike;
  persist?: boolean;
  root?: string;
  ledger?: SquadLedger;
  officialData?: PhaseOneOfficialData;
  now?: Date;
  lineupUrl?: string;
  learningAdjustment?: ModelLearningAdjustment;
}

export function isLedgerStale(confirmedNextGameweek: number, officialNextGameweek: number): boolean {
  return confirmedNextGameweek < officialNextGameweek;
}

export function buildDashboardPlayer(player: DecisionPlayer, council: PlayerCouncil, nextGameweek?: number): DashboardPlayer {
  const projection = player.projection;
  return {
    id: projection.playerId, name: projection.playerName, team: projection.team, position: projection.position,
    price: projection.price, owned: projection.owned,
    xPts1: projection.xPts1, xPts3: projection.xPts3, xPts6: projection.xPts6,
    floor1: projection.floor1, ceiling1: projection.ceiling1, confidence: projection.confidence,
    expectedMinutes: projection.minutes.expectedMinutesPerFixture,
    startProbability: projection.minutes.startProbability,
    appearanceProbability: projection.minutes.appearanceProbability,
    shadowLineupPrediction: projection.shadowLineup?.prediction ?? null,
    shadowLineupConfidence: projection.shadowLineup?.confidence ?? null,
    shadowLineupContradiction: projection.shadowLineup?.contradiction ?? false,
    availabilityConsensus: projection.availabilityConsensus,
    commentary: projection.commentary ?? null,
    rotationRisk: projection.minutes.rotationRisk, role: projection.role.tacticalRole,
    roleChange: projection.role.change, sustainability: projection.sustainability.label,
    oneLineReason: projection.oneLineReason, fixtures: nextGameweek == null ? projection.fixtures : projection.fixtures.filter((fixture) => fixture.gameweek >= nextGameweek && fixture.gameweek < nextGameweek + 6),
    value: player.value, pricePressure: player.pricePressure, newPlayer: player.newPlayer, council,
  };
}

export async function runPhaseFive(options: RunPhaseFiveOptions = {}): Promise<PhaseFiveSnapshot> {
  const officialData = options.officialData ?? await fetchPhaseOneOfficialData(options.fetcher);
  const phaseFour = await runPhaseFour({ ...options, officialData });
  const councilById = new Map(phaseFour.councils.map((council) => [council.playerId, council]));
  const ledger = phaseFour.phaseThree.phaseTwo.phaseOne.ledger;
  return {
    schemaVersion: 5, viewVersion: 'phase5-dashboard-v1', generatedAt: phaseFour.generatedAt,
    currentGameweek: phaseFour.currentGameweek, nextGameweek: phaseFour.nextGameweek,
    deadlineTime: officialData.bootstrap.events.find((event) => event.id === phaseFour.nextGameweek)?.deadline_time ?? null,
    sourceHealth: phaseFour.sourceHealth,
    ledger: {
      managerName: ledger.managerName, teamName: ledger.teamName, nextGameweek: ledger.nextGameweek,
      bank: ledger.bank, freeTransfers: ledger.freeTransfers, stale: isLedgerStale(ledger.nextGameweek, officialData.nextGameweek), chips: ledger.chips,
    },
    lineup: phaseFour.finalCommittee.primaryScenario.lineup,
    transferDecision: phaseFour.phaseThree.transferDecision,
    chipPlan: phaseFour.phaseThree.chipPlan,
    finalCommittee: phaseFour.finalCommittee,
    redTeam: phaseFour.redTeam,
    transferComparisons: phaseFour.transferComparisons,
    notableOmissions: phaseFour.notableOmissions,
    teamRatings: phaseFour.phaseThree.phaseTwo.teamRatings,
    injuryImpacts: phaseFour.phaseThree.phaseTwo.injuryImpacts,
    commentaryInsights: phaseFour.phaseThree.phaseTwo.commentaryInsights,
    players: phaseFour.phaseThree.players.map((player) => {
      const council = councilById.get(player.projection.playerId);
      if (!council) throw new Error(`Council result missing for player ${player.projection.playerId}.`);
      return buildDashboardPlayer(player, council, phaseFour.nextGameweek);
    }),
    modelNotes: phaseFour.modelNotes,
  };
}
