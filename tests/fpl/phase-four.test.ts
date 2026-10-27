import { describe, expect, it } from 'vitest';
import type { MonitoredPlayer, Position } from '@/lib/fpl/phase1';
import type { DecisionPlayer, TransferScenario } from '@/lib/fpl/phase3';
import { buildPlayerCouncils, buildRedTeamReview, comparePlayers } from '@/lib/fpl/phase4';

function player(id: number, name: string, position: Position, xPts1: number, price: number, confidence = 80, startProbability = 0.9): DecisionPlayer {
  return {
    projection: {
      playerId: id, playerName: name, teamId: id, team: `Team ${id}`, position, price, owned: id < 10,
      minutes: { startProbability, appearanceProbability: Math.min(0.99, startProbability + 0.1), expectedMinutesPerFixture: startProbability * 85, expectedMinutes1: 80, expectedMinutes3: 240, expectedMinutes6: 480, rotationRisk: startProbability < 0.6 ? 'high' : 'low', confidence, evidence: [] },
      role: { listedPosition: position, tacticalRole: position === 'FWD' ? 'forward' : 'central', change: 'none', confidence: 70, observations: 3, latestGameweek: 7, evidence: [] },
      sustainability: { observedPointsPer90: 5, sustainablePointsPer90: 5, expectedGoalsPer90: 0.3, expectedAssistsPer90: 0.2, regressedBonusPer90: 0.3, defensiveContributionPointsPer90: position === 'DEF' ? 1.5 : 0.2, regressionGap: 0, label: 'sustainable', confidence },
      fixtures: [1, 2, 3].map((gameweek) => ({ gameweek, opponent: 'OPP', home: true, expectedMinutes: 80, xPts: xPts1, floor: Math.max(0, xPts1 - 2), ceiling: xPts1 + 3, components: { appearance: 2, goals: 1, assists: 1, cleanSheet: 1, saves: 0, defensiveContribution: 0.5, bonus: 0.5, discipline: 0 }, explanation: 'test' })),
      xPts1, xPts3: xPts1 * 3, xPts6: xPts1 * 6, floor1: Math.max(0, xPts1 - 2), ceiling1: xPts1 + 3, confidence, oneLineReason: 'test',
    },
    value: { xPtsPerMillion1: xPts1 / price, xPtsPerMillion3: xPts1 * 3 / price, xPtsPerMillion6: xPts1 * 6 / price, replacement: { playerId: id, playerName: name, price, xPts6: xPts1 * 5 }, valueAboveReplacement6: xPts1, cheaperAlternativeId: null, cheaperAlternativeName: null, saving: 0, pointsSacrificed6: 0, marginalXptsPerHalfMillion: null, captainAdjustedValue1: xPts1 / price, opportunityCost: 'test' },
    pricePressure: { currentPrice: price, netTransfers: 0, pressure: 0, direction: 'stable', confidence: 30, urgency: 'none', source: 'official_transfer_activity_proxy', caveat: 'test' },
    newPlayer: { sample: 'established', priorReliance: 0.2, confidenceCap: 92, treatment: 'established' },
  };
}

function monitored(players: DecisionPlayer[]): MonitoredPlayer[] {
  return players.map((item) => ({ id: item.projection.playerId, totalPoints: item.projection.xPts6, seasonMinutes: 600, seasonStarts: 7, ownership: item.projection.playerId * 5, status: 'a' })) as MonitoredPlayer[];
}

function scenario(id: string, moves: TransferScenario['moves'], starterIds: number[]): TransferScenario {
  return { id, kind: moves.length ? 'one_transfer' : 'roll', moves, bankAfter: 1, hitCost: 0, grossGain1: 1, netGain1: 1, grossGain3: 3, netGain3: 3, grossGain6: 6, netGain6: 6, decisionScore: 1, confidence: 75,
    lineup: { starterIds, benchIds: [], captainId: starterIds[0] ?? 0, viceCaptainId: starterIds[1] ?? 0, formation: '3-4-3', xPts1BeforeCaptain: 50, xPts1WithCaptain: 57, confidence: 75, captaincy: [], validation: { pass: true, errors: [] } },
    validation: { pass: true, errors: [] }, explanation: 'test' };
}

describe('Phase 4 explainability', () => {
  it('uses ten distinct lenses and surfaces upside-versus-minutes disagreement', () => {
    const upside = player(1, 'Upside', 'MID', 9, 6, 50, 0.1);
    upside.projection.minutes.appearanceProbability = 0.5;
    const players = [upside, player(2, 'Safe', 'MID', 5, 6), player(3, 'Budget', 'MID', 4, 4.5)];
    const council = buildPlayerCouncils(players, monitored(players), new Set([1])).find((item) => item.playerId === 1)!;
    expect(council.opinions).toHaveLength(10);
    expect(council.disagreement).toBe(true);
    expect(council.disagreementSummary).toContain('while');
  });

  it('caps historical confidence when verified multi-season data is unavailable', () => {
    const players = [player(1, 'One', 'FWD', 7, 10), player(2, 'Two', 'FWD', 5, 7)];
    const historical = buildPlayerCouncils(players, monitored(players), new Set()).find((item) => item.playerId === 1)!.opinions.find((item) => item.key === 'historical')!;
    expect(historical.confidence).toBeLessThanOrEqual(50);
    expect(historical.reason).toContain('multi-season history is not yet loaded');
  });

  it('explains direct player opportunity cost and reversal conditions', () => {
    const selected = player(1, 'Selected', 'DEF', 6, 5);
    const alternative = player(2, 'Alternative', 'DEF', 5, 5.5);
    const councils = buildPlayerCouncils([selected, alternative], monitored([selected, alternative]), new Set());
    const result = comparePlayers(selected, alternative, new Map(councils.map((council) => [council.playerId, council])));
    expect(result.decision).toBe('Selected');
    expect(result.reason).toContain('both cheaper and projects better');
    expect(result.whatWouldChange).toContain('would overturn');
  });

  it('lets the Red Team block recommendations based on an obsolete ledger', () => {
    const players = [player(1, 'Owned', 'MID', 5, 6), player(2, 'Incoming', 'MID', 6, 6), player(3, 'Alternative', 'MID', 5.8, 5.5)];
    const councils = buildPlayerCouncils(players, monitored(players), new Set());
    const primary = scenario('primary', [{ outPlayerId: 1, outPlayerName: 'Owned', inPlayerId: 2, inPlayerName: 'Incoming', sellPrice: 6, buyPrice: 6 }], [2]);
    const alternative = scenario('alternative', [{ outPlayerId: 4, outPlayerName: 'Other', inPlayerId: 3, inPlayerName: 'Alternative', sellPrice: 5, buyPrice: 5.5 }], [1]);
    const result = buildRedTeamReview({ primary, scenarios: [primary, alternative], baseline: scenario('roll', [], [1]), players, councils, ownedIds: [1], sourceHealth: [], staleLedger: true });
    expect(result.verdict).toBe('block');
    expect(result.strongestObjection).toContain('confirmed ledger');
    expect(result.alternativeScenario.id).toBe('alternative');
    expect(result.materiallyDifferent).toBe(true);
  });
});
