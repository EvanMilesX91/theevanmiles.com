import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FetchLike, MonitoredPlayer, OfficialBootstrap, OfficialFixture, SourceHealth } from '../phase1';
import { fetchLiveScoreObservations } from './livescore';
import type { AvailabilityObservation, LineupObservation, RoleAssessment, TacticalRole } from './types';

interface RawLineupPlayer {
  playerId?: number;
  teamId?: number;
  status?: string;
  actualPosition?: string;
  grid?: string | null;
  confidence?: number;
}

interface RawLineup {
  fixtureId?: number;
  gameweek?: number;
  source?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  homeTeamId?: number;
  awayTeamId?: number;
  homeFormation?: string;
  awayFormation?: string;
  players?: RawLineupPlayer[];
}

function validStatus(value: string | undefined): LineupObservation['status'] {
  return value === 'starter' || value === 'substitute' ? value : 'absent';
}

function parseRows(rows: RawLineup[]): LineupObservation[] {
  const output: LineupObservation[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.fixtureId) || !Number.isFinite(row.gameweek)) continue;
    for (const player of row.players ?? []) {
      if (!Number.isFinite(player.playerId) || !Number.isFinite(player.teamId)) continue;
      const home = player.teamId === row.homeTeamId;
      output.push({
        playerId: player.playerId!, gameweek: row.gameweek!, fixtureId: row.fixtureId!, teamId: player.teamId!,
        formation: (home ? row.homeFormation : row.awayFormation) ?? null,
        status: validStatus(player.status), actualPosition: player.actualPosition ?? 'UNKNOWN', grid: player.grid ?? null,
        confidence: Math.max(0, Math.min(100, player.confidence ?? 50)), source: row.source ?? 'lineup feed',
        sourceUrl: row.sourceUrl ?? null, retrievedAt: row.retrievedAt ?? new Date(0).toISOString(),
      });
    }
  }
  return output;
}

async function readLocal(root: string): Promise<{ rows: LineupObservation[]; file: string | null }> {
  const rawDir = path.join(root, 'data', 'fpl', 'raw');
  try {
    const files = (await fs.readdir(rawDir)).filter((file) => file.endsWith('-match-lineups.json')).sort().reverse();
    if (!files.length) return { rows: [], file: null };
    const file = files[0];
    return { rows: parseRows(JSON.parse(await fs.readFile(path.join(rawDir, file), 'utf8')) as RawLineup[]), file };
  } catch {
    return { rows: [], file: null };
  }
}

export async function loadLineupObservations(args: {
  root: string;
  currentGameweek: number;
  bootstrap: OfficialBootstrap;
  fixtures: OfficialFixture[];
  url?: string;
  fetcher?: FetchLike;
  now?: Date;
}): Promise<{ observations: LineupObservation[]; availability: AvailabilityObservation[]; health: SourceHealth }> {
  let observations: LineupObservation[] = [];
  let availability: AvailabilityObservation[] = [];
  let source = 'No lineup evidence configured.';
  let unresolved = 0;
  const url = args.url ?? process.env.FPL_MATCH_LINEUPS_JSON_URL;
  if (url) {
    try {
      const response = await (args.fetcher ?? fetch)(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`${response.status}`);
      observations = parseRows(await response.json() as RawLineup[]);
      source = 'Independent lineup feed loaded.';
    } catch (error) {
      source = `Independent lineup feed failed (${String(error)}); checking stored evidence.`;
    }
  }
  if (!observations.length && !url) {
    try {
      const live = await fetchLiveScoreObservations({
        bootstrap: args.bootstrap,
        fixtures: args.fixtures,
        currentGameweek: args.currentGameweek,
        fetcher: args.fetcher,
        now: args.now,
      });
      observations = live.observations;
      availability = live.availability;
      unresolved = live.unresolved.length;
      source = `LiveScore confirmed lineups loaded for ${live.matches} matches with ${availability.length} latest-matchday availability records; ${unresolved} names were unresolved.`;
    } catch (error) {
      source = `LiveScore refresh failed (${String(error)}); checking stored evidence.`;
    }
  }
  if (!observations.length) {
    const local = await readLocal(args.root);
    observations = local.rows;
    if (local.file) source = `Stored lineup evidence loaded from ${local.file}.`;
  }
  const latestGameweek = observations.reduce((max, row) => Math.max(max, row.gameweek), 0);
  const stale = !observations.length || latestGameweek < args.currentGameweek - 1;
  return {
    observations,
    availability,
    health: {
      key: 'independent_lineups', status: observations.length && !stale && unresolved <= 5 ? 'healthy' : observations.length ? 'degraded' : 'failed',
      retrievedAt: (args.now ?? new Date()).toISOString(), records: observations.length,
      message: `${source} Latest covered Gameweek: ${latestGameweek || 'none'}; official current Gameweek: ${args.currentGameweek}.`,
    },
  };
}

function gridRow(grid: string | null): number | null {
  const value = Number.parseInt(grid?.split(':')[0] ?? '', 10);
  return Number.isFinite(value) ? value : null;
}

function tacticalRole(observation: LineupObservation): TacticalRole {
  const pos = observation.actualPosition.toUpperCase();
  const row = gridRow(observation.grid);
  if (pos === 'GK') return 'goalkeeper';
  if (pos === 'FWD' || (row !== null && row >= 5)) return 'forward';
  if (row !== null && row >= 4) return 'advanced';
  if (pos === 'DEF' || (row !== null && row === 2)) return 'defensive';
  if (pos === 'MID' || row === 3) return 'central';
  return 'unknown';
}

export function assessRole(player: MonitoredPlayer, observations: LineupObservation[], currentGameweek: number): RoleAssessment {
  const relevant = observations.filter((row) => row.playerId === player.id && row.status === 'starter' && row.confidence >= 70 && row.actualPosition !== 'UNKNOWN').sort((a, b) => b.gameweek - a.gameweek).slice(0, 5);
  if (!relevant.length) return { listedPosition: player.position, tacticalRole: 'unknown', change: 'insufficient_data', confidence: 15, observations: 0, latestGameweek: null, evidence: ['No reliable confirmed-start role observation is available.'] };
  const roles = relevant.map(tacticalRole);
  const counts = roles.reduce<Record<string, number>>((map, role) => ({ ...map, [role]: (map[role] ?? 0) + 1 }), {});
  const role = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as TacticalRole;
  const matching = counts[role] ?? 0;
  const expected: Record<string, TacticalRole[]> = { GK: ['goalkeeper'], DEF: ['defensive'], MID: ['central', 'advanced'], FWD: ['forward'] };
  const changed = !expected[player.position].includes(role);
  const fresh = currentGameweek - relevant[0].gameweek <= 2;
  const change = changed ? (matching >= 2 ? 'confirmed' : 'possible') : 'none';
  const confidence = Math.round(Math.min(92, 35 + matching * 16 + (fresh ? 12 : -12)));
  return {
    listedPosition: player.position, tacticalRole: role, change, confidence, observations: relevant.length,
    latestGameweek: relevant[0].gameweek,
    evidence: [`${matching}/${relevant.length} confirmed starts map to ${role}.`, fresh ? 'The latest evidence is recent.' : `Latest role evidence is from GW${relevant[0].gameweek} and is stale.`],
  };
}
