import type { FetchLike, Position } from '../phase1';
import type { PhaseFiveSnapshot } from '../phase5';

export interface CalibrationPlayerForecast {
  playerId: number;
  playerName: string;
  owned: boolean;
  starter: boolean;
  captain: boolean;
  projectedPoints: number;
  projectedMinutes: number;
  confidence: number;
  position?: Position;
  team?: string;
  priceBand?: 'budget' | 'mid' | 'premium';
  minutesBand?: 'low' | 'medium' | 'high';
  confidenceBand?: 'low' | 'medium' | 'high';
  sampleClass?: 'unproven' | 'limited' | 'established';
  currentPrice?: number;
  priceDirection?: 'likely_rise' | 'rise_watch' | 'stable' | 'fall_watch' | 'likely_fall';
  priceConfidence?: number;
  pricePressure?: number;
  netTransfers?: number;
  shadowLineupPrediction?: 'starter' | 'bench' | null;
  shadowLineupConfidence?: number | null;
  shadowLineupContradiction?: boolean;
}

export interface CalibrationScenarioForecast {
  id: string;
  kind: 'roll' | 'one_transfer' | 'two_transfers' | 'hit';
  moves: Array<{ outPlayerId: number; outPlayerName: string; inPlayerId: number; inPlayerName: string }>;
  hitCost: number;
  expectedGain1: number;
  expectedGain3: number;
  expectedGain6: number;
  starterIds: number[];
  benchIds: number[];
  captainId: number;
  captainCandidateIds: number[];
}

export interface CalibrationDecisionForecast {
  action: 'roll' | 'transfer' | 'wait_for_ledger_confirmation';
  baseline: CalibrationScenarioForecast;
  primary: CalibrationScenarioForecast;
  alternative: CalibrationScenarioForecast;
}

export interface TeamImpactForecast {
  teamId: number;
  team: string;
  attackBaseline: number;
  defenceBaseline: number;
  attackAdjusted: number;
  defenceAdjusted: number;
  impactedPlayers: number;
}

export interface CalibrationPlayerResult {
  playerId: number;
  playerName: string;
  position?: Position;
  team?: string;
  projectedPoints: number;
  actualPoints: number;
  projectedMinutes: number;
  actualMinutes: number;
  pointError: number;
  minuteError: number;
  priceBand?: CalibrationPlayerForecast['priceBand'];
  minutesBand?: CalibrationPlayerForecast['minutesBand'];
  confidenceBand?: CalibrationPlayerForecast['confidenceBand'];
  sampleClass?: CalibrationPlayerForecast['sampleClass'];
}

export interface DecisionAudit {
  baselineActual: number;
  primaryActual: number;
  alternativeActual: number;
  actualGainVsRoll: number;
  expectedGain1: number;
  hitRepaid: boolean | null;
  captainRegret: number;
  benchRegret: number;
  verdict: 'good_decision_good_outcome' | 'good_decision_bad_outcome' | 'weak_decision_good_outcome' | 'weak_decision_bad_outcome' | 'no_action';
}

export interface TeamImpactEvaluation {
  teams: number;
  attackBaselineMae: number;
  attackAdjustedMae: number;
  defenceBaselineMae: number;
  defenceAdjustedMae: number;
  netValue: number;
}

export interface PriceCalibrationMetrics {
  players: number;
  directionalCalls: number;
  correctDirectionalCalls: number;
  directionalAccuracy: number;
  risePrecision: number;
  fallPrecision: number;
  stableAccuracy: number;
  samples?: Array<{ pressure: number; actual: 'rise' | 'stable' | 'fall' }>;
}

export interface ShadowLineupMetrics {
  predictions: number;
  contradictions: number;
  correctSixtyMinuteProxy: number;
  accuracy: number;
  starterPrecision: number;
  benchPrecision: number;
}

export interface PriceCalibrationSnapshot {
  capturedAt: string;
  players: Array<{
    playerId: number;
    price: number;
    direction: CalibrationPlayerForecast['priceDirection'];
    confidence: number;
    pressure?: number;
    netTransfers?: number;
  }>;
}

export interface CalibrationMetrics {
  players: number;
  projectedPoints: number;
  actualPoints: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  bias: number;
  minutesMeanAbsoluteError: number;
  minutesBias?: number;
}

export interface CalibrationEvaluation {
  evaluatedAt: string;
  allPlayers: CalibrationMetrics;
  ownedPlayers: CalibrationMetrics;
  selectedXi: CalibrationMetrics;
  selectedXiProjectedWithCaptain: number;
  selectedXiActualWithCaptain: number;
  prices?: PriceCalibrationMetrics;
  shadowLineups?: ShadowLineupMetrics;
  playerResults: CalibrationPlayerResult[];
  decision?: DecisionAudit;
  injuryImpact?: TeamImpactEvaluation;
}

