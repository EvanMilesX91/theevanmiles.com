import type { PhaseThreeSnapshot, TransferScenario } from '../phase3';
import type { SourceHealth } from '../phase1';

export type CouncilLensKey = 'projection' | 'value' | 'historical' | 'new_player' | 'minutes' | 'fixtures' | 'rules_position' | 'captaincy' | 'risk' | 'contrarian';
export type CouncilRecommendation = 'strong_buy' | 'buy' | 'neutral' | 'avoid' | 'strong_avoid';

export interface CouncilOpinion {
  key: CouncilLensKey;
  name: string;
  applicable: boolean;
  score: number;
  confidence: number;
  recommendation: CouncilRecommendation;
  reason: string;
  evidence: string[];
}

export interface PlayerCouncil {
  playerId: number;
  playerName: string;
  score: number;
  confidence: number;
  verdict: CouncilRecommendation;
  disagreement: boolean;
  disagreementSpread: number;
  disagreementSummary: string | null;
  opinions: CouncilOpinion[];
  for: string[];
  against: string[];
}

export interface PlayerComparison {
  selectedPlayerId: number;
  selectedPlayerName: string;
  alternativePlayerId: number;
  alternativePlayerName: string;
  priceDifference: number;
  xPtsDifference1: number;
  xPtsDifference3: number;
  xPtsDifference6: number;
  councilDifference: number;
  decision: string;
  reason: string;
  whatWouldChange: string;
}

export interface NotableOmission {
  playerId: number;
  playerName: string;
  price: number;
  xPts3: number;
  councilScore: number;
  verdict: CouncilRecommendation;
  selectedAlternativeId: number | null;
  selectedAlternativeName: string | null;
  whyExcluded: string;
  whatWouldChange: string;
}

export interface RedTeamObjection {
  severity: 'critical' | 'high' | 'medium' | 'low';
  question: string;
  finding: string;
  evidence: string[];
  mitigation: string;
}

export interface RedTeamReview {
  verdict: 'block' | 'challenge' | 'accept_with_caveats';
  primaryScenarioId: string;
  alternativeScenario: TransferScenario;
  materiallyDifferent: boolean;
  objections: RedTeamObjection[];
  strongestObjection: string;
}

export type EvidenceKind = 'fact' | 'data' | 'model_estimate' | 'interpretation' | 'decision';

export interface EvidenceStatement {
  kind: EvidenceKind;
  statement: string;
}

export interface DecisionProbability {
  beatRoll1: number;
  beatRoll3: number;
  beatRoll6: number;
  downsideRisk3: number;
  method: 'normal_uncertainty_approximation_v1';
}

export interface FinalCommittee {
  status: 'executable' | 'blocked_pending_ledger';
  action: 'roll' | 'transfer' | 'wait_for_ledger_confirmation';
  primaryScenario: TransferScenario;
  alternativeScenario: TransferScenario;
  confidence: number;
  probability: DecisionProbability;
  decisionLine: string;
  rationale: string[];
  evidenceChain: EvidenceStatement[];
}

export interface PhaseFourSnapshot {
  schemaVersion: 4;
  modelVersion: 'phase4-explainability-v1';
  generatedAt: string;
  currentGameweek: number;
  nextGameweek: number;
  sourceHealth: SourceHealth[];
  phaseThree: PhaseThreeSnapshot;
  councils: PlayerCouncil[];
  transferComparisons: PlayerComparison[];
  notableOmissions: NotableOmission[];
  redTeam: RedTeamReview;
  finalCommittee: FinalCommittee;
  councilWeights: Record<CouncilLensKey, number>;
  modelNotes: string[];
}
