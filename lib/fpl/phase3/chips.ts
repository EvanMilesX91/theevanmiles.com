import type { MonitoredPlayer, OfficialFixture, OfficialTeam, Position, SquadLedger } from '../phase1';
import { optimizeLineup, validateSquad } from './optimizer';
import { simulateNormalTransferPath, type TransferPath } from './chip-simulation';
import type {
  ChipAssessment,
  ChipAvailability,
  ChipCalendarFlag,
  ChipKey,
  ChipOpportunity,
  ChipPlan,
  DecisionPlayer,
} from './types';

const CHIP_RULES_URL = 'https://www.premierleague.com/en/news/4679879/whats-happening-with-fpl-chips-in-202627';
const CHIP_KEYS: ChipKey[] = ['wildcard', 'free_hit', 'bench_boost', 'triple_captain'];
const POSITION_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_COUNTS: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const QUALITY_GATE: Record<ChipKey, number> = { wildcard: 70, free_hit: 75, bench_boost: 70, triple_captain: 72 };

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function riskRange(gain: number, confidence: number, distance: number, chip: ChipKey) {
  const base = { wildcard: 8, free_hit: 5, bench_boost: 4.5, triple_captain: 4 }[chip];
  const sigma = base * (1.35 - confidence / 200) + distance * 0.45;
  const downsideProbability = Math.round(100 / (1 + Math.exp((gain / Math.max(1, sigma)) * 1.7)));
  return { outcomeRange: { p10: round(gain - sigma * 1.282), p50: round(gain), p90: round(gain + sigma * 1.282) }, downsideProbability };
}

function mulberry32(seed: number) { return () => { let value = seed += 0x6D2B79F5; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }
function normal(random: () => number) { return Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random()); }
function useNowProbability(current: ChipOpportunity | undefined, future: ChipOpportunity | undefined): { probability: number | null; regret: number | null } {
  if (!current) return { probability: null, regret: null };
  if (!future || future.gameweek === current.gameweek) return { probability: 100 - current.downsideProbability, regret: 0 };
  const random = mulberry32(current.gameweek * 1009 + future.gameweek * 917 + CHIP_KEYS.indexOf(current.chip) * 7919);
  const currentSigma = Math.max(1, (current.outcomeRange.p90 - current.outcomeRange.p10) / 2.564);
  const futureSigma = Math.max(1, (future.outcomeRange.p90 - future.outcomeRange.p10) / 2.564);
  let wins = 0; let regret = 0;
  for (let sample = 0; sample < 2_000; sample += 1) {
    const now = current.projectedGain + normal(random) * currentSigma;
    const later = future.projectedGain + normal(random) * futureSigma;
    if (now >= later) wins += 1; else regret += later - now;
  }
  return { probability: Math.round(wins / 20), regret: round(regret / 2_000) };
}

function fixtureValue(player: DecisionPlayer, gameweek: number, key: 'xPts' | 'floor' | 'ceiling' = 'xPts'): number {
  return player.projection.fixtures.filter((fixture) => fixture.gameweek === gameweek).reduce((sum, fixture) => sum + fixture[key], 0);
}

function windowValue(player: DecisionPlayer, start: number, end: number): number {
  return player.projection.fixtures.filter((fixture) => fixture.gameweek >= start && fixture.gameweek <= end).reduce((sum, fixture) => sum + fixture.xPts, 0);
}

function playersForGameweek(squad: DecisionPlayer[], gameweek: number): DecisionPlayer[] {
  return squad.map((player) => ({
    ...player,
    projection: {
      ...player.projection,
      xPts1: round(fixtureValue(player, gameweek)),
      floor1: round(fixtureValue(player, gameweek, 'floor')),
      ceiling1: round(fixtureValue(player, gameweek, 'ceiling')),
    },
  }));
}

function lineupForGameweek(squad: DecisionPlayer[], gameweek: number) {
  return optimizeLineup(playersForGameweek(squad, gameweek));
}

function scoreWindow(squad: DecisionPlayer[], start: number, end: number): number {
  let total = 0;
  for (let gameweek = start; gameweek <= end; gameweek += 1) total += lineupForGameweek(squad, gameweek).xPts1WithCaptain;
  return round(total);
}

