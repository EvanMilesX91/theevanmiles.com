import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OWNER_LEDGER,
  buildMonitoredPlayers,
  calculateRollingWindow,
  confirmTransfer,
  createTransferProposal,
  detectChanges,
  generateProactiveAlerts,
} from '@/lib/fpl/phase1';
import type {
  EventLive,
  MonitoredPlayer,
  OfficialPlayer,
  PhaseOneSnapshot,
} from '@/lib/fpl/phase1';

function officialPlayer(overrides: Partial<OfficialPlayer> & Pick<OfficialPlayer, 'id' | 'web_name' | 'element_type' | 'now_cost'>): OfficialPlayer {
  return {
    first_name: overrides.web_name,
    second_name: 'Test',
    team: 1,
    total_points: 0,
    points_per_game: '0',
    form: '0',
    minutes: 0,
    starts: 0,
    goals_scored: 0,
    assists: 0,
    clean_sheets: 0,
    bonus: 0,
    defensive_contribution: 0,
    expected_goals: '0',
    expected_assists: '0',
    expected_goal_involvements: '0',
    selected_by_percent: '0',
    transfers_in_event: 0,
    transfers_out_event: 0,
    status: 'a',
    news: '',
    news_added: null,
    chance_of_playing_next_round: null,
    can_select: true,
    removed: false,
    ...overrides,
  };
}

const live = (event: number, id: number, minutes: number, points: number, xg = 0, xa = 0): EventLive => ({
  event,
  elements: [{
    id,
    stats: {
      minutes,
      total_points: points,
      goals_scored: 0,
      assists: 0,
      clean_sheets: 0,
      bonus: 0,
      defensive_contribution: 10,
      expected_goals: String(xg),
      expected_assists: String(xa),
    },
  }],
});

function monitored(overrides: Partial<MonitoredPlayer> & Pick<MonitoredPlayer, 'id' | 'name' | 'position' | 'price'>): MonitoredPlayer {
  const window = {
    gameweeks: 5,
    appearances: 5,
    startEquivalents: 5,
    minutes: 450,
    points: 20,
    pointsPerAppearance: 4,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    bonus: 0,
    defensiveContribution: 30,
    expectedGoals: 1,
    expectedAssists: 1,
    expectedGoalInvolvements: 2,
    expectedGoalInvolvementsPer90: 0.4,
  };
  return {
    club: 'Test FC',
    clubShort: 'TST',
    totalPoints: 20,
    seasonPointsPerGame: 4,
    seasonMinutes: 630,
    seasonStarts: 7,
    ownership: 1,
    transferBalance: 0,
    status: 'a',
    news: '',
    chanceOfPlaying: null,
    eligible: true,
    owned: false,
    purchasePrice: null,
    sellingPrice: null,
    rolling1: { ...window, gameweeks: 1, appearances: 1, startEquivalents: 1, minutes: 90, points: 4 },
    rolling3: { ...window, gameweeks: 3, appearances: 3, startEquivalents: 3, minutes: 270, points: 12 },
    rolling5: window,
    minutesTrend: 0,
    returnOverperformance: 0,
    nextFixtures: [],
    signalScore: 60,
    valueSignal: 10,
    globalRank: 30,
    positionRank: 10,
    ...overrides,
  };
}

describe('Phase 1 owner ledger', () => {
  it('keeps a proposal separate from confirmed state', () => {
    const ledger = structuredClone(DEFAULT_OWNER_LEDGER);
    const players = [
      officialPlayer({ id: 426, web_name: 'B.Fernandes', element_type: 3, now_cost: 118 }),
      officialPlayer({ id: 40, web_name: 'Rogers', element_type: 3, now_cost: 80 }),
    ];
    const proposal = createTransferProposal({ ledger, players, outElementId: 426, inElementId: 40, gameweek: 8, now: new Date('2026-10-23T12:00:00Z') });
    expect(proposal.projectedBank).toBe(4.7);
    expect(proposal.projectedHitCost).toBe(0);
    expect(ledger.squad.some((player) => player.elementId === 426)).toBe(true);
    expect(ledger.squad.some((player) => player.elementId === 40)).toBe(false);
  });

  it('changes only a cloned ledger after explicit confirmation', () => {
    const ledger = structuredClone(DEFAULT_OWNER_LEDGER);
    const players = [
      officialPlayer({ id: 426, web_name: 'B.Fernandes', element_type: 3, now_cost: 118 }),
      officialPlayer({ id: 40, web_name: 'Rogers', element_type: 3, now_cost: 80 }),
    ];
    const proposal = createTransferProposal({ ledger, players, outElementId: 426, inElementId: 40, gameweek: 8 });
    const confirmed = confirmTransfer({ ledger, proposal, players, confirmation: { confirmed: true, reference: 'User explicitly confirmed in conversation', confirmedAt: '2026-10-23T17:00:00Z' } });
    expect(confirmed.squad.some((player) => player.elementId === 40)).toBe(true);
    expect(confirmed.squad.some((player) => player.elementId === 426)).toBe(false);
    expect(confirmed.bank).toBe(4.7);
    expect(confirmed.confirmedTransfers).toHaveLength(1);
    expect(ledger.squad.some((player) => player.elementId === 426)).toBe(true);
  });
});

