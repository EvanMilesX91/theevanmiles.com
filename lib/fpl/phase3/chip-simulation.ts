import type { MonitoredPlayer, Position, SquadLedger } from '../phase1';
import { optimizeLineup, validateSquad } from './optimizer';
import type { DecisionPlayer, TransferMove } from './types';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function fixtureValue(player: DecisionPlayer, gameweek: number): number {
  return player.projection.fixtures.filter((fixture) => fixture.gameweek === gameweek).reduce((sum, fixture) => sum + fixture.xPts, 0);
}

function remainingValue(player: DecisionPlayer, start: number, end: number): number {
  return player.projection.fixtures.filter((fixture) => fixture.gameweek >= start && fixture.gameweek <= end).reduce((sum, fixture) => sum + fixture.xPts, 0);
}

function gameweekScore(squad: DecisionPlayer[], gameweek: number): number {
  const adjusted = squad.map((player) => ({
    ...player,
    projection: { ...player.projection, xPts1: fixtureValue(player, gameweek) },
  }));
  return optimizeLineup(adjusted).xPts1WithCaptain;
}

function legalClubLimit(players: DecisionPlayer[]): boolean {
  const clubs = new Map<number, number>();
  for (const player of players) {
    const count = (clubs.get(player.projection.teamId) ?? 0) + 1;
    if (count > 3) return false;
    clubs.set(player.projection.teamId, count);
  }
  return true;
}

export interface TransferPathWeek {
  gameweek: number;
  moves: TransferMove[];
  hitCost: number;
  lineupPoints: number;
  bankAfter: number;
  freeTransfersAfter: number;
}

export interface TransferPath {
  squad: DecisionPlayer[];
  bank: number;
  freeTransfers: number;
  projectedPoints: number;
  hitCost: number;
  weeks: TransferPathWeek[];
}

interface State extends TransferPath { rank: number }

function key(state: State): string {
  return `${state.squad.map((player) => player.projection.playerId).sort((a, b) => a - b).join('-')}|${state.bank.toFixed(1)}|${state.freeTransfers}`;
}

export function simulateNormalTransferPath(args: {
  players: DecisionPlayer[];
  initial: TransferPath;
  monitored: MonitoredPlayer[];
  ledger: SquadLedger;
  start: number;
  end: number;
  beamWidth?: number;
}): TransferPath {
  if (args.start > args.end) return args.initial;
  const monitored = new Map(args.monitored.map((player) => [player.id, player]));
  const ledger = new Map(args.ledger.squad.map((player) => [player.elementId, player]));
  const sellPrice = (player: DecisionPlayer) => monitored.get(player.projection.playerId)?.sellingPrice
    ?? ledger.get(player.projection.playerId)?.purchasePrice ?? player.projection.price;
  let states: State[] = [{ ...args.initial, rank: args.initial.projectedPoints }];

  for (let gameweek = args.start; gameweek <= args.end; gameweek += 1) {
    const generated: State[] = [];
    for (const state of states) {
      const owned = new Set(state.squad.map((player) => player.projection.playerId));
      const weak = [...state.squad].sort((a, b) => remainingValue(a, gameweek, args.end) - remainingValue(b, gameweek, args.end)).slice(0, 7);
      const incoming = new Map<Position, DecisionPlayer[]>();
      for (const position of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) incoming.set(position, args.players
        .filter((player) => player.projection.position === position && !owned.has(player.projection.playerId) && player.projection.minutes.appearanceProbability >= 0.45)
        .sort((a, b) => remainingValue(b, gameweek, args.end) - remainingValue(a, gameweek, args.end)).slice(0, 7));

      const actions: Array<{ squad: DecisionPlayer[]; bank: number; moves: TransferMove[] }> = [{ squad: state.squad, bank: state.bank, moves: [] }];
      for (const out of weak) for (const next of incoming.get(out.projection.position) ?? []) {
        const bank = state.bank + sellPrice(out) - next.projection.price;
        if (bank < -0.001) continue;
        const squad = state.squad.filter((player) => player.projection.playerId !== out.projection.playerId).concat(next);
        if (!legalClubLimit(squad)) continue;
        actions.push({ squad, bank, moves: [{ outPlayerId: out.projection.playerId, outPlayerName: out.projection.playerName, inPlayerId: next.projection.playerId, inPlayerName: next.projection.playerName, sellPrice: sellPrice(out), buyPrice: next.projection.price }] });
      }
      const singles = actions.filter((action) => action.moves.length === 1).sort((a, b) => remainingValue(b.squad.find((player) => player.projection.playerId === b.moves[0].inPlayerId)!, gameweek, args.end) - remainingValue(a.squad.find((player) => player.projection.playerId === a.moves[0].inPlayerId)!, gameweek, args.end)).slice(0, 10);
      if (state.freeTransfers >= 2) for (let first = 0; first < singles.length; first += 1) for (let second = first + 1; second < singles.length; second += 1) {
        const one = singles[first].moves[0]; const two = singles[second].moves[0];
        if (one.outPlayerId === two.outPlayerId || one.inPlayerId === two.inPlayerId) continue;
        const outA = state.squad.find((player) => player.projection.playerId === one.outPlayerId)!;
        const outB = state.squad.find((player) => player.projection.playerId === two.outPlayerId)!;
        const inA = args.players.find((player) => player.projection.playerId === one.inPlayerId)!;
        const inB = args.players.find((player) => player.projection.playerId === two.inPlayerId)!;
        const bank = state.bank + sellPrice(outA) + sellPrice(outB) - inA.projection.price - inB.projection.price;
        const squad = state.squad.filter((player) => player.projection.playerId !== one.outPlayerId && player.projection.playerId !== two.outPlayerId).concat(inA, inB);
        if (bank >= -0.001 && legalClubLimit(squad) && validateSquad(squad).pass) actions.push({ squad, bank, moves: [one, two] });
      }

      for (const action of actions) {
        const hitCost = Math.max(0, action.moves.length - state.freeTransfers) * 4;
        const lineupPoints = gameweekScore(action.squad, gameweek);
        const freeTransfers = Math.min(5, Math.max(0, state.freeTransfers - action.moves.length) + 1);
        const projectedPoints = state.projectedPoints + lineupPoints - hitCost;
        const future = action.squad.reduce((sum, player) => sum + remainingValue(player, gameweek + 1, args.end), 0);
        generated.push({ squad: action.squad, bank: round(action.bank, 1), freeTransfers, projectedPoints: round(projectedPoints), hitCost: state.hitCost + hitCost, weeks: [...state.weeks, { gameweek, moves: action.moves, hitCost, lineupPoints, bankAfter: round(action.bank, 1), freeTransfersAfter: freeTransfers }], rank: projectedPoints + future * 0.12 });
      }
    }
    const deduped = new Map<string, State>();
    for (const state of generated.sort((a, b) => b.rank - a.rank)) if (!deduped.has(key(state))) deduped.set(key(state), state);
    states = [...deduped.values()].slice(0, args.beamWidth ?? 45);
  }
  const best = states.sort((a, b) => b.projectedPoints - a.projectedPoints)[0];
  return best ? { squad: best.squad, bank: best.bank, freeTransfers: best.freeTransfers, projectedPoints: best.projectedPoints, hitCost: best.hitCost, weeks: best.weeks } : args.initial;
}
