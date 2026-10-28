import type { FetchLike } from '../phase1';
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
  currentPrice?: number;
  priceDirection?: 'likely_rise' | 'rise_watch' | 'stable' | 'fall_watch' | 'likely_fall';
  priceConfidence?: number;
  shadowLineupPrediction?: 'starter' | 'bench' | null;
  shadowLineupConfidence?: number | null;
  shadowLineupContradiction?: boolean;
}

export interface PriceCalibrationMetrics {
  players: number;
  directionalCalls: number;
  correctDirectionalCalls: number;
  directionalAccuracy: number;
  risePrecision: number;
  fallPrecision: number;
  stableAccuracy: number;
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
}

export interface ProjectionCalibrationRecord {
  schemaVersion: 1;
  gameweek: number;
  capturedAt: string;
  modelVersion: 'phase6-calibration-v1';
  evidenceKind?: 'forward' | 'historical_backtest';
  evidenceWeight?: number;
  sourceModelVersion?: string;
  limitations?: string[];
  ledgerStale: boolean;
  players: CalibrationPlayerForecast[];
  priceSnapshots?: PriceCalibrationSnapshot[];
  evaluation: CalibrationEvaluation | null;
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
  aggregate: {
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
  } | null;
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

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function calibrationEvidenceWeight(record: ProjectionCalibrationRecord): number {
  if (record.evidenceKind !== 'historical_backtest') return 1;
  return Math.max(0, Math.min(1, record.evidenceWeight ?? 0.5));
}

export function summarizeCalibration(
  records: ProjectionCalibrationRecord[],
  backend: ProjectionCalibrationStore['backend'],
): CalibrationDashboardSummary {
  const ordered = records.slice().sort((a, b) => a.gameweek - b.gameweek);
  const evaluated = ordered.filter((record) => record.evaluation);
  const forwardEvaluated = evaluated.filter((record) => record.evidenceKind !== 'historical_backtest');
  const historicalEvaluated = evaluated.filter((record) => record.evidenceKind === 'historical_backtest');
  const latest = evaluated.at(-1);
  const totalXiPlayers = evaluated.reduce((sum, record) => sum + (record.evaluation?.selectedXi.players ?? 0) * calibrationEvidenceWeight(record), 0);
  const weighted = (select: (record: ProjectionCalibrationRecord) => number) => totalXiPlayers
    ? round(evaluated.reduce((sum, record) => sum + select(record) * (record.evaluation?.selectedXi.players ?? 0) * calibrationEvidenceWeight(record), 0) / totalXiPlayers)
    : 0;
  const priceRows = evaluated.flatMap((record) => record.evaluation?.prices?.directionalCalls
    ? [{ metric: record.evaluation.prices, weight: calibrationEvidenceWeight(record) }]
    : []);
  // Historical predicted-lineup pages were not archived consistently. Only forward
  // shadow observations are allowed to contribute to the promotion gate.
  const shadowRows = forwardEvaluated.map((record) => record.evaluation?.shadowLineups).filter((metric): metric is ShadowLineupMetrics => Boolean(metric?.predictions));
  const aggregate = evaluated.length ? {
    selectedXiMeanAbsoluteError: weighted((record) => record.evaluation!.selectedXi.meanAbsoluteError),
    selectedXiRootMeanSquaredError: weighted((record) => record.evaluation!.selectedXi.rootMeanSquaredError),
    selectedXiBias: weighted((record) => record.evaluation!.selectedXi.bias),
    minutesMeanAbsoluteError: weighted((record) => record.evaluation!.selectedXi.minutesMeanAbsoluteError),
    minutesBias: weighted((record) => record.evaluation!.selectedXi.minutesBias ?? 0),
    projectedWithCaptain: round(evaluated.reduce((sum, record) => sum + record.evaluation!.selectedXiProjectedWithCaptain * calibrationEvidenceWeight(record), 0)),
    actualWithCaptain: round(evaluated.reduce((sum, record) => sum + record.evaluation!.selectedXiActualWithCaptain * calibrationEvidenceWeight(record), 0)),
    priceDirectionalAccuracy: priceRows.length
      ? round(priceRows.reduce((sum, row) => sum + row.metric.directionalAccuracy * row.metric.directionalCalls * row.weight, 0) / priceRows.reduce((sum, row) => sum + row.metric.directionalCalls * row.weight, 0), 1)
      : null,
    shadowLineupAccuracy: shadowRows.length
      ? round(shadowRows.reduce((sum, row) => sum + row.accuracy * row.predictions, 0) / shadowRows.reduce((sum, row) => sum + row.predictions, 0), 1)
      : null,
    shadowLineupContradictions: shadowRows.reduce((sum, row) => sum + row.contradictions, 0),
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
    aggregate,
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
    players: record.players.flatMap((player) => player.currentPrice === undefined ? [] : [{ playerId: player.playerId, price: player.currentPrice, direction: player.priceDirection, confidence: player.priceConfidence ?? 0 }]),
  }];
  const rows = snapshots.flatMap((snapshot, index) => {
    const next = snapshots[index + 1];
    if (record.evidenceKind === 'historical_backtest' && !next) return [];
    const nextPrices = next ? new Map(next.players.map((player) => [player.playerId, player.price])) : currentPrices;
    return snapshot.players.flatMap((player) => {
      const current = nextPrices.get(player.playerId);
      if (current === undefined || !player.direction) return [];
      const change = Math.round((current - player.price) * 10) / 10;
      return [{ predicted: priceClass(player.direction), actual: change > 0 ? 'rise' as const : change < 0 ? 'fall' as const : 'stable' as const }];
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
    players: snapshot.players.map((player) => ({ playerId: player.id, price: player.price, direction: player.pricePressure?.direction, confidence: player.pricePressure?.confidence ?? 0 })),
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
      currentPrice: player.price,
      priceDirection: player.pricePressure?.direction,
      priceConfidence: player.pricePressure?.confidence,
      shadowLineupPrediction: player.shadowLineupPrediction,
      shadowLineupConfidence: player.shadowLineupConfidence,
      shadowLineupContradiction: player.shadowLineupContradiction,
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
): ProjectionCalibrationRecord {
  const actual = new Map(live.elements.map((element) => [element.id, { points: element.stats.total_points, minutes: element.stats.minutes }]));
  const owned = record.players.filter((player) => player.owned);
  const selectedXi = record.players.filter((player) => player.starter);
  const captain = selectedXi.find((player) => player.captain);
  const captainActual = captain ? actual.get(captain.playerId)?.points ?? 0 : 0;
  const xiMetrics = buildMetrics(selectedXi, actual);
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
    const finished = new Set(bootstrap.events.filter((event) => event.finished).map((event) => event.id));
    for (const record of pending) {
      if (!finished.has(record.gameweek)) continue;
      const live = await fetchJson<EventLivePayload>(`https://fantasy.premierleague.com/api/event/${record.gameweek}/live/`, fetcher);
      const currentPrices = new Map((bootstrap.elements ?? []).map((player) => [player.id, player.now_cost / 10]));
      const evaluated = evaluateCalibrationRecord(record, live, now, currentPrices);
      await options.store.write(evaluated);
      evaluatedGameweeks.push(record.gameweek);
    }
  }

  return { forecastCreated, forecastReplaced, forecastGameweek: options.snapshot.nextGameweek, evaluatedGameweeks, backend: options.store.backend };
}