export interface ProjectionCalibrationRecord {
  schemaVersion: 1;
  gameweek: number;
  capturedAt: string;
  modelVersion: 'phase6-calibration-v1';
  evidenceKind?: 'forward' | 'historical_backtest' | 'current_model_replay';
  evidenceWeight?: number;
  sourceModelVersion?: string;
  limitations?: string[];
  ledgerStale: boolean;
  players: CalibrationPlayerForecast[];
  decision?: CalibrationDecisionForecast;
  teamImpacts?: TeamImpactForecast[];
  priceSnapshots?: PriceCalibrationSnapshot[];
  evaluation: CalibrationEvaluation | null;
}

export interface CalibrationSegment {
  dimension: 'position' | 'price' | 'minutes' | 'confidence' | 'sample';
  value: string;
  players: number;
  meanAbsoluteError: number;
  bias: number;
  minutesMeanAbsoluteError: number;
}

export interface PriceModelCalibration {
  status: 'collecting' | 'calibrated';
  samples: number;
  directionalEvents: number;
  riseThreshold: number;
  fallThreshold: number;
  precision: number | null;
  coverage: number;
}

export interface ChallengerValidation {
  status: 'collecting' | 'promote' | 'reject';
  forwardGameweeks: number;
  rawMae: number | null;
  correctedMae: number | null;
  rawMinutesMae: number | null;
  correctedMinutesMae: number | null;
}

export interface PostGameweekReport {
  gameweek: number;
  headline: string;
  biggestMisses: CalibrationPlayerResult[];
  decision: DecisionAudit | null;
  diagnosis: string;
  lessons: string[];
}

export interface CalibrationAggregate {
  selectedXiMeanAbsoluteError: number;
  selectedXiRootMeanSquaredError: number;
  selectedXiBias: number;
  minutesMeanAbsoluteError: number;
  minutesBias: number;
  projectedWithCaptain: number;
  actualWithCaptain: number;
  priceDirectionalAccuracy: number | null;
  shadowLineupAccuracy: number | null;
  shadowLineupContradictions: number;
}

export interface ProjectionCalibrationStore {
  backend: 'local' | 'supabase' | 'memory';
  readAll(): Promise<ProjectionCalibrationRecord[]>;
  write(record: ProjectionCalibrationRecord): Promise<void>;
}

export interface CalibrationRefreshResult {
  forecastCreated: boolean;
  forecastReplaced: boolean;
  forecastGameweek: number;
  evaluatedGameweeks: number[];
  backend: ProjectionCalibrationStore['backend'];
}

export interface CalibrationDashboardSummary {
  status: 'collecting' | 'measured';
  backend: ProjectionCalibrationStore['backend'];
  trackedGameweeks: number;
  evaluatedGameweeks: number[];
  forwardEvaluatedGameweeks: number[];
  historicalEvaluatedGameweeks: number[];
  effectiveGameweeks: number;
  historicalWeight: number;
  pendingGameweeks: number[];
  priceSnapshots: number;
  latestEvaluation: {
    gameweek: number;
    evaluatedAt: string;
    selectedXi: CalibrationMetrics;
    projectedWithCaptain: number;
    actualWithCaptain: number;
  } | null;
  segments: CalibrationSegment[];
  priceModel: PriceModelCalibration;
  challenger: ChallengerValidation;
  latestReport: PostGameweekReport | null;
  injuryImpact: TeamImpactEvaluation | null;
  aggregate: CalibrationAggregate | null;
  forwardAggregate: CalibrationAggregate | null;
}

interface OfficialEvent {
  id: number;
  finished: boolean;
}

interface OfficialBootstrapEvents {
  events: OfficialEvent[];
  elements?: Array<{ id: number; now_cost: number }>;
}

interface EventLivePayload {
  elements: Array<{ id: number; stats: { total_points: number; minutes: number } }>;
}

