import type { FetchLike, SquadLedger } from '../phase1';
import type { ChipPlan } from './types';

type Verification = ChipPlan['entryVerification'];

const BASE = 'https://fantasy.premierleague.com/api';

function empty(status: Verification['status'], message: string, entryId: number | null = null): Verification {
  return { status, entryId, verifiedGameweek: null, squadMatches: null, chipsUsed: [], mismatches: [], message, sourceUrl: entryId ? `${BASE}/entry/${entryId}/history/` : null };
}

export async function verifyPublicEntry(args: {
  ledger: SquadLedger;
  fetcher?: FetchLike;
  entryId?: number | null;
}): Promise<Verification> {
  const configured = args.entryId ?? (Number(process.env.FPL_ENTRY_ID || 0) || null);
  if (!configured) return empty('not_configured', 'Set FPL_ENTRY_ID to enable a read-only cross-check against the public FPL entry. The local ledger remains authoritative.');
  const fetcher = args.fetcher ?? fetch;
  const gameweek = args.ledger.lastConfirmedGameweek;
  if (gameweek < 1) return empty('unavailable', 'There is no confirmed Gameweek to verify yet.', configured);
  try {
    const [historyResponse, picksResponse] = await Promise.all([
      fetcher(`${BASE}/entry/${configured}/history/`, { signal: AbortSignal.timeout(8_000) }),
      fetcher(`${BASE}/entry/${configured}/event/${gameweek}/picks/`, { signal: AbortSignal.timeout(8_000) }),
    ]);
    if (!historyResponse.ok || !picksResponse.ok) throw new Error(`FPL API returned ${historyResponse.status}/${picksResponse.status}`);
    const history = await historyResponse.json() as { chips?: Array<{ name?: string; event?: number }> };
    const picks = await picksResponse.json() as { picks?: Array<{ element?: number }> };
    const remoteIds = (picks.picks ?? []).map((pick) => pick.element).filter((id): id is number => Number.isInteger(id)).sort((a, b) => a - b);
    const localIds = args.ledger.squad.map((player) => player.elementId).sort((a, b) => a - b);
    const mismatches: string[] = [];
    const squadMatches = remoteIds.length === 15 && remoteIds.join(',') === localIds.join(',');
    if (!squadMatches) mismatches.push(`The GW${gameweek} public squad does not match the 15 players in the local ledger.`);
    const chipsUsed = (history.chips ?? []).map((chip) => `${chip.name ?? 'unknown'}${chip.event ? ` (GW${chip.event})` : ''}`);
    return {
      status: mismatches.length ? 'mismatch' : 'matched', entryId: configured, verifiedGameweek: gameweek, squadMatches, chipsUsed, mismatches,
      message: mismatches.length ? 'Public-entry cross-check found a mismatch. No local data was changed.' : `Public entry and local squad match for GW${gameweek}.`,
      sourceUrl: `${BASE}/entry/${configured}/event/${gameweek}/picks/`,
    };
  } catch (error) {
    return empty('unavailable', `Public-entry cross-check was unavailable: ${error instanceof Error ? error.message : 'unknown error'}. No local data was changed.`, configured);
  }
}
