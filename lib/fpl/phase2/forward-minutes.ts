import type { FetchLike, SourceHealth } from '../phase1';
import type { ForwardMinutesSignal } from './types';

const ENDPOINT = 'https://fplcat.com/api/v1/projections';

interface FplCatPlayer {
  id?: number;
  xp?: number;
  expected_minutes?: number;
  play_chance?: number;
}

interface FplCatPayload {
  gameweek?: number;
  computed_at?: string;
  players?: FplCatPlayer[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function parseForwardMinutes(payload: FplCatPayload, nextGameweek: number, now = new Date()): { signals: ForwardMinutesSignal[]; health: SourceHealth } {
  const computedAt = typeof payload.computed_at === 'string' ? payload.computed_at : new Date(0).toISOString();
  const ageHours = Math.max(0, (now.getTime() - new Date(computedAt).getTime()) / 3_600_000);
  const correctGameweek = payload.gameweek === nextGameweek;
  const signals = correctGameweek ? (payload.players ?? []).flatMap((player) => {
    if (!Number.isInteger(player.id) || !Number.isFinite(player.expected_minutes) || !Number.isFinite(player.play_chance)) return [];
    return [{
      playerId: player.id!,
      gameweek: nextGameweek,
      expectedMinutes: clamp(player.expected_minutes!, 0, 90),
      playChance: clamp(player.play_chance!, 0, 1),
      projectedPoints: Number.isFinite(player.xp) ? Math.max(0, player.xp!) : 0,
      confidence: ageHours <= 30 ? 78 : ageHours <= 48 ? 62 : 40,
      computedAt,
      source: 'FPL Cat' as const,
      sourceUrl: 'https://fplcat.com/developers',
    }];
  }) : [];
  const status = signals.length >= 500 && ageHours <= 36 ? 'healthy' : signals.length ? 'degraded' : 'failed';
  return {
    signals,
    health: {
      key: 'forward_minutes_fpl_cat',
      status,
      retrievedAt: now.toISOString(),
      records: signals.length,
      message: correctGameweek
        ? `Independent GW${nextGameweek} expected-minutes benchmark computed ${Math.round(ageHours)}h ago; used as a conservative ensemble input, not as a confirmed lineup. Projections: FPL Cat.`
        : `FPL Cat returned GW${payload.gameweek ?? 'unknown'} while the engine expected GW${nextGameweek}; ignored to prevent cross-Gameweek leakage.`,
    },
  };
}

export async function loadForwardMinutes(options: { nextGameweek: number; fetcher?: FetchLike; now?: Date }): Promise<{ signals: ForwardMinutesSignal[]; health: SourceHealth }> {
  const now = options.now ?? new Date();
  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, {
      headers: { Accept: 'application/json', 'User-Agent': 'theevanmiles.com-fpl-engine/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return parseForwardMinutes(await response.json() as FplCatPayload, options.nextGameweek, now);
  } catch (error) {
    return {
      signals: [],
      health: {
        key: 'forward_minutes_fpl_cat', status: 'failed', retrievedAt: now.toISOString(), records: 0,
        message: `Independent expected-minutes benchmark unavailable (${String(error)}); internal minutes model remains active.`,
      },
    };
  }
}
