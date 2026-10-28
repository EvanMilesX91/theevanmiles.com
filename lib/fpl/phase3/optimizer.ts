import type { MonitoredPlayer, Position, SquadLedger } from '../phase1';
import type { DecisionPlayer, LineupDecision, ProjectionHorizon, TransferMove, TransferScenario, ValidationResult } from './types';
import { POSITION_LIMITS } from './types';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export function validateSquad(players: DecisionPlayer[]): ValidationResult {
  const errors: string[] = [];
  if (players.length !== 15) errors.push(`Squad must contain 15 players; found ${players.length}.`);
  if (new Set(players.map((player) => player.projection.playerId)).size !== players.length) errors.push('Squad contains duplicate players.');
  for (const [position, expected] of Object.entries(POSITION_LIMITS) as Array<[Position, number]>) {
    const actual = players.filter((player) => player.projection.position === position).length;
    if (actual !== expected) errors.push(`Squad requires ${expected} ${position}; found ${actual}.`);
  }
  const clubs = players.reduce<Map<number, number>>((map, player) => map.set(player.projection.teamId, (map.get(player.projection.teamId) ?? 0) + 1), new Map());
  for (const [teamId, count] of clubs) if (count > 3) errors.push(`Team ${teamId} has ${count} players; maximum is 3.`);
  return { pass: errors.length === 0, errors };
}

function score(player: DecisionPlayer, horizon: ProjectionHorizon): number {
  return player.projection[horizon];
}

function captainScore(player: DecisionPlayer): number {
  const projection = player.projection;
  const upside = Math.max(0, projection.ceiling1 - projection.xPts1);
  const downside = Math.max(0, projection.xPts1 - projection.floor1);
  return projection.xPts1 * (0.7 + projection.confidence / 100 * 0.3) + upside * 0.18 - downside * 0.08;
}

export function optimizeLineup(squad: DecisionPlayer[]): LineupDecision {
  const squadValidation = validateSquad(squad);
  const byPosition = (position: Position) => squad.filter((player) => player.projection.position === position).sort((a, b) => b.projection.xPts1 - a.projection.xPts1);
  const goalkeepers = byPosition('GK');
  let best: DecisionPlayer[] = [];
  let formation = '';
  let bestPoints = -Infinity;
  for (let defenders = 3; defenders <= 5; defenders += 1) {
    for (let midfielders = 2; midfielders <= 5; midfielders += 1) {
      const forwards = 10 - defenders - midfielders;
      if (forwards < 1 || forwards > 3) continue;
      const selected = [goalkeepers[0], ...byPosition('DEF').slice(0, defenders), ...byPosition('MID').slice(0, midfielders), ...byPosition('FWD').slice(0, forwards)].filter(Boolean);
      const points = selected.reduce((sum, player) => sum + player.projection.xPts1, 0);
      if (selected.length === 11 && points > bestPoints) {
        best = selected;
        bestPoints = points;
        formation = `${defenders}-${midfielders}-${forwards}`;
      }
    }
  }
  const starterIds = new Set(best.map((player) => player.projection.playerId));
  const benchGoalkeeper = goalkeepers.find((player) => !starterIds.has(player.projection.playerId));
  const benchOutfield = squad.filter((player) => player.projection.position !== 'GK' && !starterIds.has(player.projection.playerId)).sort((a, b) => b.projection.xPts1 - a.projection.xPts1);
  const rankedCaptaincy = [...best].sort((a, b) => captainScore(b) - captainScore(a));
  const captaincy = rankedCaptaincy.slice(0, 5).map((player, index) => ({
    playerId: player.projection.playerId, playerName: player.projection.playerName,
    relativeScore: round(captainScore(player)), xPts1: player.projection.xPts1, ceiling1: player.projection.ceiling1,
    confidence: player.projection.confidence,
    reason: `${player.projection.xPts1} xPts, ${player.projection.ceiling1} ceiling and ${player.projection.minutes.expectedMinutesPerFixture} expected minutes.`,
  }));
  const lineupErrors = [...squadValidation.errors];
  if (best.length !== 11) lineupErrors.push('No legal starting formation could be formed.');
  const captain = rankedCaptaincy[0] ?? squad[0];
  const vice = rankedCaptaincy[1] ?? captain;
  return {
    starterIds: best.map((player) => player.projection.playerId),
    benchIds: [...benchOutfield.map((player) => player.projection.playerId), ...(benchGoalkeeper ? [benchGoalkeeper.projection.playerId] : [])],
    captainId: captain?.projection.playerId ?? 0, viceCaptainId: vice?.projection.playerId ?? 0, formation,
    xPts1BeforeCaptain: round(Math.max(0, bestPoints)), xPts1WithCaptain: round(Math.max(0, bestPoints) + (captain?.projection.xPts1 ?? 0)),
    confidence: best.length ? Math.round(best.reduce((sum, player) => sum + player.projection.confidence, 0) / best.length) : 0,
    captaincy, validation: { pass: lineupErrors.length === 0, errors: lineupErrors },
  };
}