interface OfficialFixtureResult {
  event: number | null;
  finished: boolean;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function calibrationEvidenceWeight(record: ProjectionCalibrationRecord): number {
  if (record.evidenceKind === 'forward' || !record.evidenceKind) return 1;
  return Math.max(0, Math.min(1, record.evidenceWeight ?? 0.5));
}

export function summarizeCalibration(
  records: ProjectionCalibrationRecord[],
  backend: ProjectionCalibrationStore['backend'],
): CalibrationDashboardSummary {
  const ordered = records.slice().sort((a, b) => a.gameweek - b.gameweek);
  const evaluated = ordered.filter((record) => record.evaluation);
  const forwardEvaluated = evaluated.filter((record) => record.evidenceKind === 'forward' || !record.evidenceKind);
  const historicalEvaluated = evaluated.filter((record) => record.evidenceKind !== 'forward' && Boolean(record.evidenceKind));
  const latest = evaluated.at(-1);
  const buildAggregate = (source: ProjectionCalibrationRecord[], shadowSource = source): CalibrationAggregate | null => {
    const totalXiPlayers = source.reduce((sum, record) => sum + record.evaluation!.selectedXi.players * calibrationEvidenceWeight(record), 0);
    if (!source.length || !totalXiPlayers) return null;
    const weighted = (select: (record: ProjectionCalibrationRecord) => number) => round(source.reduce((sum, record) => sum + select(record) * record.evaluation!.selectedXi.players * calibrationEvidenceWeight(record), 0) / totalXiPlayers);
    const priceRows = source.flatMap((record) => record.evaluation!.prices?.directionalCalls ? [{ metric: record.evaluation!.prices!, weight: calibrationEvidenceWeight(record) }] : []);
    const shadowRows = shadowSource.map((record) => record.evaluation!.shadowLineups).filter((metric): metric is ShadowLineupMetrics => Boolean(metric?.predictions));
    return {
      selectedXiMeanAbsoluteError: weighted((record) => record.evaluation!.selectedXi.meanAbsoluteError),
      selectedXiRootMeanSquaredError: weighted((record) => record.evaluation!.selectedXi.rootMeanSquaredError),
      selectedXiBias: weighted((record) => record.evaluation!.selectedXi.bias),
      minutesMeanAbsoluteError: weighted((record) => record.evaluation!.selectedXi.minutesMeanAbsoluteError),
      minutesBias: weighted((record) => record.evaluation!.selectedXi.minutesBias ?? 0),
      projectedWithCaptain: round(source.reduce((sum, record) => sum + record.evaluation!.selectedXiProjectedWithCaptain * calibrationEvidenceWeight(record), 0)),
      actualWithCaptain: round(source.reduce((sum, record) => sum + record.evaluation!.selectedXiActualWithCaptain * calibrationEvidenceWeight(record), 0)),
      priceDirectionalAccuracy: priceRows.length ? round(priceRows.reduce((sum, row) => sum + row.metric.directionalAccuracy * row.metric.directionalCalls * row.weight, 0) / priceRows.reduce((sum, row) => sum + row.metric.directionalCalls * row.weight, 0), 1) : null,
      shadowLineupAccuracy: shadowRows.length ? round(shadowRows.reduce((sum, row) => sum + row.accuracy * row.predictions, 0) / shadowRows.reduce((sum, row) => sum + row.predictions, 0), 1) : null,
      shadowLineupContradictions: shadowRows.reduce((sum, row) => sum + row.contradictions, 0),
    };
  };
  // Predicted-lineup promotion and automatic corrections remain forward-only.
  const aggregate = buildAggregate(evaluated, forwardEvaluated);
  const forwardAggregate = buildAggregate(forwardEvaluated);

  const segmentRows = evaluated.flatMap((record) => (record.evaluation!.playerResults ?? []).map((result) => ({ result, weight: calibrationEvidenceWeight(record) })));
  const segmentDefinitions: Array<{ dimension: CalibrationSegment['dimension']; value: (row: CalibrationPlayerResult) => string | undefined }> = [
    { dimension: 'position', value: (row) => row.position }, { dimension: 'price', value: (row) => row.priceBand },
    { dimension: 'minutes', value: (row) => row.minutesBand }, { dimension: 'confidence', value: (row) => row.confidenceBand },
    { dimension: 'sample', value: (row) => row.sampleClass },
  ];
  const segments = segmentDefinitions.flatMap(({ dimension, value }) => {
    const groups = new Map<string, typeof segmentRows>();
    for (const row of segmentRows) {
      const key = value(row.result);
      if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups].map(([key, rows]): CalibrationSegment => {
      const weight = rows.reduce((sum, row) => sum + row.weight, 0);
      return { dimension, value: key, players: rows.length,
        meanAbsoluteError: round(rows.reduce((sum, row) => sum + Math.abs(row.result.pointError) * row.weight, 0) / weight),
        bias: round(rows.reduce((sum, row) => sum + row.result.pointError * row.weight, 0) / weight),
        minutesMeanAbsoluteError: round(rows.reduce((sum, row) => sum + Math.abs(row.result.minuteError) * row.weight, 0) / weight),
      };
    });
  }).sort((a, b) => b.meanAbsoluteError - a.meanAbsoluteError);

  const priceSamples = forwardEvaluated.flatMap((record) => record.evaluation!.prices?.samples ?? []);
  let chosenThreshold: number | null = null;
  let chosenPrecision: number | null = null;
  let chosenCalls = 0;
  for (let threshold = 50; threshold <= 95; threshold += 5) {
    const calls = priceSamples.filter((sample) => sample.pressure >= threshold || sample.pressure <= -threshold);
    const correct = calls.filter((sample) => sample.pressure >= threshold ? sample.actual === 'rise' : sample.actual === 'fall').length;
    const precision = calls.length ? correct / calls.length * 100 : 0;
    if (calls.length >= 5 && precision >= 65) { chosenThreshold = threshold; chosenPrecision = round(precision, 1); chosenCalls = calls.length; break; }
  }
  const priceModel: PriceModelCalibration = { status: chosenThreshold === null ? 'collecting' : 'calibrated', samples: priceSamples.length,
    directionalEvents: priceSamples.filter((sample) => sample.actual !== 'stable').length, riseThreshold: chosenThreshold ?? 85,
    fallThreshold: -(chosenThreshold ?? 85), precision: chosenPrecision, coverage: priceSamples.length ? round(chosenCalls / priceSamples.length * 100, 1) : 0 };

  const correctedRows = forwardEvaluated.flatMap((record) => {
    const peers = forwardEvaluated.filter((item) => item.gameweek !== record.gameweek);
    if (!peers.length) return [];
    const pointCorrection = peers.reduce((sum, item) => sum + item.evaluation!.selectedXi.bias, 0) / peers.length;
    const minuteCorrection = peers.reduce((sum, item) => sum + (item.evaluation!.selectedXi.minutesBias ?? 0), 0) / peers.length;
    const starters = new Set(record.players.filter((player) => player.starter).map((player) => player.playerId));
    return (record.evaluation!.playerResults ?? []).filter((row) => starters.has(row.playerId)).map((row) => ({ raw: Math.abs(row.pointError), corrected: Math.abs(row.pointError - pointCorrection), rawMinutes: Math.abs(row.minuteError), correctedMinutes: Math.abs(row.minuteError - minuteCorrection) }));
  });
  const mean = (values: number[]) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const rawMae = mean(correctedRows.map((row) => row.raw));
  const correctedMae = mean(correctedRows.map((row) => row.corrected));
  const rawMinutesMae = mean(correctedRows.map((row) => row.rawMinutes));
  const correctedMinutesMae = mean(correctedRows.map((row) => row.correctedMinutes));
  const challengerStatus: ChallengerValidation['status'] = forwardEvaluated.length < 3 || rawMae === null || correctedMae === null ? 'collecting' : correctedMae < rawMae && (correctedMinutesMae ?? Infinity) <= (rawMinutesMae ?? -Infinity) ? 'promote' : 'reject';
  const challenger: ChallengerValidation = { status: challengerStatus, forwardGameweeks: forwardEvaluated.length, rawMae, correctedMae, rawMinutesMae, correctedMinutesMae };

  const injuryRows = evaluated.map((record) => record.evaluation!.injuryImpact).filter((row): row is TeamImpactEvaluation => Boolean(row?.teams));
  const injuryTeams = injuryRows.reduce((sum, row) => sum + row.teams, 0);
  const injuryImpact = injuryTeams ? { teams: injuryTeams,
    attackBaselineMae: round(injuryRows.reduce((sum, row) => sum + row.attackBaselineMae * row.teams, 0) / injuryTeams),
    attackAdjustedMae: round(injuryRows.reduce((sum, row) => sum + row.attackAdjustedMae * row.teams, 0) / injuryTeams),
    defenceBaselineMae: round(injuryRows.reduce((sum, row) => sum + row.defenceBaselineMae * row.teams, 0) / injuryTeams),
    defenceAdjustedMae: round(injuryRows.reduce((sum, row) => sum + row.defenceAdjustedMae * row.teams, 0) / injuryTeams),
    netValue: round(injuryRows.reduce((sum, row) => sum + row.netValue * row.teams, 0) / injuryTeams),
  } : null;
  const latestResults = latest?.evaluation?.playerResults ?? [];
  const biggestMisses = latestResults.slice().sort((a, b) => Math.abs(b.pointError) - Math.abs(a.pointError)).slice(0, 5);
  const minuteMisses = latestResults.filter((row) => Math.abs(row.minuteError) >= 25).length;
  const latestReport: PostGameweekReport | null = latest?.evaluation ? {
    gameweek: latest.gameweek,
    headline: latest.evaluation.decision ? `GW${latest.gameweek}: the recommended route ${latest.evaluation.decision.actualGainVsRoll >= 0 ? 'beat or matched' : 'lost to'} rolling by ${Math.abs(latest.evaluation.decision.actualGainVsRoll)} points.` : `GW${latest.gameweek}: projection error is now measured across ${latest.evaluation.allPlayers.players} players.`,
    biggestMisses, decision: latest.evaluation.decision ?? null,
    diagnosis: `${minuteMisses} major misses came with a 25+ minute error; the remainder are more likely finishing, bonus or clean-sheet variance.`,
    lessons: [segments[0] ? `Worst current segment: ${segments[0].dimension}=${segments[0].value} (${segments[0].meanAbsoluteError} MAE).` : 'More observations are needed for segmented lessons.', challenger.status === 'promote' ? 'The forward-only challenger has earned promotion.' : 'Automatic learning remains locked until the forward-only challenger wins out of sample.'],
  } : null;
  return {
    status: evaluated.length ? 'measured' : 'collecting',
    backend,
    trackedGameweeks: ordered.length,
    evaluatedGameweeks: evaluated.map((record) => record.gameweek),
    forwardEvaluatedGameweeks: forwardEvaluated.map((record) => record.gameweek),
    historicalEvaluatedGameweeks: historicalEvaluated.map((record) => record.gameweek),
    effectiveGameweeks: round(evaluated.reduce((sum, record) => sum + calibrationEvidenceWeight(record), 0), 1),
    historicalWeight: 0.5,
    pendingGameweeks: ordered.filter((record) => !record.evaluation).map((record) => record.gameweek),
    priceSnapshots: ordered.reduce((sum, record) => sum + (record.priceSnapshots?.length ?? 0), 0),
    latestEvaluation: latest?.evaluation ? {
      gameweek: latest.gameweek,
      evaluatedAt: latest.evaluation.evaluatedAt,
      selectedXi: latest.evaluation.selectedXi,
      projectedWithCaptain: latest.evaluation.selectedXiProjectedWithCaptain,
      actualWithCaptain: latest.evaluation.selectedXiActualWithCaptain,
    } : null,
    segments,
    priceModel,
    challenger,
    latestReport,
    injuryImpact,
    aggregate,
    forwardAggregate,
  };
}

export async function loadCalibrationSummary(store: ProjectionCalibrationStore): Promise<CalibrationDashboardSummary> {
  return summarizeCalibration(await store.readAll(), store.backend);
}

function buildMetrics(players: CalibrationPlayerForecast[], actual: Map<number, { points: number; minutes: number }>): CalibrationMetrics {
  if (!players.length) {
    return { players: 0, projectedPoints: 0, actualPoints: 0, meanAbsoluteError: 0, rootMeanSquaredError: 0, bias: 0, minutesMeanAbsoluteError: 0, minutesBias: 0 };
  }
  const rows = players.map((player) => {
    const result = actual.get(player.playerId) ?? { points: 0, minutes: 0 };
    return {
      projected: player.projectedPoints,
      actual: result.points,
      pointError: player.projectedPoints - result.points,
      minuteError: player.projectedMinutes - result.minutes,
    };
  });
  return {
    players: rows.length,
    projectedPoints: round(rows.reduce((sum, row) => sum + row.projected, 0)),
    actualPoints: round(rows.reduce((sum, row) => sum + row.actual, 0)),
    meanAbsoluteError: round(rows.reduce((sum, row) => sum + Math.abs(row.pointError), 0) / rows.length),
    rootMeanSquaredError: round(Math.sqrt(rows.reduce((sum, row) => sum + row.pointError ** 2, 0) / rows.length)),
    bias: round(rows.reduce((sum, row) => sum + row.pointError, 0) / rows.length),
    minutesMeanAbsoluteError: round(rows.reduce((sum, row) => sum + Math.abs(row.minuteError), 0) / rows.length),
    minutesBias: round(rows.reduce((sum, row) => sum + row.minuteError, 0) / rows.length),
  };
}

function priceClass(direction: CalibrationPlayerForecast['priceDirection']): 'rise' | 'stable' | 'fall' {
  if (direction === 'likely_rise' || direction === 'rise_watch') return 'rise';
  if (direction === 'likely_fall' || direction === 'fall_watch') return 'fall';
  return 'stable';
}

function buildPriceMetrics(record: ProjectionCalibrationRecord, currentPrices: Map<number, number>): PriceCalibrationMetrics {
  const snapshots = record.priceSnapshots?.length ? record.priceSnapshots : [{
    capturedAt: record.capturedAt,
    players: record.players.flatMap((player) => player.currentPrice === undefined ? [] : [{ playerId: player.playerId, price: player.currentPrice, direction: player.priceDirection, confidence: player.priceConfidence ?? 0, pressure: player.pricePressure, netTransfers: player.netTransfers }]),
  }];
  const rows = snapshots.flatMap((snapshot, index) => {
    const next = snapshots[index + 1];
    if (record.evidenceKind !== 'forward' && !next) return [];
    const nextPrices = next ? new Map(next.players.map((player) => [player.playerId, player.price])) : currentPrices;
    return snapshot.players.flatMap((player) => {
      const current = nextPrices.get(player.playerId);
      if (current === undefined || !player.direction) return [];
      const change = Math.round((current - player.price) * 10) / 10;
      return [{ predicted: priceClass(player.direction), actual: change > 0 ? 'rise' as const : change < 0 ? 'fall' as const : 'stable' as const, pressure: player.pressure }];
    });
  });
  const directional = rows.filter((row) => row.predicted !== 'stable');
  const rises = rows.filter((row) => row.predicted === 'rise');
  const falls = rows.filter((row) => row.predicted === 'fall');
  const stable = rows.filter((row) => row.predicted === 'stable');
  const ratio = (correct: number, total: number) => total ? round(correct / total * 100, 1) : 0;
  return {
    players: rows.length,
    directionalCalls: directional.length,
    correctDirectionalCalls: directional.filter((row) => row.predicted === row.actual).length,
    directionalAccuracy: ratio(directional.filter((row) => row.predicted === row.actual).length, directional.length),
    risePrecision: ratio(rises.filter((row) => row.actual === 'rise').length, rises.length),
    fallPrecision: ratio(falls.filter((row) => row.actual === 'fall').length, falls.length),
    stableAccuracy: ratio(stable.filter((row) => row.actual === 'stable').length, stable.length),
    samples: rows.flatMap((row) => row.pressure === undefined ? [] : [{ pressure: row.pressure, actual: row.actual }]),
  };
}

function buildShadowLineupMetrics(players: CalibrationPlayerForecast[], actual: Map<number, { points: number; minutes: number }>): ShadowLineupMetrics {
  const rows = players.flatMap((player) => player.shadowLineupPrediction ? [{
    prediction: player.shadowLineupPrediction,
    actualStarterProxy: (actual.get(player.playerId)?.minutes ?? 0) >= 60,
    contradiction: player.shadowLineupContradiction ?? false,
  }] : []);
  const starters = rows.filter((row) => row.prediction === 'starter');
  const bench = rows.filter((row) => row.prediction === 'bench');
  const correct = rows.filter((row) => (row.prediction === 'starter') === row.actualStarterProxy).length;
  const ratio = (value: number, total: number) => total ? round(value / total * 100, 1) : 0;
  return {
    predictions: rows.length,
    contradictions: rows.filter((row) => row.contradiction).length,
    correctSixtyMinuteProxy: correct,
    accuracy: ratio(correct, rows.length),
    starterPrecision: ratio(starters.filter((row) => row.actualStarterProxy).length, starters.length),
    benchPrecision: ratio(bench.filter((row) => !row.actualStarterProxy).length, bench.length),
  };
}

export function createPriceCalibrationSnapshot(snapshot: PhaseFiveSnapshot, capturedAt = new Date()): PriceCalibrationSnapshot {
  return {
    capturedAt: capturedAt.toISOString(),
    players: snapshot.players.map((player) => ({ playerId: player.id, price: player.price, direction: player.pricePressure?.direction, confidence: player.pricePressure?.confidence ?? 0, pressure: player.pricePressure?.pressure, netTransfers: player.pricePressure?.netTransfers })),
  };
}

function scenarioForecast(scenario: PhaseFiveSnapshot['finalCommittee']['primaryScenario']): CalibrationScenarioForecast {
  return {
    id: scenario.id, kind: scenario.kind,
    moves: scenario.moves.map((move) => ({ outPlayerId: move.outPlayerId, outPlayerName: move.outPlayerName, inPlayerId: move.inPlayerId, inPlayerName: move.inPlayerName })),
    hitCost: scenario.hitCost, expectedGain1: scenario.netGain1, expectedGain3: scenario.netGain3, expectedGain6: scenario.netGain6,
    starterIds: scenario.lineup.starterIds, benchIds: scenario.lineup.benchIds, captainId: scenario.lineup.captainId,
    captainCandidateIds: scenario.lineup.captaincy.map((candidate) => candidate.playerId),
  };
}

export function createCalibrationForecast(snapshot: PhaseFiveSnapshot, capturedAt = new Date()): ProjectionCalibrationRecord {
  const starters = new Set(snapshot.lineup.starterIds);
  const priceSnapshot = createPriceCalibrationSnapshot(snapshot, capturedAt);
  return {
    schemaVersion: 1,
    gameweek: snapshot.nextGameweek,
    capturedAt: capturedAt.toISOString(),
    modelVersion: 'phase6-calibration-v1',
    evidenceKind: 'forward',
    evidenceWeight: 1,
    sourceModelVersion: snapshot.viewVersion,
    ledgerStale: snapshot.ledger.stale,
    players: snapshot.players.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      owned: player.owned,
      starter: starters.has(player.id),
      captain: player.id === snapshot.lineup.captainId,
      projectedPoints: player.xPts1,
      projectedMinutes: player.expectedMinutes,
      confidence: player.confidence,
      position: player.position,
      team: player.team,
      priceBand: player.price < 6 ? 'budget' : player.price < 9 ? 'mid' : 'premium',
      minutesBand: player.expectedMinutes < 45 ? 'low' : player.expectedMinutes < 75 ? 'medium' : 'high',
      confidenceBand: player.confidence < 50 ? 'low' : player.confidence < 75 ? 'medium' : 'high',
      sampleClass: player.newPlayer?.sample,
      currentPrice: player.price,
      priceDirection: player.pricePressure?.direction,
      priceConfidence: player.pricePressure?.confidence,
      pricePressure: player.pricePressure?.pressure,
      netTransfers: player.pricePressure?.netTransfers,
      shadowLineupPrediction: player.shadowLineupPrediction,
      shadowLineupConfidence: player.shadowLineupConfidence,
      shadowLineupContradiction: player.shadowLineupContradiction,
    })),
    decision: snapshot.finalCommittee && snapshot.transferDecision ? {
      action: snapshot.finalCommittee.action,
      baseline: scenarioForecast(snapshot.transferDecision.baseline),
      primary: scenarioForecast(snapshot.finalCommittee.primaryScenario),
      alternative: scenarioForecast(snapshot.finalCommittee.alternativeScenario),
    } : undefined,
    teamImpacts: (snapshot.teamRatings ?? []).map((team) => ({
      teamId: team.teamId, team: team.team,
      attackBaseline: round(((team.attackHome + team.attackAway) / 2) / Math.max(0.01, team.attackInjuryMultiplier), 3),
      defenceBaseline: round(((team.defenceHome + team.defenceAway) / 2) / Math.max(0.01, team.defenceInjuryMultiplier), 3),
      attackAdjusted: round((team.attackHome + team.attackAway) / 2, 3), defenceAdjusted: round((team.defenceHome + team.defenceAway) / 2, 3),
      impactedPlayers: (snapshot.injuryImpacts ?? []).filter((impact) => impact.teamId === team.teamId).length,
    })),
    priceSnapshots: [priceSnapshot],
    evaluation: null,
  };
}

