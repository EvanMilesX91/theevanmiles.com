import type { FetchLike, OfficialBootstrap, SourceHealth } from '../phase1';
import type { ShadowLineupSignal } from './types';

const ENDPOINT = 'https://touchlinewire.com/api/v1/lineups';

interface WirePlayer { id?: number; status?: string }
interface WireClub {
  team_id?: number;
  tactical_confidence_rate?: number;
  last_verified_iso?: string;
  starters?: WirePlayer[];
  bench?: WirePlayer[];
}
interface WirePayload { data?: WireClub[] }

export function parseShadowLineups(payload: WirePayload, bootstrap: OfficialBootstrap, now = new Date()): { signals: ShadowLineupSignal[]; health: SourceHealth } {
  const playerIds = new Set(bootstrap.elements.map((player) => player.id));
  const teams = new Set(bootstrap.teams.map((team) => team.id));
  const signals = (payload.data ?? []).flatMap((club) => {
    if (!Number.isInteger(club.team_id) || !teams.has(club.team_id!)) return [];
    const confidence = Math.round(Math.max(25, Math.min(90, (club.tactical_confidence_rate ?? 0.5) * 100)));
    const verifiedAt = club.last_verified_iso ? new Date(club.last_verified_iso.replace(' UTC', 'Z')).toISOString() : now.toISOString();
    const map = (player: WirePlayer, prediction: ShadowLineupSignal['prediction']): ShadowLineupSignal[] => {
      if (!Number.isInteger(player.id) || !playerIds.has(player.id!)) return [];
      const listedStatus = player.status ?? 'unknown';
      return [{
        playerId: player.id!, teamId: club.team_id!, prediction, confidence, listedStatus,
        contradiction: prediction === 'starter' && ['i', 's', 'u', 'n'].includes(listedStatus),
        verifiedAt, source: 'Touchline Wire', sourceUrl: 'https://touchlinewire.com/docs',
      }];
    };
    return [...(club.starters ?? []).flatMap((player) => map(player, 'starter')), ...(club.bench ?? []).flatMap((player) => map(player, 'bench'))];
  });
  const contradictions = signals.filter((signal) => signal.contradiction).length;
  const clubs = new Set(signals.map((signal) => signal.teamId)).size;
  return {
    signals,
    health: {
      key: 'predicted_lineups_shadow',
      status: clubs === 20 && contradictions === 0 ? 'healthy' : signals.length ? 'degraded' : 'failed',
      retrievedAt: now.toISOString(), records: signals.length,
      message: signals.length
        ? `${clubs}/20 clubs loaded in shadow mode with ${contradictions} injured/suspended starter contradiction${contradictions === 1 ? '' : 's'}. Predictions are scored after each Gameweek and cannot affect decisions until the four-Gameweek promotion gate is passed.`
        : 'No independent predicted-lineup slate was available; the feed remains excluded from decisions.',
    },
  };
}

export async function loadShadowLineups(options: { bootstrap: OfficialBootstrap; fetcher?: FetchLike; now?: Date }): Promise<{ signals: ShadowLineupSignal[]; health: SourceHealth }> {
  const now = options.now ?? new Date();
  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, {
      headers: { Accept: 'application/json', 'User-Agent': 'theevanmiles.com-fpl-engine/1.0' }, cache: 'no-store', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return parseShadowLineups(await response.json() as WirePayload, options.bootstrap, now);
  } catch (error) {
    return { signals: [], health: { key: 'predicted_lineups_shadow', status: 'failed', retrievedAt: now.toISOString(), records: 0, message: `Predicted-lineup shadow feed unavailable (${String(error)}); it remains excluded from decisions.` } };
  }
}