function normalizeChipStatus(ledger: SquadLedger, chip: ChipKey): ChipAvailability {
  const aliases: Record<ChipKey, string[]> = {
    wildcard: ['wildcard'],
    free_hit: ['free_hit', 'freehit'],
    bench_boost: ['bench_boost', 'benchboost'],
    triple_captain: ['triple_captain', 'triplecaptain'],
  };
  for (const key of aliases[chip]) {
    const value = ledger.chips[key];
    if (value === 'available' || value === 'used' || value === 'unknown') return value;
  }
  return 'unknown';
}

function squadBudget(ledger: SquadLedger, monitored: MonitoredPlayer[]): number {
  const byId = new Map(monitored.map((player) => [player.id, player]));
  return round(ledger.bank + ledger.squad.reduce((sum, entry) => sum + (byId.get(entry.elementId)?.sellingPrice ?? entry.purchasePrice), 0), 1);
}

interface BeamState {
  players: DecisionPlayer[];
  cost: number;
  raw: number;
  teams: Map<number, number>;
  lastIndex: number;
}

function shortlist(players: DecisionPlayer[], position: Position, start: number, end: number): DecisionPlayer[] {
  const eligible = players.filter((player) => player.projection.position === position
    && player.projection.minutes.appearanceProbability >= 0.35
    && player.projection.price > 0
    && windowValue(player, start, end) > 0);
  const byProjection = [...eligible].sort((a, b) => windowValue(b, start, end) - windowValue(a, start, end)).slice(0, 18);
  const byValue = [...eligible].sort((a, b) => (windowValue(b, start, end) / b.projection.price) - (windowValue(a, start, end) / a.projection.price)).slice(0, 7);
  const byPrice = [...eligible].sort((a, b) => a.projection.price - b.projection.price || windowValue(b, start, end) - windowValue(a, start, end)).slice(0, 6);
  return [...new Map([...byProjection, ...byValue, ...byPrice].map((player) => [player.projection.playerId, player])).values()];
}

function optimizeChipSquad(players: DecisionPlayer[], budget: number, start: number, end: number): DecisionPlayer[] | null {
  let states: BeamState[] = [{ players: [], cost: 0, raw: 0, teams: new Map(), lastIndex: -1 }];
  for (const position of POSITION_ORDER) {
    const pool = shortlist(players, position, start, end);
    states = states.map((state) => ({ ...state, lastIndex: -1 }));
    for (let slot = 0; slot < POSITION_COUNTS[position]; slot += 1) {
      const next: BeamState[] = [];
      const remaining = POSITION_COUNTS[position] - slot - 1;
      for (const state of states) for (let candidateIndex = state.lastIndex + 1; candidateIndex <= pool.length - remaining - 1; candidateIndex += 1) {
        const player = pool[candidateIndex];
        const teamCount = state.teams.get(player.projection.teamId) ?? 0;
        if (teamCount >= 3) continue;
        const cost = state.cost + player.projection.price;
        if (cost > budget + 0.001) continue;
        const teams = new Map(state.teams);
        teams.set(player.projection.teamId, teamCount + 1);
        const points = windowValue(player, start, end);
        const confidenceWeight = 0.72 + player.projection.confidence / 360;
        next.push({ players: [...state.players, player], cost, raw: state.raw + points * confidenceWeight, teams, lastIndex: candidateIndex });
      }
      const ranked = next.sort((a, b) => (b.raw - b.cost * 0.02) - (a.raw - a.cost * 0.02)).slice(0, 220);
      const cheap = [...next].sort((a, b) => a.cost - b.cost || b.raw - a.raw).slice(0, 30);
      states = [...new Map([...ranked, ...cheap].map((state) => [state.players.map((player) => player.projection.playerId).join('-'), state])).values()];
      if (!states.length) return null;
    }
  }
  return states.filter((state) => validateSquad(state.players).pass)
    .map((state) => ({ state, score: scoreWindow(state.players, start, end) }))
    .sort((a, b) => b.score - a.score)[0]?.state.players ?? null;
}