export function evaluateCalibrationRecord(
  record: ProjectionCalibrationRecord,
  live: EventLivePayload,
  evaluatedAt = new Date(),
  currentPrices: Map<number, number> = new Map(),
  fixtures: OfficialFixtureResult[] = [],
): ProjectionCalibrationRecord {
  const actual = new Map(live.elements.map((element) => [element.id, { points: element.stats.total_points, minutes: element.stats.minutes }]));
  const owned = record.players.filter((player) => player.owned);
  const selectedXi = record.players.filter((player) => player.starter);
  const captain = selectedXi.find((player) => player.captain);
  const captainActual = captain ? actual.get(captain.playerId)?.points ?? 0 : 0;
  const xiMetrics = buildMetrics(selectedXi, actual);
  const playerResults: CalibrationPlayerResult[] = record.players.map((player) => {
    const result = actual.get(player.playerId) ?? { points: 0, minutes: 0 };
    return { playerId: player.playerId, playerName: player.playerName, position: player.position, team: player.team,
      projectedPoints: player.projectedPoints, actualPoints: result.points, projectedMinutes: player.projectedMinutes, actualMinutes: result.minutes,
      pointError: round(player.projectedPoints - result.points), minuteError: round(player.projectedMinutes - result.minutes),
      priceBand: player.priceBand, minutesBand: player.minutesBand, confidenceBand: player.confidenceBand, sampleClass: player.sampleClass };
  });
  const scenarioPoints = (scenario: CalibrationScenarioForecast) => {
    const lineup = scenario.starterIds.reduce((sum, id) => sum + (actual.get(id)?.points ?? 0), 0);
    return lineup + (actual.get(scenario.captainId)?.points ?? 0) - scenario.hitCost;
  };
  let decision: DecisionAudit | undefined;
  if (record.decision) {
    const baselineActual = scenarioPoints(record.decision.baseline);
    const primaryActual = scenarioPoints(record.decision.primary);
    const alternativeActual = scenarioPoints(record.decision.alternative);
    const selectedCaptain = actual.get(record.decision.primary.captainId)?.points ?? 0;
    const bestCaptain = Math.max(selectedCaptain, ...record.decision.primary.captainCandidateIds.map((id) => actual.get(id)?.points ?? 0));
    const positionById = new Map(record.players.map((player) => [player.playerId, player.position]));
    const benchRegret = record.decision.primary.benchIds.reduce((regret, benchId) => {
      const samePosition = record.decision!.primary.starterIds.filter((id) => positionById.get(id) === positionById.get(benchId));
      const worstStarter = samePosition.length ? Math.min(...samePosition.map((id) => actual.get(id)?.points ?? 0)) : actual.get(benchId)?.points ?? 0;
      return Math.max(regret, (actual.get(benchId)?.points ?? 0) - worstStarter);
    }, 0);
    const actualGainVsRoll = primaryActual - baselineActual;
    const expectedGood = record.decision.primary.expectedGain1 > 0 || record.decision.action === 'roll';
    const outcomeGood = actualGainVsRoll >= 0;
    decision = { baselineActual, primaryActual, alternativeActual, actualGainVsRoll, expectedGain1: record.decision.primary.expectedGain1,
      hitRepaid: record.decision.primary.hitCost ? actualGainVsRoll >= 0 : null, captainRegret: bestCaptain - selectedCaptain, benchRegret,
      verdict: record.decision.action === 'roll' ? 'no_action' : expectedGood && outcomeGood ? 'good_decision_good_outcome' : expectedGood ? 'good_decision_bad_outcome' : outcomeGood ? 'weak_decision_good_outcome' : 'weak_decision_bad_outcome' };
  }
  const teamActual = new Map<number, { gf: number; ga: number }>();
  for (const fixture of fixtures.filter((item) => item.event === record.gameweek && item.finished && item.team_h_score !== null && item.team_a_score !== null)) {
    teamActual.set(fixture.team_h, { gf: fixture.team_h_score!, ga: fixture.team_a_score! });
    teamActual.set(fixture.team_a, { gf: fixture.team_a_score!, ga: fixture.team_h_score! });
  }
  const impactRows = (record.teamImpacts ?? []).flatMap((impact) => {
    const result = teamActual.get(impact.teamId);
    return result ? [{ impact, result }] : [];
  });
  const injuryImpact = impactRows.length ? {
    teams: impactRows.length,
    attackBaselineMae: round(impactRows.reduce((sum, row) => sum + Math.abs(row.impact.attackBaseline - row.result.gf), 0) / impactRows.length),
    attackAdjustedMae: round(impactRows.reduce((sum, row) => sum + Math.abs(row.impact.attackAdjusted - row.result.gf), 0) / impactRows.length),
    defenceBaselineMae: round(impactRows.reduce((sum, row) => sum + Math.abs(row.impact.defenceBaseline - row.result.ga), 0) / impactRows.length),
    defenceAdjustedMae: round(impactRows.reduce((sum, row) => sum + Math.abs(row.impact.defenceAdjusted - row.result.ga), 0) / impactRows.length),
    netValue: 0,
  } : undefined;
  if (injuryImpact) injuryImpact.netValue = round((injuryImpact.attackBaselineMae - injuryImpact.attackAdjustedMae + injuryImpact.defenceBaselineMae - injuryImpact.defenceAdjustedMae) / 2);
  return {
    ...record,
    evaluation: {
      evaluatedAt: evaluatedAt.toISOString(),
      allPlayers: buildMetrics(record.players, actual),
      ownedPlayers: buildMetrics(owned, actual),
      selectedXi: xiMetrics,
      selectedXiProjectedWithCaptain: round(xiMetrics.projectedPoints + (captain?.projectedPoints ?? 0)),
      selectedXiActualWithCaptain: round(xiMetrics.actualPoints + captainActual),
      prices: buildPriceMetrics(record, currentPrices),
      shadowLineups: buildShadowLineupMetrics(record.players, actual),
      playerResults,
      decision,
      injuryImpact,
    },
  };
}

