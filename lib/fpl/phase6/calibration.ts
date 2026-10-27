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
}

export interface CalibrationMetrics {
  players: number;
  projectedPoints: number;
  actualPoints: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  bias: number;
  minutesMeanAbsoluteError: number;
}

export interface CalibrationEvaluation {
  evaluatedAt: string;
  allPlayers: CalibrationMetrics;
  ownedPlayers: CalibrationMetrics;
  selectedXi: CalibrationMetrics;
  selectedXiProjectedWithCaptain: number;
  selectedXiActualWithCaptain: number;
}

export interface ProjectionCalibrationRecord {
  schemaVersion: 1;
  gameweek: number;
  capturedAt: string;
  modelVersion: 'phase6-calibration-v1';
  ledgerStale: boolean;
  players: CalibrationPlayerForecast[];
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

interface OfficialEvent {
  id: number;
  finished: boolean;
}

interface OfficialBootstrapEvents {
  events: OfficialEvent[];
}

interface EventLivePayload {
  elements: Array<{ id: number; stats: { total_points: number; minutes: number } }>;
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function buildMetrics(players: CalibrationPlayerForecast[], actual: Map<number, { points: number; minutes: number }>): CalibrationMetrics {
  if (!players.length) {
    return { players: 0, projectedPoints: 0, actualPoints: 0, meanAbsoluteError: 0, rootMeanSquaredError: 0, bias: 0, minutesMeanAbsoluteError: 0 };
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
  };
}

export function createCalibrationForecast(snapshot: PhaseFiveSnapshot, capturedAt = new Date()): ProjectionCalibrationRecord {
  const starters = new Set(snapshot.lineup.starterIds);
  return {
    schemaVersion: 1,
    gameweek: snapshot.nextGameweek,
    capturedAt: capturedAt.toISOString(),
    modelVersion: 'phase6-calibration-v1',
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
    })),
    evaluation: null,
  };
}

export function evaluateCalibrationRecord(
  record: ProjectionCalibrationRecord,
  live: EventLivePayload,
  evaluatedAt = new Date(),
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

  const pending = [...byGameweek.values()].filter((record) => !record.evaluation && record.gameweek < options.snapshot.nextGameweek);
  const evaluatedGameweeks: number[] = [];
  if (pending.length) {
    const bootstrap = await fetchJson<OfficialBootstrapEvents>('https://fantasy.premierleague.com/api/bootstrap-static/', fetcher);
    const finished = new Set(bootstrap.events.filter((event) => event.finished).map((event) => event.id));
    for (const record of pending) {
      if (!finished.has(record.gameweek)) continue;
      const live = await fetchJson<EventLivePayload>(`https://fantasy.premierleague.com/api/event/${record.gameweek}/live/`, fetcher);
      const evaluated = evaluateCalibrationRecord(record, live, now);
      await options.store.write(evaluated);
      evaluatedGameweeks.push(record.gameweek);
    }
  }

  return { forecastCreated, forecastReplaced, forecastGameweek: options.snapshot.nextGameweek, evaluatedGameweeks, backend: options.store.backend };
}