function calendarFlags(fixtures: OfficialFixture[], teams: OfficialTeam[], start: number, end: number): ChipCalendarFlag[] {
  const teamNames = new Map(teams.map((team) => [team.id, team.short_name]));
  const teamIds = teams.map((team) => team.id);
  const flags: ChipCalendarFlag[] = [];
  for (let gameweek = start; gameweek <= end; gameweek += 1) {
    const counts = new Map(teamIds.map((teamId) => [teamId, 0]));
    for (const fixture of fixtures.filter((item) => item.event === gameweek)) {
      counts.set(fixture.team_h, (counts.get(fixture.team_h) ?? 0) + 1);
      counts.set(fixture.team_a, (counts.get(fixture.team_a) ?? 0) + 1);
    }
    const blankTeams = teamIds.filter((teamId) => (counts.get(teamId) ?? 0) === 0).map((teamId) => teamNames.get(teamId) ?? String(teamId));
    const doubleTeams = teamIds.filter((teamId) => (counts.get(teamId) ?? 0) > 1).map((teamId) => teamNames.get(teamId) ?? String(teamId));
    if (!blankTeams.length && !doubleTeams.length) continue;
    const kind = blankTeams.length && doubleTeams.length ? 'blank_and_double' : blankTeams.length ? 'blank' : 'double';
    flags.push({ gameweek, kind, blankTeams, doubleTeams, explanation: `GW${gameweek}: ${blankTeams.length} blank team${blankTeams.length === 1 ? '' : 's'} and ${doubleTeams.length} double team${doubleTeams.length === 1 ? '' : 's'} in the current official schedule.` });
  }
  return flags;
}

function confidenceFor(players: DecisionPlayer[], gameweek: number, nextGameweek: number): number {
  if (!players.length) return 0;
  const base = players.reduce((sum, player) => sum + player.projection.confidence, 0) / players.length;
  return Math.round(clamp(base - Math.max(0, gameweek - nextGameweek) * 2.5, 25, 90));
}

function squadSelection(squad: DecisionPlayer[], gameweek: number, budget?: number): ChipOpportunity['squad'] {
  if (squad.length !== 15) return null;
  const lineup = lineupForGameweek(squad, gameweek);
  const starters = new Set(lineup.starterIds);
  return {
    formation: lineup.formation,
    bankAfter: budget == null ? null : round(Math.max(0, budget - squad.reduce((sum, player) => sum + player.projection.price, 0)), 1),
    captainId: lineup.captainId,
    viceCaptainId: lineup.viceCaptainId,
    players: squad.map((player) => ({
      id: player.projection.playerId,
      name: player.projection.playerName,
      team: player.projection.team,
      position: player.projection.position,
      price: player.projection.price,
      xPts: round(fixtureValue(player, gameweek)),
      starter: starters.has(player.projection.playerId),
    })).sort((a, b) => Number(b.starter) - Number(a.starter) || b.xPts - a.xPts),
  };
}

function tripleCaptainOpportunity(squad: DecisionPlayer[], gameweek: number, nextGameweek: number): ChipOpportunity {
  const lineup = lineupForGameweek(squad, gameweek);
  const captain = squad.find((player) => player.projection.playerId === lineup.captainId);
  const gain = captain ? fixtureValue(captain, gameweek) : 0;
  const ceiling = captain ? fixtureValue(captain, gameweek, 'ceiling') : 0;
  const confidence = confidenceFor(captain ? [captain] : [], gameweek, nextGameweek);
  return {
    chip: 'triple_captain', gameweek, projectedGain: round(gain), projectedTotal: round(lineup.xPts1WithCaptain + gain),
    quality: Math.round(clamp(gain / 12 * 82 + ceiling / 16 * 18, 0, 100)), confidence,
    ...riskRange(gain, confidence, gameweek - nextGameweek, 'triple_captain'),
    players: captain ? [captain.projection.playerName] : [], transfersRequired: null, squad: squadSelection(squad, gameweek),
    explanation: captain ? `${captain.projection.playerName} projects ${round(gain)} points before captain multipliers; Triple Captain adds one extra copy of that score.` : 'No legal captain candidate is available.',
    caveats: ['The gain is the extra captain score above normal double captaincy.', 'Late availability and predicted-lineup news can materially change a one-player chip.'],
  };
}

