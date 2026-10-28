import type { PhaseTwoSnapshot, PlayerProjection } from '../phase2';
import type { Position, SourceHealth } from '../phase1';

export interface ReplacementReference {
  playerId: number;
  playerName: string;
  price: number;
  xPts6: number;
}

export interface ValueAssessment {
  xPtsPerMillion1: number;
  xPtsPerMillion3: number;
  xPtsPerMillion6: number;
  replacement: ReplacementReference;
  valueAboveReplacement6: number;
  cheaperAlternativeId: number | null;
  cheaperAlternativeName: string | null;
  saving: number;
  pointsSacrificed6: number;
  marginalXptsPerHalfMillion: number | null;
  captainAdjustedValue1: number;
  opportunityCost: string;
}

export interface PricePressure {
  currentPrice: number;
  netTransfers: number;
  pressure: number;
  direction: 'likely_rise' | 'rise_watch' | 'stable' | 'fall_watch' | 'likely_fall';
  confidence: number;
  urgency: 'none' | 'monitor' | 'before_next_price_cycle';
  source: 'official_transfer_activity_proxy';
  caveat: string;
}

export interface NewPlayerAssessment {
  sample: 'unproven' | 'limited' | 'established';
  priorReliance: number;
  confidenceCap: number;
  treatment: string;
}

export interface DecisionPlayer {
  projection: PlayerProjection;
  value: ValueAssessment;
  pricePressure: PricePressure;
  newPlayer: NewPlayerAssessment;
}

export interface ValidationResult {
  pass: boolean;
  errors: string[];
}

export interface CaptainCandidate {
  playerId: number;
  playerName: string;
  relativeScore: number;
  xPts1: number;
  ceiling1: number;
  confidence: number;
  reason: string;
}

export interface LineupDecision {
  starterIds: number[];
  benchIds: number[];
  captainId: number;
  viceCaptainId: number;
  formation: string;
  xPts1BeforeCaptain: number;
  xPts1WithCaptain: number;
  confidence: number;
  captaincy: CaptainCandidate[];
  validation: ValidationResult;
}

export interface TransferMove {
  outPlayerId: number;
  outPlayerName: string;
  inPlayerId: number;
  inPlayerName: string;
  sellPrice: number;
  buyPrice: number;
}

export interface TransferScenario {
  id: string;
  kind: 'roll' | 'one_transfer' | 'two_transfers' | 'hit';
  moves: TransferMove[];
  bankAfter: number;
  hitCost: number;
  grossGain1: number;
  netGain1: number;
  grossGain3: number;
  netGain3: number;
  grossGain6: number;
  netGain6: number;
  decisionScore: number;
  beatRollProbability3: number;
  downsideRisk3: number;
  confidence: number;
  lineup: LineupDecision;
  validation: ValidationResult;
  explanation: string;
}

export interface TransferDecision {
  status: 'ready' | 'provisional_stale_ledger';
  action: 'roll' | 'transfer' | 'wait_for_ledger_confirmation';
  reason: string;
  baseline: TransferScenario;
  bestScenario: TransferScenario;
  alternatives: TransferScenario[];
}

export type ChipKey = 'wildcard' | 'free_hit' | 'bench_boost' | 'triple_captain';
export type ChipAvailability = 'available' | 'used' | 'unknown';

export interface ChipCalendarFlag {
  gameweek: number;
  kind: 'blank' | 'double' | 'blank_and_double';
  blankTeams: string[];
  doubleTeams: string[];
  explanation: string;
}

export interface ChipOpportunity {
  chip: ChipKey;
  gameweek: number;
  projectedGain: number;
  projectedTotal: number;
  quality: number;
  confidence: number;
  players: string[];
  transfersRequired: number | null;
  squad: {
    formation: string;
    bankAfter: number | null;
    captainId: number;
    viceCaptainId: number;
    players: Array<{
      id: number;
      name: string;
      team: string;
      position: Position;
      price: number;
      xPts: number;
      starter: boolean;
    }>;
  } | null;
  explanation: string;
  caveats: string[];
}

export interface ChipAssessment {
  chip: ChipKey;
  availability: ChipAvailability;
  action: 'use_now' | 'hold' | 'used' | 'unknown';
  bestGameweek: number | null;
  currentGameweekGain: number | null;
  confidence: number;
  reason: string;
  opportunities: ChipOpportunity[];
}

export interface ChipPlan {
  currentHalf: 1 | 2;
  expiresAfterGameweek: 19 | 38;
  gameweeksRemaining: number;
  recommendation: {
    action: 'use_chip' | 'no_chip' | 'insufficient_ledger_data';
    chip: ChipKey | null;
    gameweek: number | null;
    confidence: number;
    headline: string;
    reason: string;
  };
  assessments: ChipAssessment[];
  calendarFlags: ChipCalendarFlag[];
  ruleSourceUrl: string;
  modelNotes: string[];
}

export interface PhaseThreeSnapshot {
  schemaVersion: 3;
  modelVersion: 'phase3-decision-v1';
  generatedAt: string;
  currentGameweek: number;
  nextGameweek: number;
  sourceHealth: SourceHealth[];
  phaseTwo: PhaseTwoSnapshot;
  players: DecisionPlayer[];
  ownedLineup: LineupDecision;
  transferDecision: TransferDecision;
  chipPlan: ChipPlan;
  modelNotes: string[];
}

export type ProjectionHorizon = 'xPts1' | 'xPts3' | 'xPts6';
export const POSITION_LIMITS: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