function horizonLineupScore(squad: DecisionPlayer[], horizon: ProjectionHorizon): number {
  const gk = squad.filter((player) => player.projection.position === 'GK').sort((a, b) => score(b, horizon) - score(a, horizon))[0];
  let best = -Infinity;
  for (let defenders = 3; defenders <= 5; defenders += 1) {
    for (let midfielders = 2; midfielders <= 5; midfielders += 1) {
      const forwards = 10 - defenders - midfielders;
      if (forwards < 1 || forwards > 3) continue;
      const selected = [gk,
        ...squad.filter((player) => player.projection.position === 'DEF').sort((a, b) => score(b, horizon) - score(a, horizon)).slice(0, defenders),
        ...squad.filter((player) => player.projection.position === 'MID').sort((a, b) => score(b, horizon) - score(a, horizon)).slice(0, midfielders),
        ...squad.filter((player) => player.projection.position === 'FWD').sort((a, b) => score(b, horizon) - score(a, horizon)).slice(0, forwards),
      ].filter(Boolean);
      if (selected.length !== 11) continue;
      const base = selected.reduce((sum, player) => sum + score(player, horizon), 0);
      const captain = Math.max(...selected.map((player) => score(player, horizon)));
      best = Math.max(best, base + captain);
    }
  }
  return Math.max(0, best);
}

function scenario(args: { id: string; squad: DecisionPlayer[]; moves: TransferMove[]; bankAfter: number; freeTransfers: number; baseline: Record<ProjectionHorizon, number> }): TransferScenario {
  const hitCost = Math.max(0, args.moves.length - args.freeTransfers) * 4;
  const gross1 = horizonLineupScore(args.squad, 'xPts1') - args.baseline.xPts1;
  const gross3 = horizonLineupScore(args.squad, 'xPts3') - args.baseline.xPts3;
  const gross6 = horizonLineupScore(args.squad, 'xPts6') - args.baseline.xPts6;
  const net1 = gross1 - hitCost;
  const net3 = gross3 - hitCost;
  const net6 = gross6 - hitCost;
  const lineup = optimizeLineup(args.squad);
  const validation = validateSquad(args.squad);
  const confidence = args.moves.length
    ? Math.round(args.moves.reduce((sum, move) => sum + (args.squad.find((player) => player.projection.playerId === move.inPlayerId)?.projection.confidence ?? 0), 0) / args.moves.length)
    : lineup.confidence;
  const z = net3 / Math.max(1, 5.5 * Math.sqrt(3) * (1.25 - confidence / 200));
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = 0.3989423 * Math.exp(-z * z / 2);
  const tail = density * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const beatRollProbability3 = Math.round((z >= 0 ? 1 - tail : tail) * 100);
  const rawDecisionScore = net1 * 0.45 + (net3 / 3) * 0.35 + (net6 / 6) * 0.2;
  const decisionScore = rawDecisionScore * (0.5 + beatRollProbability3 / 100);
  const kind = args.moves.length === 0 ? 'roll' : hitCost > 0 ? 'hit' : args.moves.length === 1 ? 'one_transfer' : 'two_transfers';
  return {
    id: args.id, kind, moves: args.moves, bankAfter: round(args.bankAfter, 1), hitCost,
    grossGain1: round(gross1), netGain1: round(net1), grossGain3: round(gross3), netGain3: round(net3), grossGain6: round(gross6), netGain6: round(net6),
    decisionScore: round(decisionScore), beatRollProbability3, downsideRisk3: 100 - beatRollProbability3, confidence, lineup, validation,
    explanation: args.moves.length === 0
      ? 'Keep the confirmed squad and preserve the free transfer.'
      : `${args.moves.map((move) => `${move.outPlayerName} → ${move.inPlayerName}`).join('; ')} projects ${round(net3)} net points over three Gameweeks after a ${hitCost}-point hit, with a ${beatRollProbability3}% modelled chance of beating the roll baseline.`,
  };
}

function clubLegal(players: DecisionPlayer[]): boolean {
  const counts = new Map<number, number>();
  for (const player of players) {
    const count = (counts.get(player.projection.teamId) ?? 0) + 1;
    if (count > 3) return false;
    counts.set(player.projection.teamId, count);
  }
  return true;
}