function benchBoostOpportunity(squad: DecisionPlayer[], gameweek: number, nextGameweek: number): ChipOpportunity {
  const lineup = lineupForGameweek(squad, gameweek);
  const bench = lineup.benchIds.map((id) => squad.find((player) => player.projection.playerId === id)).filter((player): player is DecisionPlayer => Boolean(player));
  const gain = bench.reduce((sum, player) => sum + fixtureValue(player, gameweek), 0);
  const appearance = bench.length ? bench.reduce((sum, player) => sum + player.projection.minutes.appearanceProbability, 0) / bench.length : 0;
  const confidence = confidenceFor(bench, gameweek, nextGameweek);
  return {
    chip: 'bench_boost', gameweek, projectedGain: round(gain), projectedTotal: round(lineup.xPts1WithCaptain + gain),
    quality: Math.round(clamp(gain / 16 * 85 + appearance * 15, 0, 100)), confidence,
    ...riskRange(gain, confidence, gameweek - nextGameweek, 'bench_boost'),
    players: bench.map((player) => player.projection.playerName), transfersRequired: null, squad: squadSelection(squad, gameweek),
    explanation: `The optimized bench projects ${round(gain)} points from ${bench.length} players, with ${Math.round(appearance * 100)}% average appearance probability.`,
    caveats: ['This uses the currently owned squad; future transfers or a preceding Wildcard can improve the bench.', 'Bench order is irrelevant when Bench Boost is active.'],
  };
}

function freeHitOpportunity(args: { players: DecisionPlayer[]; squad: DecisionPlayer[]; budget: number; gameweek: number; nextGameweek: number; flag?: ChipCalendarFlag }): ChipOpportunity {
  const baseline = lineupForGameweek(args.squad, args.gameweek);
  const optimized = optimizeChipSquad(args.players, args.budget, args.gameweek, args.gameweek);
  const optimizedLineup = optimized ? lineupForGameweek(optimized, args.gameweek) : baseline;
  const gain = optimizedLineup.xPts1WithCaptain - baseline.xPts1WithCaptain;
  const starters = optimized ? optimizedLineup.starterIds.map((id) => optimized.find((player) => player.projection.playerId === id)).filter((player): player is DecisionPlayer => Boolean(player)) : [];
  const calendarBonus = args.flag ? Math.min(15, args.flag.blankTeams.length * 2 + args.flag.doubleTeams.length * 3) : 0;
  const confidence = confidenceFor(starters, args.gameweek, args.nextGameweek);
  return {
    chip: 'free_hit', gameweek: args.gameweek, projectedGain: round(gain), projectedTotal: round(optimizedLineup.xPts1WithCaptain),
    quality: Math.round(clamp(gain / 15 * 85 + calendarBonus, 0, 100)), confidence,
    ...riskRange(gain, confidence, args.gameweek - args.nextGameweek, 'free_hit'),
    players: starters.sort((a, b) => fixtureValue(b, args.gameweek) - fixtureValue(a, args.gameweek)).slice(0, 5).map((player) => player.projection.playerName),
    transfersRequired: optimized ? optimized.filter((player) => !args.squad.some((owned) => owned.projection.playerId === player.projection.playerId)).length : null,
    squad: squadSelection(optimized ?? args.squad, args.gameweek, args.budget),
    explanation: `A one-week optimized squad projects ${round(optimizedLineup.xPts1WithCaptain)} points versus ${round(baseline.xPts1WithCaptain)} for the current squad${args.flag ? `; ${args.flag.explanation}` : '.'}`,
    caveats: ['Future prices are held at current values.', 'The squad reverts at the following deadline, so no multiweek value is credited.'],
  };
}