async function fetchJson<T>(url: string, fetcher: FetchLike): Promise<T> {
  const response = await fetcher(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'theevanmiles.com-fpl-calibration/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`FPL calibration request failed (${response.status}) for ${url}.`);
  return response.json() as Promise<T>;
}

export async function refreshProjectionCalibration(options: {
  snapshot: PhaseFiveSnapshot;
  store: ProjectionCalibrationStore;
  fetcher?: FetchLike;
  now?: Date;
}): Promise<CalibrationRefreshResult> {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const existing = await options.store.readAll();
  const byGameweek = new Map(existing.map((record) => [record.gameweek, record]));
  let forecastCreated = false;
  let forecastReplaced = false;

  // Freeze the first stored forecast for a Gameweek so later results cannot leak into it.
  const existingForecast = byGameweek.get(options.snapshot.nextGameweek);
  if (!existingForecast || (existingForecast.ledgerStale && !options.snapshot.ledger.stale)) {
    const forecast = createCalibrationForecast(options.snapshot, now);
    await options.store.write(forecast);
    byGameweek.set(forecast.gameweek, forecast);
    forecastCreated = !existingForecast;
    forecastReplaced = Boolean(existingForecast);
  }

  const currentForecast = byGameweek.get(options.snapshot.nextGameweek);
  if (currentForecast) {
    const snapshots = currentForecast.priceSnapshots ?? [];
    const lastCaptured = snapshots.at(-1)?.capturedAt;
    const ageMs = lastCaptured ? now.getTime() - new Date(lastCaptured).getTime() : Number.POSITIVE_INFINITY;
    if (ageMs >= 2 * 60 * 60 * 1000) {
      const updated = { ...currentForecast, priceSnapshots: [...snapshots, createPriceCalibrationSnapshot(options.snapshot, now)].slice(-30) };
      await options.store.write(updated);
      byGameweek.set(updated.gameweek, updated);
    }
  }

  const pending = [...byGameweek.values()].filter((record) => !record.evaluation && record.gameweek < options.snapshot.nextGameweek);
  const evaluatedGameweeks: number[] = [];
  if (pending.length) {
    const bootstrap = await fetchJson<OfficialBootstrapEvents>('https://fantasy.premierleague.com/api/bootstrap-static/', fetcher);
    const fixtures = await fetchJson<OfficialFixtureResult[]>('https://fantasy.premierleague.com/api/fixtures/', fetcher);
    const finished = new Set(bootstrap.events.filter((event) => event.finished).map((event) => event.id));
    for (const record of pending) {
      if (!finished.has(record.gameweek)) continue;
      const live = await fetchJson<EventLivePayload>(`https://fantasy.premierleague.com/api/event/${record.gameweek}/live/`, fetcher);
      const currentPrices = new Map((bootstrap.elements ?? []).map((player) => [player.id, player.now_cost / 10]));
      const evaluated = evaluateCalibrationRecord(record, live, now, currentPrices, fixtures);
      await options.store.write(evaluated);
      evaluatedGameweeks.push(record.gameweek);
    }
  }

  return { forecastCreated, forecastReplaced, forecastGameweek: options.snapshot.nextGameweek, evaluatedGameweeks, backend: options.store.backend };
}
