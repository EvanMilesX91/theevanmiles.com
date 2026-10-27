import { describe, expect, it } from 'vitest';
import type { DecisionPlayer } from '@/lib/fpl/phase3';
import type { PlayerCouncil } from '@/lib/fpl/phase4';
import { buildDashboardPlayer, isLedgerStale } from '@/lib/fpl/phase5';

const decisionPlayer: DecisionPlayer = {
  projection: {
    playerId: 42,
    playerName: 'Test Midfielder',
    teamId: 3,
    team: 'Test FC',
    position: 'MID',
    price: 7.5,
    owned: true,
    minutes: {
      startProbability: 0.86,
      appearanceProbability: 0.94,
      expectedMinutesPerFixture: 76,
      expectedMinutes1: 76,
      expectedMinutes3: 228,
      expectedMinutes6: 456,
      rotationRisk: 'low',
      confidence: 82,
      evidence: ['regular starter'],
    },
    role: {
      listedPosition: 'MID', tacticalRole: 'advanced', change: 'possible',
      confidence: 74, observations: 3, latestGameweek: 7, evidence: ['higher touch map'],
    },
    sustainability: {
      observedPointsPer90: 6.1, sustainablePointsPer90: 5.7, expectedGoalsPer90: 0.31,
      expectedAssistsPer90: 0.24, regressedBonusPer90: 0.4, defensiveContributionPointsPer90: 0.3,
      regressionGap: 0.4, label: 'sustainable', confidence: 76,
    },
    fixtures: [],
    xPts1: 5.6,
    xPts3: 16.4,
    xPts6: 31.2,
    floor1: 2.1,
    ceiling1: 10.4,
    confidence: 79,
    oneLineReason: 'Secure minutes and an improved attacking role support the pick.',
  },
  value: {
    xPtsPerMillion1: 0.75, xPtsPerMillion3: 2.19, xPtsPerMillion6: 4.16,
    replacement: { playerId: 7, playerName: 'Replacement', price: 5, xPts6: 22 },
    valueAboveReplacement6: 9.2, cheaperAlternativeId: 7, cheaperAlternativeName: 'Replacement',
    saving: 2.5, pointsSacrificed6: 9.2, marginalXptsPerHalfMillion: 1.84,
    captainAdjustedValue1: 0.75, opportunityCost: 'Premium spend is justified by the projection edge.',
  },
  pricePressure: {
    currentPrice: 7.5, netTransfers: 20000, pressure: 0.2, direction: 'rise_watch', confidence: 55,
    urgency: 'monitor', source: 'official_transfer_activity_proxy', caveat: 'Not an official price-change forecast.',
  },
  newPlayer: { sample: 'established', priorReliance: 0.2, confidenceCap: 92, treatment: 'established' },
};

const council: PlayerCouncil = {
  playerId: 42,
  playerName: 'Test Midfielder',
  score: 76,
  confidence: 78,
  verdict: 'buy',
  disagreement: false,
  disagreementSpread: 12,
  disagreementSummary: null,
  opinions: [],
  for: ['Secure minutes'],
  against: ['Price limits flexibility'],
};

describe('Phase 5 dashboard view model', () => {
  it('condenses the decision model without losing the evidence needed by the interface', () => {
    const result = buildDashboardPlayer(decisionPlayer, council);
    expect(result).toMatchObject({
      id: 42,
      name: 'Test Midfielder',
      owned: true,
      xPts3: 16.4,
      expectedMinutes: 76,
      startProbability: 0.86,
      roleChange: 'possible',
      council,
    });
    expect(result.value.valueAboveReplacement6).toBe(9.2);
    expect(result.pricePressure.direction).toBe('rise_watch');
  });

  it('blocks decisions only when the confirmed ledger trails the official gameweek', () => {
    expect(isLedgerStale(8, 9)).toBe(true);
    expect(isLedgerStale(9, 9)).toBe(false);
    expect(isLedgerStale(10, 9)).toBe(false);
  });
});