describe('Phase 1 rolling features', () => {
  it('uses the latest requested Gameweeks for the whole-player event feed', () => {
    const events = [
      live(1, 10, 90, 2, 0.1, 0.1),
      live(2, 10, 45, 1, 0.2, 0),
      live(3, 10, 90, 8, 0.8, 0.3),
      live(4, 10, 0, 0),
      live(5, 10, 90, 6, 0.4, 0.2),
    ];
    const result = calculateRollingWindow(10, events, 3);
    expect(result.minutes).toBe(180);
    expect(result.appearances).toBe(2);
    expect(result.startEquivalents).toBe(2);
    expect(result.points).toBe(14);
    expect(result.expectedGoalInvolvements).toBe(1.7);
  });

  it('keeps an unavailable owned player in the monitored pool', () => {
    const unavailable = officialPlayer({ id: 441, web_name: 'Obi', element_type: 4, now_cost: 45, status: 'u', can_select: false, removed: true });
    const records = buildMonitoredPlayers({
      bootstrap: {
        events: [],
        teams: [{ id: 1, name: 'Test FC', short_name: 'TST' }],
        elements: [unavailable],
      },
      fixtures: [],
      eventLives: [],
      ledger: DEFAULT_OWNER_LEDGER,
      nextGameweek: 9,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 441, owned: true, eligible: false });
  });
});

describe('Phase 1 changes and proactive alerts', () => {
  it('flags a full-pool rank move without waiting for a player name prompt', () => {
    const oldPlayer = monitored({ id: 20, name: 'Mover', position: 'MID', price: 6, globalRank: 45, signalScore: 55 });
    const newPlayer = monitored({ id: 20, name: 'Mover', position: 'MID', price: 6, globalRank: 15, signalScore: 68 });
    const previous = { players: [oldPlayer] } as PhaseOneSnapshot;
    const changes = detectChanges(previous, [newPlayer]);
    expect(changes.some((change) => change.kind === 'rank_rising')).toBe(true);
    expect(changes.some((change) => change.kind === 'signal_rising')).toBe(true);
  });

  it('raises dead-slot and premium-underperformance alerts automatically', () => {
    const dead = monitored({ id: 441, name: 'Obi', position: 'FWD', price: 4.5, owned: true, purchasePrice: 4.5, sellingPrice: 4.5, eligible: false, status: 'u', signalScore: 0, rolling5: { ...monitored({ id: 1, name: 'x', position: 'FWD', price: 4.5 }).rolling5, appearances: 0, minutes: 0, points: 0, pointsPerAppearance: 0 } });
    const premium = monitored({ id: 426, name: 'B.Fernandes', position: 'MID', price: 11.8, owned: true, purchasePrice: 12, sellingPrice: 11.8, signalScore: 42, rolling5: { ...monitored({ id: 2, name: 'x', position: 'MID', price: 5 }).rolling5, points: 8, pointsPerAppearance: 1.6 } });
    const replacement = monitored({ id: 40, name: 'Rogers', position: 'MID', price: 8, signalScore: 76, valueSignal: 9.5, globalRank: 4, positionRank: 2 });
    const alerts = generateProactiveAlerts({ players: [dead, premium, replacement], ledger: DEFAULT_OWNER_LEDGER, changes: [] });
    expect(alerts.some((alert) => alert.kind === 'mandatory_sell' && alert.playerName === 'Obi')).toBe(true);
    expect(alerts.some((alert) => alert.kind === 'premium_underperformer' && alert.playerName === 'B.Fernandes')).toBe(true);
    expect(alerts.some((alert) => alert.kind === 'replacement_edge' && alert.replacementName === 'Rogers')).toBe(true);
  });
});
