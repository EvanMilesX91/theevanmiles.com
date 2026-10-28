import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FetchLike, SquadLedger } from '../phase1';
import { runPhaseFive } from '../phase5';
import { createCalibrationForecast, evaluateCalibrationRecord, type ProjectionCalibrationRecord, type ProjectionCalibrationStore } from './calibration';

interface ArchivedOwnerState {
  owner?: string;
  currentGameweek: number;
  bank: number;
  freeTransfers: number;
  players: Array<{ playerId: number; purchasePrice: number; acquiredGameweek: number }>;
  transfers?: Array<{ gameweek: number; madeAt: string; hitCost: number; outgoing: { playerId: number; sellingPrice: number }; incoming: { playerId: number; purchasePrice: number } }>;
}

interface ArchivedRecommendation {
  generatedAt: string;
  nextGameweek: number;
  primary: { starters?: Array<{ id: number }>; captain?: { id: number } };
  ownerState: ArchivedOwnerState;
}

interface ReplayCandidate { prefix: string; recommendation: ArchivedRecommendation; bootstrap: { events: Array<{ id: number; deadline_time: string }> } }
interface EventLivePayload { elements: Array<{ id: number; stats: { total_points: number; minutes: number } }> }

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

function ledgerFromArchive(recommendation: ArchivedRecommendation): SquadLedger {
  const owner = recommendation.ownerState;
  const starterIds = recommendation.primary.starters?.map((player) => player.id) ?? [];
  const captainId = recommendation.primary.captain?.id ?? null;
  return {
    schemaVersion: 1, managerName: owner.owner ?? 'Dominika Kuzniar', teamName: 'What The Van Vecke',
    lastConfirmedGameweek: Math.max(0, recommendation.nextGameweek - 1), nextGameweek: recommendation.nextGameweek,
    bank: owner.bank, freeTransfers: owner.freeTransfers,
    squad: owner.players.map((player) => ({ elementId: player.playerId, purchasePrice: player.purchasePrice, acquiredGameweek: player.acquiredGameweek })),
    lastConfirmedXi: starterIds, captainId, viceCaptainId: starterIds.find((id) => id !== captainId) ?? null,
    chips: { wildcard: 'unknown', freehit: 'unknown', benchboost: 'unknown', triplecaptain: 'unknown' },
    confirmedTransfers: (owner.transfers ?? []).map((transfer, index) => ({ id: `archive-${transfer.gameweek}-${index}`, gameweek: transfer.gameweek,
      outElementId: transfer.outgoing.playerId, inElementId: transfer.incoming.playerId, sellPrice: transfer.outgoing.sellingPrice,
      buyPrice: transfer.incoming.purchasePrice, hitCost: transfer.hitCost, confirmedAt: transfer.madeAt, confirmationReference: 'archived owner state' })),
    confirmedGameweeks: [], updatedAt: recommendation.generatedAt,
  };
}

async function discoverCandidate(archiveDirectory: string, gameweek: number): Promise<ReplayCandidate | null> {
  const files = (await readdir(archiveDirectory)).filter((file) => /^recommendation-.*\.json$/.test(file));
  const candidates: ReplayCandidate[] = [];
  for (const file of files) {
    const prefix = file.slice('recommendation-'.length, -'.json'.length);
    const rawDirectory = path.join(archiveDirectory, 'raw');
    try {
      const recommendation = await json<ArchivedRecommendation>(path.join(archiveDirectory, file));
      if (recommendation.nextGameweek !== gameweek || !recommendation.ownerState?.players?.length) continue;
      const bootstrap = await json<ReplayCandidate['bootstrap']>(path.join(rawDirectory, `${prefix}-bootstrap.json`));
      const deadline = bootstrap.events.find((event) => event.id === gameweek)?.deadline_time;
      if (deadline && new Date(recommendation.generatedAt).getTime() > new Date(deadline).getTime()) continue;
      candidates.push({ prefix, recommendation, bootstrap });
    } catch { /* An incomplete archive is not a replay candidate. */ }
  }
  return candidates.sort((a, b) => b.recommendation.generatedAt.localeCompare(a.recommendation.generatedAt))[0] ?? null;
}