function wildcardOpportunity(args: { players: DecisionPlayer[]; squad: DecisionPlayer[]; budget: number; gameweek: number; end: number; nextGameweek: number; monitored: MonitoredPlayer[]; ledger: SquadLedger }): ChipOpportunity {
  const horizonEnd = Math.min(args.end, args.gameweek + 5);
  const initial: TransferPath = { squad: args.squad, bank: args.ledger.bank, freeTransfers: args.ledger.freeTransfers, projectedPoints: 0, hitCost: 0, weeks: [] };
  const prefix = simulateNormalTransferPath({ players: args.players, initial, monitored: args.monitored, ledger: args.ledger, start: args.nextGameweek, end: args.gameweek - 1 });
  const baselineRoute = simulateNormalTransferPath({ players: args.players, initial: prefix, monitored: args.monitored, ledger: args.ledger, start: args.gameweek, end: horizonEnd });
  const baseline = baselineRoute.projectedPoints - prefix.projectedPoints;
  const liveBudget = round(prefix.bank + prefix.squad.reduce((sum, player) => sum + player.projection.price, 0), 1);
  const optimized = optimizeChipSquad(args.players, liveBudget, args.gameweek, horizonEnd);
  const optimizedScore = optimized ? scoreWindow(optimized, args.gameweek, horizonEnd) : baseline;
  const transfersRequired = optimized ? optimized.filter((player) => !prefix.squad.some((owned) => owned.projection.playerId === player.projection.playerId)).length : 0;
  const gain = optimizedScore - baseline;
  const selected = optimized ?? prefix.squad;
  const keyPlayers = [...selected].sort((a, b) => windowValue(b, args.gameweek, horizonEnd) - windowValue(a, args.gameweek, horizonEnd)).slice(0, 5);
  const confidence = confidenceFor(keyPlayers, args.gameweek, args.nextGameweek);
  return {
    chip: 'wildcard', gameweek: args.gameweek, projectedGain: round(gain), projectedTotal: round(optimizedScore),
    quality: Math.round(clamp(25 + gain * 2 + Math.min(22, transfersRequired * 1.8), 0, 100)), confidence,
    ...riskRange(gain, confidence, args.gameweek - args.nextGameweek, 'wildcard'),
    players: keyPlayers.map((player) => player.projection.playerName), transfersRequired,
    squad: squadSelection(selected, args.gameweek, liveBudget),
    explanation: `The legal rebuild projects ${round(optimizedScore)} points over GW${args.gameweek}–${horizonEnd}, versus ${round(baseline)} from a simulated weekly route that tracks free transfers, bank and hits: a ${round(gain)}-point edge.`,
    caveats: ['The comparison now simulates legal transfers week by week; future prices and newly reported injuries still cannot be known.', 'The Wildcard is permanent and cannot be cancelled once transfer confirmation activates it.'],
  };
}

function assignUniqueGameweeks(available: Array<{ chip: ChipKey; opportunities: ChipOpportunity[] }>, nextGameweek: number): Map<ChipKey, ChipOpportunity> {
  let bestScore = -Infinity;
  let best = new Map<ChipKey, ChipOpportunity>();
  const search = (index: number, used: Set<number>, score: number, selected: Map<ChipKey, ChipOpportunity>) => {
    if (index === available.length) {
      const wildcard = selected.get('wildcard');
      const benchBoost = selected.get('bench_boost');
      const sequenceBonus = wildcard && benchBoost && benchBoost.gameweek > wildcard.gameweek && benchBoost.gameweek - wildcard.gameweek <= 2 ? 8 : 0;
      if (score + sequenceBonus > bestScore) { bestScore = score + sequenceBonus; best = new Map(selected); }
      return;
    }
    const item = available[index];
    for (const opportunity of item.opportunities) {
      if (used.has(opportunity.gameweek)) continue;
      used.add(opportunity.gameweek); selected.set(item.chip, opportunity);
      const certaintyTieBreak = opportunity.gameweek === nextGameweek ? 2 : 0;
      search(index + 1, used, score + opportunity.quality + certaintyTieBreak, selected);
      used.delete(opportunity.gameweek); selected.delete(item.chip);
    }
  };
  search(0, new Set(), 0, new Map());
  return best;
}

