import type { PhaseOneSnapshot, Position, SourceHealth } from '../phase1';

export type TacticalRole = 'goalkeeper' | 'defensive' | 'central' | 'advanced' | 'forward' | 'unknown';

export interface LineupObservation {
  playerId: number;
  gameweek: number;
  fixtureId: number;
  teamId: number;
  formation: string | null;
  status: 'starter' | 'substitute' | 'absent';
  actualPosition: string;
  grid: string | null;
  confidence: number;
  source: string;
  sourceUrl: string | null;
  retrievedAt: string;
}

export interface ForwardMinutesSignal {
  playerId: number;
  gameweek: number;
  expectedMinutes: number;
  playChance: number;
  projectedPoints: number;
  confidence: number;
  computedAt: string;
  source: 'FPL Cat';
  sourceUrl: string;
}

export interface AvailabilityObservation {
  playerId: number;
  teamId: number;
  observedGameweek: number;
  status: 'injury' | 'suspension' | 'doubt';
  reason: string;
  returnDate: string | null;
  returnLabel: string | null;
  confidence: number;
  source: 'LiveScore availability';
  sourceUrl: string;
  retrievedAt: string;
}

export interface ShadowLineupSignal {
  playerId: number;
  teamId: number;
  prediction: 'starter' | 'bench';
  confidence: number;
  listedStatus: string;
  contradiction: boolean;
  verifiedAt: string;
  source: 'Touchline Wire';
  sourceUrl: string;
}

export interface ModelLearningAdjustment {
  active: boolean;
  evaluatedGameweeks: number;
  effectiveGameweeks: number;
  forwardGameweeks: number;
  historicalGameweeks: number;
  pointsBiasCorrection: number;
  minutesBiasCorrection: number;
  priceDirectionalAccuracy: number | null;
  shadowLineupPromoted: boolean;
  reason: string;
}

export interface RoleAssessment {
  listedPosition: Position;
  tacticalRole: TacticalRole;
  change: 'confirmed' | 'possible' | 'none' | 'insufficient_data';
  confidence: number;
  observations: number;
  latestGameweek: number | null;
  evidence: string[];
}

export interface MinutesProjection {
  startProbability: number;
  appearanceProbability: number;
  expectedMinutesPerFixture: number;
  futureStartProbability?: number;
  futureAppearanceProbability?: number;
  futureExpectedMinutesPerFixture?: number;
  expectedMinutes1: number;
  expectedMinutes3: number;
  expectedMinutes6: number;
  rotationRisk: 'low' | 'medium' | 'high' | 'unavailable';
  confidence: number;
  evidence: string[];
}

export interface TeamRating {
  teamId: number;
  team: string;
  teamShort: string;
  matches: number;
  goalsForPerMatch: number;
  goalsAgainstPerMatch: number;
  recentGoalsForPerMatch: number;
  recentGoalsAgainstPerMatch: number;
  attackHome: number;
  attackAway: number;
  defenceHome: number;
  defenceAway: number;
  attackInjuryMultiplier: number;
  defenceInjuryMultiplier: number;
  confidence: number;
}

export interface InjuryImpact {
  playerId: number;
  playerName: string;
  teamId: number;
  availability: number;
  importance: number;
  attackReduction: number;
  defenceWeakening: number;
  fact: string;
  modelEffect: string;
}

export interface SustainablePerformance {
  observedPointsPer90: number;
  sustainablePointsPer90: number;
  expectedGoalsPer90: number;
  expectedAssistsPer90: number;
  regressedBonusPer90: number;
  defensiveContributionPointsPer90: number;
  regressionGap: number;
  label: 'underperforming' | 'sustainable' | 'overperforming' | 'insufficient_sample';
  confidence: number;
}

export interface FixtureProjection {
  gameweek: number;
  opponent: string;
  home: boolean;
  expectedMinutes: number;
  xPts: number;
  floor: number;
  ceiling: number;
  components: {
    appearance: number;
    goals: number;
    assists: number;
    cleanSheet: number;
    saves: number;
    defensiveContribution: number;
    bonus: number;
    discipline: number;
  };
  explanation: string;
}

export interface PlayerProjection {
  playerId: number;
  playerName: string;
  teamId: number;
  team: string;
  position: Position;
  price: number;
  owned: boolean;
  minutes: MinutesProjection;
  role: RoleAssessment;
  sustainability: SustainablePerformance;
  fixtures: FixtureProjection[];
  xPts1: number;
  xPts3: number;
  xPts6: number;
  floor1: number;
  ceiling1: number;
  confidence: number;
  oneLineReason: string;
  shadowLineup?: ShadowLineupSignal | null;
}

export interface PhaseTwoSnapshot {
  schemaVersion: 2;
  modelVersion: 'phase2-transparent-v2';
  generatedAt: string;
  currentGameweek: number;
  nextGameweek: number;
  sourceHealth: SourceHealth[];
  phaseOne: PhaseOneSnapshot;
  teamRatings: TeamRating[];
  injuryImpacts: InjuryImpact[];
  projections: PlayerProjection[];
  roleChanges: PlayerProjection[];
  shadowLineups: ShadowLineupSignal[];
  modelNotes: string[];
}
