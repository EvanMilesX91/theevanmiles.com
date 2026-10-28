import type { Position, SourceHealth } from '../phase1';
import type { AvailabilityConsensus, FixtureProjection, InjuryImpact, TeamRating } from '../phase2';
import type { LineupDecision, NewPlayerAssessment, PricePressure, TransferDecision, ValueAssessment } from '../phase3';
import type { FinalCommittee, NotableOmission, PlayerComparison, PlayerCouncil, RedTeamReview } from '../phase4';

export interface DashboardPlayer {
  id: number;
  name: string;
  team: string;
  position: Position;
  price: number;
  owned: boolean;
  xPts1: number;
  xPts3: number;
  xPts6: number;
  floor1: number;
  ceiling1: number;
  confidence: number;
  expectedMinutes: number;
  startProbability: number;
  appearanceProbability: number;
  shadowLineupPrediction: 'starter' | 'bench' | null;
  shadowLineupConfidence: number | null;
  shadowLineupContradiction: boolean;
  availabilityConsensus?: AvailabilityConsensus;
  rotationRisk: string;
  role: string;
  roleChange: string;
  sustainability: string;
  oneLineReason: string;
  fixtures: FixtureProjection[];
  value: ValueAssessment;
  pricePressure: PricePressure;
  newPlayer: NewPlayerAssessment;
  council: PlayerCouncil;
}

export interface PhaseFiveSnapshot {
  schemaVersion: 5;
  viewVersion: 'phase5-dashboard-v1';
  generatedAt: string;
  currentGameweek: number;
  nextGameweek: number;
  deadlineTime: string | null;
  sourceHealth: SourceHealth[];
  ledger: {
    managerName: string;
    teamName: string;
    nextGameweek: number;
    bank: number;
    freeTransfers: number;
    stale: boolean;
  };
  lineup: LineupDecision;
  transferDecision: TransferDecision;
  finalCommittee: FinalCommittee;
  redTeam: RedTeamReview;
  transferComparisons: PlayerComparison[];
  notableOmissions: NotableOmission[];
  players: DashboardPlayer[];
  teamRatings: TeamRating[];
  injuryImpacts: InjuryImpact[];
  modelNotes: string[];
}
