import { open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FetchLike } from '../phase1';
import {
  evaluateCalibrationRecord,
  type CalibrationPlayerForecast,
  type PriceCalibrationSnapshot,
  type ProjectionCalibrationRecord,
  type ProjectionCalibrationStore,
} from './calibration';

interface LegacyPricePrediction {
  direction?: string;
  likelihood?: number;
  confidence?: number;
}

interface LegacyGameweekProjection {
  gameweek: number;
  expectedMinutes: number;
  xPts: number;
}

interface LegacyPlayer {
  id: number;
  name: string;
  price: number;
  confidence?: number;
  expectedMinutesNext?: number;
  xPts1?: number;
  fixtures?: Array<{ gameweek: number; kickoffTime?: string }>;
  gameweekProjections?: LegacyGameweekProjection[];
  pricePrediction?: LegacyPricePrediction;
}

interface LegacyRecommendation {
  modelVersion: string;
  generatedAt: string;
  nextGameweek: number;
  primary: {
    players: LegacyPlayer[];
    starters: LegacyPlayer[];
    captain: LegacyPlayer;
  };
}

interface ArchiveCandidate {
  filePath: string;
  generatedAt: string;
  nextGameweek: number;
}

interface EventLivePayload {
  elements: Array<{ id: number; stats: { total_points: number; minutes: number } }>;
}

export interface HistoricalBackfillResult {
  importedGameweeks: number[];
  skippedGameweeks: number[];
  records: ProjectionCalibrationRecord[];
}

const HISTORICAL_WEIGHT = 0.5;

function mapPriceDirection(prediction?: LegacyPricePrediction): CalibrationPlayerForecast['priceDirection'] {
  const direction = prediction?.direction?.toLowerCase();
  const strong = Math.abs(prediction?.likelihood ?? 0) >= 4;
  if (direction === 'rise') return strong ? 'likely_rise' : 'rise_watch';
  if (direction === 'fall') return strong ? 'likely_fall' : 'fall_watch';
  return 'stable';
}

function projectionFor(player: LegacyPlayer, gameweek: number): { points: number; minutes: number } {
  const projection = player.gameweekProjections?.find((item) => item.gameweek === gameweek);
  return {
    points: projection?.xPts ?? player.xPts1 ?? 0,
    minutes: projection?.expectedMinutes ?? player.expectedMinutesNext ?? 0,
  };
}

function firstKickoff(recommendation: LegacyRecommendation): number | null {
  const kickoffs = recommendation.primary.players.flatMap((player) => player.fixtures ?? [])
    .filter((fixture) => fixture.gameweek === recommendation.nextGameweek && fixture.kickoffTime)
    .map((fixture) => new Date(fixture.kickoffTime!).getTime())
    .filter(Number.isFinite);
  return kickoffs.length ? Math.min(...kickoffs) : null;
}

function isPreDeadline(recommendation: LegacyRecommendation): boolean {
  const kickoff = firstKickoff(recommendation);
  if (kickoff === null) return true;
  return new Date(recommendation.generatedAt).getTime() <= kickoff - 90 * 60 * 1000;
}

async function readArchiveHeader(filePath: string): Promise<ArchiveCandidate | null> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead).toString('utf8');
    const generatedAt = head.match(/"generatedAt"\s*:\s*"([^"]+)"/)?.[1];
    const nextGameweek = Number(head.match(/"nextGameweek"\s*:\s*(\d+)/)?.[1]);
    if (!generatedAt || !Number.isInteger(nextGameweek)) return null;
    return { filePath, generatedAt, nextGameweek };
  } finally {
    await handle.close();
  }
}

async function discoverArchives(directory: string): Promise<ArchiveCandidate[]> {
  const files = (await readdir(directory)).filter((file) => /^recommendation-.*\.json$/.test(file));
  const candidates = await Promise.all(files.map((file) => readArchiveHeader(path.join(directory, file))));
  return candidates.filter((candidate): candidate is ArchiveCandidate => Boolean(candidate));
}

async function readRecommendation(candidate: ArchiveCandidate): Promise<LegacyRecommendation> {
  const parsed = JSON.parse(await readFile(candidate.filePath, 'utf8')) as LegacyRecommendation;
  if (!parsed.primary?.players?.length || !parsed.primary?.starters?.length || !parsed.primary?.captain) {
    throw new Error(`Legacy FPL archive is missing its squad decision: ${candidate.filePath}`);
  }
  return parsed;
}

async function latestCleanRecommendation(candidates: ArchiveCandidate[]): Promise<LegacyRecommendation | null> {
  for (const candidate of candidates.slice().sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))) {
    const recommendation = await readRecommendation(candidate);
    if (isPreDeadline(recommendation)) return recommendation;
  }
  return null;
}

async function earliestCleanRecommendation(candidates: ArchiveCandidate[]): Promise<LegacyRecommendation | null> {
  for (const candidate of candidates.slice().sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))) {
    const recommendation = await readRecommendation(candidate);
    if (isPreDeadline(recommendation)) return recommendation;
  }
  return null;
}