export function planChips(args: {
  players: DecisionPlayer[];
  ledger: SquadLedger;
  monitored: MonitoredPlayer[];
  fixtures: OfficialFixture[];
  teams: OfficialTeam[];
  nextGameweek: number;
  ledgerStale: boolean;
  now?: Date;
  deadlineTime?: string | null;
  entryVerification?: ChipPlan['entryVerification'];
  normalTransferGain6?: number;
}): ChipPlan {
  const now = args.now ?? new Date();
  const entryVerification = args.entryVerification ?? { status: 'not_configured' as const, entryId: null, verifiedGameweek: null, squadMatches: null, chipsUsed: [], mismatches: [], message: 'Public-entry cross-check is not configured.', sourceUrl: null };
  const currentHalf = args.nextGameweek <= 19 ? 1 : 2;
  const expiresAfterGameweek = currentHalf === 1 ? 19 : 38;
  const gameweeksRemaining = Math.max(0, expiresAfterGameweek - args.nextGameweek + 1);
  const byId = new Map(args.players.map((player) => [player.projection.playerId, player]));
  const squad = args.ledger.squad.map((entry) => byId.get(entry.elementId)).filter((player): player is DecisionPlayer => Boolean(player));
  const budget = squadBudget(args.ledger, args.monitored);
  const flags = calendarFlags(args.fixtures, args.teams, args.nextGameweek, expiresAfterGameweek);
  const teamNames = new Map(args.teams.map((team) => [team.id, team.short_name]));
  const unassigned = args.fixtures.filter((fixture) => fixture.event == null && !fixture.finished);
  const affectedTeams = [...new Set(unassigned.flatMap((fixture) => [teamNames.get(fixture.team_h), teamNames.get(fixture.team_a)]).filter((team): team is string => Boolean(team)))].sort();
  const uncertaintyLevel = unassigned.length === 0 ? 'low' as const : unassigned.length <= 2 ? 'medium' as const : 'high' as const;
  const flagByGameweek = new Map(flags.map((flag) => [flag.gameweek, flag]));
  const opportunities = new Map<ChipKey, ChipOpportunity[]>(CHIP_KEYS.map((chip) => [chip, []]));

  if (squad.length === 15) {
    for (let gameweek = args.nextGameweek; gameweek <= expiresAfterGameweek; gameweek += 1) {
      opportunities.get('triple_captain')!.push(tripleCaptainOpportunity(squad, gameweek, args.nextGameweek));
      opportunities.get('bench_boost')!.push(benchBoostOpportunity(squad, gameweek, args.nextGameweek));
      opportunities.get('free_hit')!.push(freeHitOpportunity({ players: args.players, squad, budget, gameweek, nextGameweek: args.nextGameweek, flag: flagByGameweek.get(gameweek) }));
      opportunities.get('wildcard')!.push(wildcardOpportunity({ players: args.players, squad, budget, gameweek, end: expiresAfterGameweek, nextGameweek: args.nextGameweek, monitored: args.monitored, ledger: args.ledger }));
    }
  }

  const available = CHIP_KEYS.filter((chip) => normalizeChipStatus(args.ledger, chip) === 'available').map((chip) => ({ chip, opportunities: opportunities.get(chip) ?? [] }));
  let schedule = assignUniqueGameweeks(available, args.nextGameweek);
  const plannedWildcard = schedule.get('wildcard');
  if (plannedWildcard && normalizeChipStatus(args.ledger, 'bench_boost') === 'available') {
    const wildcardSquad = optimizeChipSquad(args.players, budget, plannedWildcard.gameweek, Math.min(expiresAfterGameweek, plannedWildcard.gameweek + 5));
    if (wildcardSquad) for (const gameweek of [plannedWildcard.gameweek + 1, plannedWildcard.gameweek + 2].filter((item) => item <= expiresAfterGameweek)) {
      const prepared = benchBoostOpportunity(wildcardSquad, gameweek, args.nextGameweek);
      prepared.explanation = `A GW${plannedWildcard.gameweek} Wildcard-prepared bench projects ${prepared.projectedGain} points in GW${gameweek}.`;
      prepared.caveats = ['This Bench Boost projection uses the provisional Wildcard squad, so it changes if the rebuild changes.', ...prepared.caveats.slice(1)];
      const list = opportunities.get('bench_boost') ?? [];
      const index = list.findIndex((item) => item.gameweek === gameweek);
      if (index >= 0 && prepared.projectedGain > list[index].projectedGain) list[index] = prepared;
    }
    schedule = assignUniqueGameweeks(available, args.nextGameweek);
  }
  const scarcity = available.length >= gameweeksRemaining;
  const assessments: ChipAssessment[] = CHIP_KEYS.map((chip) => {
    const availability = normalizeChipStatus(args.ledger, chip);
    const all = (opportunities.get(chip) ?? []).sort((a, b) => b.quality - a.quality || a.gameweek - b.gameweek);
    const scheduled = schedule.get(chip) ?? all[0];
    const current = all.find((item) => item.gameweek === args.nextGameweek);
    if (availability === 'used') return { chip, availability, action: 'used', bestGameweek: null, currentGameweekGain: null, confidence: 100, probabilityUseNow: null, expectedRegret: null, reason: 'This chip is recorded as used in the current half-season window.', opportunities: [] };
    if (availability === 'unknown') return { chip, availability, action: 'unknown', bestGameweek: null, currentGameweekGain: current?.projectedGain ?? null, confidence: 20, probabilityUseNow: null, expectedRegret: null, reason: 'The ledger does not confirm whether this chip remains available.', opportunities: all.slice(0, 3) };
    const future = all.filter((item) => item.gameweek !== args.nextGameweek)[0];
    const probability = useNowProbability(current, future);
    const useNow = scheduled?.gameweek === args.nextGameweek && (scheduled.quality >= QUALITY_GATE[chip] || scarcity) && (probability.probability ?? 0) >= 60;
    return {
      chip, availability, action: useNow ? 'use_now' : 'hold', bestGameweek: scheduled?.gameweek ?? null,
      currentGameweekGain: current?.projectedGain ?? null, confidence: scheduled?.confidence ?? 0, probabilityUseNow: probability.probability, expectedRegret: probability.regret,
      reason: useNow
        ? `${scheduled.explanation} The uniquely scheduled chip plan rates this as ${scarcity ? 'necessary because every remaining deadline is needed' : 'strong enough to use now'}.`
        : scheduled ? `Hold for GW${scheduled.gameweek}, currently the best non-colliding opportunity in this half-season window (${scheduled.projectedGain} projected extra points).` : 'No usable opportunity could be calculated.',
      opportunities: all.slice(0, 3),
    };
  });

  const useNowCandidates = assessments.filter((item) => item.action === 'use_now').map((assessment) => ({ assessment, opportunity: (opportunities.get(assessment.chip) ?? []).find((item) => item.gameweek === args.nextGameweek) })).filter((item): item is { assessment: ChipAssessment; opportunity: ChipOpportunity } => Boolean(item.opportunity)).sort((a, b) => b.opportunity.quality - a.opportunity.quality);
  const selected = useNowCandidates[0];
  const deadline = args.deadlineTime ? new Date(args.deadlineTime) : null;
  const hoursToDeadline = deadline && Number.isFinite(deadline.getTime()) ? round((deadline.getTime() - now.getTime()) / 3_600_000, 1) : null;
  const gateStatus = args.ledgerStale ? 'blocked_stale_ledger' as const
    : entryVerification.status === 'mismatch' ? 'blocked_entry_mismatch' as const
      : hoursToDeadline != null && hoursToDeadline > 8 ? 'wait_for_final_refresh' as const : 'open' as const;
  const candidateProbability = selected?.assessment.probabilityUseNow ?? 0;
  const recommendation = args.ledgerStale
    ? { action: 'insufficient_ledger_data' as const, chip: null, gameweek: null, confidence: 0, inputConfidence: 0, headline: 'Confirm the squad before deciding a chip', reason: 'Chip gains depend on the exact owned squad, bank and remaining-chip ledger.' }
    : entryVerification.status === 'mismatch'
      ? { action: 'insufficient_ledger_data' as const, chip: null, gameweek: null, confidence: 0, inputConfidence: 0, headline: 'Resolve the public-entry mismatch first', reason: entryVerification.message }
    : selected
      ? gateStatus === 'wait_for_final_refresh'
        ? { action: 'wait_for_final_refresh' as const, chip: selected.assessment.chip, gameweek: args.nextGameweek, confidence: candidateProbability, inputConfidence: selected.opportunity.confidence, headline: `Provisional ${selected.assessment.chip.replaceAll('_', ' ')} plan for GW${args.nextGameweek}`, reason: `${selected.assessment.reason} Do not activate it before the final refresh window.` }
        : { action: 'use_chip' as const, chip: selected.assessment.chip, gameweek: args.nextGameweek, confidence: candidateProbability, inputConfidence: selected.opportunity.confidence, headline: `Use ${selected.assessment.chip.replaceAll('_', ' ')} in GW${args.nextGameweek}`, reason: selected.assessment.reason }
      : { action: 'no_chip' as const, chip: null, gameweek: args.nextGameweek, confidence: Math.round(assessments.filter((item) => item.availability === 'available').reduce((sum, item) => sum + (100 - (item.probabilityUseNow ?? 50)), 0) / Math.max(1, assessments.filter((item) => item.availability === 'available').length)), inputConfidence: Math.round(assessments.filter((item) => item.availability === 'available').reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, assessments.filter((item) => item.availability === 'available').length)), headline: `Use no chip in GW${args.nextGameweek}`, reason: 'No available chip clears both its quality gate and a 60% simulated probability of being better now than its strongest later window.' };

  const sequence = [...schedule.values()].sort((a, b) => a.gameweek - b.gameweek).map((opportunity) => ({
    chip: opportunity.chip, gameweek: opportunity.gameweek, projectedGain: opportunity.projectedGain, quality: opportunity.quality,
    reason: opportunity.chip === 'bench_boost' && schedule.get('wildcard') && opportunity.gameweek > schedule.get('wildcard')!.gameweek && opportunity.gameweek - schedule.get('wildcard')!.gameweek <= 2
      ? 'Sequenced after the Wildcard so the permanent rebuild can prepare a playing bench.' : opportunity.explanation,
  }));

  return {
    currentHalf, expiresAfterGameweek, gameweeksRemaining, recommendation, assessments, sequence,
    activationGate: {
      status: gateStatus, hoursToDeadline, irreversible: recommendation.chip === 'wildcard' || recommendation.chip === 'free_hit',
      reason: gateStatus === 'blocked_stale_ledger' ? 'The confirmed ledger is stale.' : gateStatus === 'blocked_entry_mismatch' ? entryVerification.message : gateStatus === 'wait_for_final_refresh' ? `Wait until the final eight hours before the deadline; ${hoursToDeadline} hours remain.` : 'The ledger checks pass and the recommendation is inside the final decision window.',
    },
    calendarUncertainty: { unassignedFixtures: unassigned.length, affectedTeams, level: uncertaintyLevel, explanation: unassigned.length ? `${unassigned.length} unfinished fixture${unassigned.length === 1 ? '' : 's'} currently lack an assigned Gameweek, affecting ${affectedTeams.join(', ')}. Future chip windows may move.` : 'Every unfinished fixture currently has an official Gameweek assignment; rearrangements are still possible.' },
    entryVerification, calendarFlags: flags, ruleSourceUrl: CHIP_RULES_URL,
    modelNotes: [
      'The 2026/27 rules provide one Wildcard, Free Hit, Bench Boost and Triple Captain in each half of the season; first-half chips expire after GW19 and only one chip can be used per Gameweek.',
      'Triple Captain values the extra captain score; Bench Boost values the optimized current bench; Free Hit compares a one-week full rebuild; Wildcard compares a permanent six-Gameweek rebuild with a legal week-by-week transfer path that tracks free transfers, bank and hits.',
      'Decision probability is a deterministic 2,000-draw uncertainty simulation. Input confidence remains separate, and the displayed p10–p90 range shows plausible model error rather than guaranteed outcomes.',
      'The scheduler evaluates the chips together, prevents collisions and rewards a Bench Boost prepared one or two deadlines after a Wildcard.',
      'Blank and Double Gameweeks are detected from the current official fixture schedule. Postponements can change that schedule, so distant recommendations lose confidence automatically.',
      'When two windows are within roughly two quality points, the current Gameweek wins the scheduling tie because its team news and price inputs are more reliable.',
      'Chip recommendations never alter the ledger. A chip is only marked used after explicit confirmation.',
    ],
  };
}