async function latestResults(archiveDirectory: string, gameweek: number): Promise<{ live: EventLivePayload; fixtures: unknown[] }> {
  const rawDirectory = path.join(archiveDirectory, 'raw');
  const prefixes = (await readdir(rawDirectory)).filter((file) => file.endsWith('-event-live.json')).sort().reverse();
  for (const file of prefixes) {
    const lives = await json<Record<string, EventLivePayload>>(path.join(rawDirectory, file));
    if (lives[String(gameweek)]) {
      const prefix = file.slice(0, -'-event-live.json'.length);
      return { live: lives[String(gameweek)], fixtures: await json<unknown[]>(path.join(rawDirectory, `${prefix}-fixtures.json`)) };
    }
  }
  throw new Error(`No archived official result payload contains GW${gameweek}.`);
}

async function latestLiveArchive(archiveDirectory: string): Promise<Record<string, EventLivePayload>> {
  const rawDirectory = path.join(archiveDirectory, 'raw');
  const files = (await readdir(rawDirectory)).filter((name) => name.endsWith('-event-live.json')).sort().reverse();
  const merged: Record<string, EventLivePayload> = {};
  for (const file of files) {
    const payload = await json<Record<string, EventLivePayload>>(path.join(rawDirectory, file));
    for (const [gameweek, live] of Object.entries(payload)) if (!merged[gameweek]) merged[gameweek] = live;
    if (Object.keys(merged).length >= 8) break;
  }
  return merged;
}

async function archivedLive(archiveDirectory: string, gameweek: string): Promise<EventLivePayload | null> {
  const rawDirectory = path.join(archiveDirectory, 'raw');
  const files = (await readdir(rawDirectory)).filter((name) => name.endsWith('-event-live.json')).sort().reverse();
  for (const file of files) {
    const payload = await json<Record<string, EventLivePayload>>(path.join(rawDirectory, file));
    if (payload[gameweek]) return payload[gameweek];
  }
  return null;
}

export async function replayCurrentModelFromArchive(options: { archiveDirectory: string; gameweek: number; store?: ProjectionCalibrationStore }): Promise<ProjectionCalibrationRecord> {
  const candidate = await discoverCandidate(options.archiveDirectory, options.gameweek);
  if (!candidate) throw new Error(`No complete pre-deadline archive was found for GW${options.gameweek}.`);
  const rawDirectory = path.join(options.archiveDirectory, 'raw');
  const bootstrap = await json<unknown>(path.join(rawDirectory, `${candidate.prefix}-bootstrap.json`));
  const fixtures = await json<unknown[]>(path.join(rawDirectory, `${candidate.prefix}-fixtures.json`));
  const lives = await json<Record<string, EventLivePayload>>(path.join(rawDirectory, `${candidate.prefix}-event-live.json`));
  const fallbackLives = await latestLiveArchive(options.archiveDirectory);
  const lineups = await json<unknown>(path.join(rawDirectory, `${candidate.prefix}-match-lineups.json`));
  const fetcher: FetchLike = async (input) => {
    const url = String(input);
    if (url.includes('bootstrap-static')) return Response.json(bootstrap);
    if (url.endsWith('/fixtures/')) return Response.json(fixtures);
    const event = url.match(/\/event\/(\d+)\/live\//)?.[1];
    if (event) {
      const live = lives[event] ?? fallbackLives[event] ?? await archivedLive(options.archiveDirectory, event);
      if (live) return Response.json(live);
    }
    if (url === 'archive://lineups') return Response.json(lineups);
    return new Response('Unavailable in historical replay', { status: 503 });
  };
  const snapshot = await runPhaseFive({ fetcher, ledger: ledgerFromArchive(candidate.recommendation), lineupUrl: 'archive://lineups', now: new Date(candidate.recommendation.generatedAt), persist: false });
  const frozen = createCalibrationForecast(snapshot, new Date(candidate.recommendation.generatedAt));
  const results = await latestResults(options.archiveDirectory, options.gameweek);
  const record = evaluateCalibrationRecord({ ...frozen, evidenceKind: 'current_model_replay', evidenceWeight: 0.5,
    sourceModelVersion: 'phase2-transparent-v2-replay', limitations: [
      'This is a current-code replay over archived official inputs, not a forecast registered before the real outcome.',
      'Independent forward-minutes and predicted-lineup feeds were not consistently archived and are unavailable in replay.',
      'Replay evidence is diagnostic and cannot activate automatic learning.',
    ] }, results.live, new Date(), new Map(), results.fixtures as Parameters<typeof evaluateCalibrationRecord>[4]);
  if (options.store) await options.store.write(record);
  return record;
}