function priceSnapshot(recommendation: LegacyRecommendation): PriceCalibrationSnapshot {
  return {
    capturedAt: recommendation.generatedAt,
    players: recommendation.primary.players.map((player) => ({
      playerId: player.id,
      price: player.price,
      direction: mapPriceDirection(player.pricePrediction),
      confidence: player.pricePrediction?.confidence ?? 0,
    })),
  };
}

export function createHistoricalCalibrationRecord(
  recommendation: LegacyRecommendation,
  nextRecommendation?: LegacyRecommendation | null,
): ProjectionCalibrationRecord {
  const gameweek = recommendation.nextGameweek;
  const starterIds = new Set(recommendation.primary.starters.map((player) => player.id));
  const players = recommendation.primary.players.map((player) => {
    const projection = projectionFor(player, gameweek);
    return {
      playerId: player.id,
      playerName: player.name,
      owned: true,
      starter: starterIds.has(player.id),
      captain: player.id === recommendation.primary.captain.id,
      projectedPoints: projection.points,
      projectedMinutes: projection.minutes,
      confidence: player.confidence ?? 50,
      currentPrice: player.price,
      priceDirection: mapPriceDirection(player.pricePrediction),
      priceConfidence: player.pricePrediction?.confidence ?? 0,
      shadowLineupPrediction: null,
      shadowLineupConfidence: null,
      shadowLineupContradiction: false,
    } satisfies CalibrationPlayerForecast;
  });
  const followup = nextRecommendation ? priceSnapshot(nextRecommendation) : null;
  const matchingIds = new Set(players.map((player) => player.playerId));
  const matchedFollowup = followup ? {
    ...followup,
    players: followup.players.filter((player) => matchingIds.has(player.playerId)),
  } : null;
  return {
    schemaVersion: 1,
    gameweek,
    capturedAt: recommendation.generatedAt,
    modelVersion: 'phase6-calibration-v1',
    evidenceKind: 'historical_backtest',
    evidenceWeight: HISTORICAL_WEIGHT,
    sourceModelVersion: recommendation.modelVersion,
    limitations: [
      'Historical evidence is weighted at 50% because it came from an earlier model revision.',
      'The archived squad is the engine-selected squad, not a confirmed owner ledger.',
      'Historical predicted-lineup signals are excluded from the forward-only promotion gate.',
    ],
    ledgerStale: false,
    players,
    priceSnapshots: [priceSnapshot(recommendation), ...(matchedFollowup?.players.length ? [matchedFollowup] : [])],
    evaluation: null,
  };
}

export async function loadHistoricalCalibrationRecords(
  archiveDirectory: string,
  gameweeks = [2, 3, 4, 5],
): Promise<ProjectionCalibrationRecord[]> {
  const archives = await discoverArchives(archiveDirectory);
  const recommendations = new Map<number, LegacyRecommendation>();
  const followups = new Map<number, LegacyRecommendation>();
  for (const gameweek of gameweeks) {
    const selected = await latestCleanRecommendation(archives.filter((candidate) => candidate.nextGameweek === gameweek));
    if (selected) recommendations.set(gameweek, selected);
    const followup = await earliestCleanRecommendation(archives.filter((candidate) => candidate.nextGameweek === gameweek + 1));
    if (followup) followups.set(gameweek, followup);
  }
  return gameweeks.flatMap((gameweek) => {
    const recommendation = recommendations.get(gameweek);
    if (!recommendation) return [];
    return [createHistoricalCalibrationRecord(recommendation, followups.get(gameweek))];
  });
}

async function fetchLive(gameweek: number, fetcher: FetchLike): Promise<EventLivePayload> {
  const response = await fetcher(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`, {
    headers: { Accept: 'application/json', 'User-Agent': 'theevanmiles.com-fpl-historical-calibration/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Historical FPL calibration request failed (${response.status}) for GW${gameweek}.`);
  return response.json() as Promise<EventLivePayload>;
}

export async function backfillHistoricalCalibration(options: {
  archiveDirectory: string;
  store: ProjectionCalibrationStore;
  fetcher?: FetchLike;
  gameweeks?: number[];
  now?: Date;
}): Promise<HistoricalBackfillResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const records = await loadHistoricalCalibrationRecords(options.archiveDirectory, options.gameweeks);
  const existing = new Map((await options.store.readAll()).map((record) => [record.gameweek, record]));
  const importedGameweeks: number[] = [];
  const skippedGameweeks: number[] = [];
  const evaluatedRecords: ProjectionCalibrationRecord[] = [];
  for (const record of records) {
    const stored = existing.get(record.gameweek);
    if (stored && stored.evidenceKind !== 'historical_backtest') {
      skippedGameweeks.push(record.gameweek);
      continue;
    }
    const evaluated = evaluateCalibrationRecord(record, await fetchLive(record.gameweek, fetcher), now);
    await options.store.write(evaluated);
    importedGameweeks.push(record.gameweek);
    evaluatedRecords.push(evaluated);
  }
  return { importedGameweeks, skippedGameweeks, records: evaluatedRecords };
}