export function optimizeTransfers(args: { players: DecisionPlayer[]; ledger: SquadLedger; monitored: MonitoredPlayer[] }): { baseline: TransferScenario; scenarios: TransferScenario[] } {
  const playerById = new Map(args.players.map((player) => [player.projection.playerId, player]));
  const monitoredById = new Map(args.monitored.map((player) => [player.id, player]));
  const ownedIds = new Set(args.ledger.squad.map((player) => player.elementId));
  const owned = args.ledger.squad.map((entry) => playerById.get(entry.elementId)).filter((player): player is DecisionPlayer => Boolean(player));
  const baselineScores = { xPts1: horizonLineupScore(owned, 'xPts1'), xPts3: horizonLineupScore(owned, 'xPts3'), xPts6: horizonLineupScore(owned, 'xPts6') };
  const baseline = scenario({ id: 'roll', squad: owned, moves: [], bankAfter: args.ledger.bank, freeTransfers: args.ledger.freeTransfers, baseline: baselineScores });
  const candidates = new Map<Position, DecisionPlayer[]>();
  for (const position of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    candidates.set(position, args.players.filter((player) => player.projection.position === position && !ownedIds.has(player.projection.playerId) && player.projection.minutes.appearanceProbability >= 0.5 && player.projection.fixtures.length > 0)
      .sort((a, b) => (b.projection.xPts3 + b.value.valueAboveReplacement6 * 0.08) - (a.projection.xPts3 + a.value.valueAboveReplacement6 * 0.08)).slice(0, 12));
  }
  const results: TransferScenario[] = [];
  const ledgerEntry = new Map(args.ledger.squad.map((player) => [player.elementId, player]));
  const sellPrice = (player: DecisionPlayer) => monitoredById.get(player.projection.playerId)?.sellingPrice ?? ledgerEntry.get(player.projection.playerId)?.purchasePrice ?? player.projection.price;
  const makeMove = (out: DecisionPlayer, incoming: DecisionPlayer): TransferMove => ({ outPlayerId: out.projection.playerId, outPlayerName: out.projection.playerName, inPlayerId: incoming.projection.playerId, inPlayerName: incoming.projection.playerName, sellPrice: sellPrice(out), buyPrice: incoming.projection.price });
  const replace = (outs: DecisionPlayer[], ins: DecisionPlayer[]) => owned.filter((player) => !outs.some((out) => out.projection.playerId === player.projection.playerId)).concat(ins);

  for (const out of owned) {
    for (const incoming of candidates.get(out.projection.position) ?? []) {
      const bankAfter = args.ledger.bank + sellPrice(out) - incoming.projection.price;
      if (bankAfter < -0.001) continue;
      const squad = replace([out], [incoming]);
      if (!clubLegal(squad)) continue;
      results.push(scenario({ id: `one-${out.projection.playerId}-${incoming.projection.playerId}`, squad, moves: [makeMove(out, incoming)], bankAfter, freeTransfers: args.ledger.freeTransfers, baseline: baselineScores }));
    }
  }

  const likelyOuts = [...owned].sort((a, b) => a.projection.xPts3 - b.projection.xPts3).slice(0, 9);
  for (let first = 0; first < likelyOuts.length; first += 1) {
    for (let second = first + 1; second < likelyOuts.length; second += 1) {
      const outA = likelyOuts[first];
      const outB = likelyOuts[second];
      const poolA = (candidates.get(outA.projection.position) ?? []).slice(0, 8);
      const poolB = (candidates.get(outB.projection.position) ?? []).slice(0, 8);
      for (const inA of poolA) for (const inB of poolB) {
        if (inA.projection.playerId === inB.projection.playerId) continue;
        const bankAfter = args.ledger.bank + sellPrice(outA) + sellPrice(outB) - inA.projection.price - inB.projection.price;
        if (bankAfter < -0.001) continue;
        const squad = replace([outA, outB], [inA, inB]);
        if (!clubLegal(squad) || !validateSquad(squad).pass) continue;
        const moves = [makeMove(outA, inA), makeMove(outB, inB)];
        results.push(scenario({ id: `two-${outA.projection.playerId}-${inA.projection.playerId}-${outB.projection.playerId}-${inB.projection.playerId}`, squad, moves, bankAfter, freeTransfers: args.ledger.freeTransfers, baseline: baselineScores }));
      }
    }
  }
  return { baseline, scenarios: results.filter((item) => item.validation.pass).sort((a, b) => b.decisionScore - a.decisionScore || b.netGain3 - a.netGain3).slice(0, 20) };
}
