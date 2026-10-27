import { describe, expect, it } from 'vitest';
import type { MonitoredPlayer, OfficialPlayer, Position, SquadLedger } from '@/lib/fpl/phase1';
import type { PlayerProjection } from '@/lib/fpl/phase2';
import { buildDecisionPlayers, optimizeLineup, optimizeTransfers, validateSquad } from '@/lib/fpl/phase3';
import type { DecisionPlayer } from '@/lib/fpl/phase3';

function projection(id: number, position: Position, teamId: number, points: number, price = 5): PlayerProjection {
  return {
    playerId: id, playerName: `P${id}`, teamId, team: `T${teamId}`, position, price, owned: id <= 15,
    minutes: { startProbability: 0.9, appearanceProbability: 0.95, expectedMinutesPerFixture: 80, expectedMinutes1: 80, expectedMinutes3: 240, expectedMinutes6: 480, rotationRisk: 'low', confidence: 80, evidence: [] },
    role: { listedPosition: position, tacticalRole: position === 'GK' ? 'goalkeeper' : position === 'FWD' ? 'forward' : 'central', change: 'none', confidence: 70, observations: 3, latestGameweek: 7, evidence: [] },
    sustainability: { observedPointsPer90: 5, sustainablePointsPer90: 5, expectedGoalsPer90: 0.2, expectedAssistsPer90: 0.15, regressedBonusPer90: 0.3, defensiveContributionPointsPer90: 0.5, regressionGap: 0, label: 'sustainable', confidence: 75 },
    fixtures: [{ gameweek: 8, opponent: 'OPP', home: true, expectedMinutes: 80, xPts: points, floor: Math.max(0, points - 2), ceiling: points + 3, components: { appearance: 2, goals: 1, assists: 1, cleanSheet: 1, saves: 0, defensiveContribution: 0.5, bonus: 0.5, discipline: 0 }, explanation: 'test' }],
    xPts1: points, xPts3: points * 3, xPts6: points * 6, floor1: Math.max(0, points - 2), ceiling1: points + 3, confidence: 80, oneLineReason: 'test',
  };
}

function decision(item: PlayerProjection): DecisionPlayer {
  return {
    projection: item,
    value: { xPtsPerMillion1: 1, xPtsPerMillion3: 3, xPtsPerMillion6: 6, replacement: { playerId: item.playerId, playerName: item.playerName, price: item.price, xPts6: item.xPts6 }, valueAboveReplacement6: 0, cheaperAlternativeId: null, cheaperAlternativeName: null, saving: 0, pointsSacrificed6: 0, marginalXptsPerHalfMillion: null, captainAdjustedValue1: 1, opportunityCost: '' },
    pricePressure: { currentPrice: item.price, netTransfers: 0, pressure: 0, direction: 'stable', confidence: 35, urgency: 'none', source: 'official_transfer_activity_proxy', caveat: '' },
    newPlayer: { sample: 'established', priorReliance: 0.2, confidenceCap: 92, treatment: '' },
  };
}

function squad(): DecisionPlayer[] {
  const positions: Position[] = ['GK', 'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'];
  return positions.map((position, index) => decision(projection(index + 1, position, (index % 8) + 1, index === 12 ? 8 : 3 + index / 10)));
}

function official(item: PlayerProjection, overrides: Partial<OfficialPlayer> = {}): OfficialPlayer {
  return { id: item.playerId, first_name: 'P', second_name: String(item.playerId), web_name: item.playerName, team: item.teamId, element_type: { GK: 1, DEF: 2, MID: 3, FWD: 4 }[item.position], now_cost: item.price * 10, total_points: 0, points_per_game: '0', form: '0', minutes: 600, starts: 7, goals_scored: 0, assists: 0, clean_sheets: 0, bonus: 0, defensive_contribution: 0, expected_goals: '0', expected_assists: '0', expected_goal_involvements: '0', selected_by_percent: '1', transfers_in_event: 0, transfers_out_event: 0, status: 'a', news: '', news_added: null, chance_of_playing_next_round: null, ...overrides };
}

describe('Phase 3 decision layer', () => {
  it('rejects mathematically invalid squads', () => {
    const invalid = squad().map((player, index) => index < 4 ? { ...player, projection: { ...player.projection, teamId: 99 } } : player);
    expect(validateSquad(invalid).pass).toBe(false);
    expect(validateSquad(invalid).errors.some((error) => error.includes('maximum is 3'))).toBe(true);
  });

  it('selects a legal XI and captain by exhaustive formation search', () => {
    const result = optimizeLineup(squad());
    expect(result.validation.pass).toBe(true);
    expect(result.starterIds).toHaveLength(11);
    expect(result.benchIds).toHaveLength(4);
    expect(result.captainId).toBe(13);
    expect(result.formation).toMatch(/^3|4|5/);
  });

  it('compares affordable transfers without mutating the ledger', () => {
    const owned = squad();
    const incoming = decision(projection(16, 'FWD', 9, 9, 5));
    const ledger: SquadLedger = { schemaVersion: 1, managerName: 'Test', teamName: 'Test', lastConfirmedGameweek: 7, nextGameweek: 8, bank: 0, freeTransfers: 1, squad: owned.map((player) => ({ elementId: player.projection.playerId, purchasePrice: player.projection.price, acquiredGameweek: 1 })), lastConfirmedXi: [], captainId: null, viceCaptainId: null, chips: {}, confirmedTransfers: [], confirmedGameweeks: [], updatedAt: '2026-01-01T00:00:00Z' };
    const before = JSON.stringify(ledger);
    const result = optimizeTransfers({ players: [...owned, incoming], ledger, monitored: owned.map((player) => ({ id: player.projection.playerId, sellingPrice: player.projection.price })) as MonitoredPlayer[] });
    expect(result.scenarios.some((item) => item.moves.some((move) => move.inPlayerId === 16))).toBe(true);
    expect(result.scenarios.every((item) => item.validation.pass && item.bankAfter >= 0)).toBe(true);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it('keeps unproven players in the pool with explicit prior reliance and labels price pressure as a proxy', () => {
    const pool = squad().map((player) => player.projection);
    const officials = pool.map((item, index) => official(item, index === 0 ? { minutes: 0, starts: 0, transfers_in_event: 100_000 } : {}));
    const result = buildDecisionPlayers(pool, officials).find((player) => player.projection.playerId === 1)!;
    expect(result.newPlayer.sample).toBe('unproven');
    expect(result.newPlayer.priorReliance).toBeGreaterThan(0.9);
    expect(result.pricePressure.source).toBe('official_transfer_activity_proxy');
    expect(result.pricePressure.caveat).toContain('not an official forecast');
  });
});
