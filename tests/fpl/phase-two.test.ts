import { describe, expect, it } from 'vitest';
import type { MonitoredPlayer, OfficialBootstrap, OfficialFixture, OfficialPlayer } from '@/lib/fpl/phase1';
import { assessRole, assessSustainability, buildTeamRatings, calculateInjuryImpacts, parseForwardMinutes, parseLiveScoreLineup, parseLiveScoreResults, parseLiveScoreTeamRefs, parseShadowLineups, projectMinutes, projectPlayer } from '@/lib/fpl/phase2';
import type { TeamRating } from '@/lib/fpl/phase2';

const window = { gameweeks: 5, appearances: 5, startEquivalents: 5, minutes: 430, points: 25, pointsPerAppearance: 5, goals: 2, assists: 1, cleanSheets: 1, bonus: 3, defensiveContribution: 25, expectedGoals: 1.8, expectedAssists: 0.8, expectedGoalInvolvements: 2.6, expectedGoalInvolvementsPer90: 0.54 };

function monitored(overrides: Partial<MonitoredPlayer> = {}): MonitoredPlayer {
  return { id: 1, name: 'Tester', club: 'Alpha', clubShort: 'ALP', position: 'DEF', price: 5, totalPoints: 25, seasonPointsPerGame: 5, seasonMinutes: 430, seasonStarts: 5, ownership: 1, transferBalance: 0, status: 'a', news: '', chanceOfPlaying: null, eligible: true, owned: false, purchasePrice: null, sellingPrice: null, rolling1: { ...window, gameweeks: 1, appearances: 1, startEquivalents: 1, minutes: 85, points: 6 }, rolling3: { ...window, gameweeks: 3, appearances: 3, startEquivalents: 3, minutes: 255, points: 15 }, rolling5: window, minutesTrend: 0, returnOverperformance: 0, nextFixtures: [{ gameweek: 8, opponent: 'Beta', home: true, difficulty: 2 }], signalScore: 50, valueSignal: 10, globalRank: 1, positionRank: 1, ...overrides };
}

function official(overrides: Partial<OfficialPlayer> = {}): OfficialPlayer {
  return { id: 1, first_name: 'Test', second_name: 'Player', web_name: 'Tester', team: 1, element_type: 2, now_cost: 50, total_points: 25, points_per_game: '5', form: '5', minutes: 430, starts: 5, goals_scored: 2, assists: 1, clean_sheets: 1, bonus: 3, defensive_contribution: 25, expected_goals: '1.8', expected_assists: '0.8', expected_goal_involvements: '2.6', selected_by_percent: '1', transfers_in_event: 0, transfers_out_event: 0, status: 'a', news: '', news_added: null, chance_of_playing_next_round: null, ...overrides };
}

describe('Phase 2 modelling', () => {
  it('requires repeat lineup evidence before confirming an out-of-position role', () => {
    const observations = [4, 5].map((gameweek) => ({ playerId: 1, gameweek, fixtureId: gameweek, teamId: 1, formation: '4-3-3', status: 'starter' as const, actualPosition: 'MID', grid: '4:1', confidence: 95, source: 'confirmed', sourceUrl: null, retrievedAt: '2026-10-01T00:00:00Z' }));
    const result = assessRole(monitored(), observations, 6);
    expect(result.change).toBe('confirmed');
    expect(result.tacticalRole).toBe('advanced');
  });

  it('sets expected minutes to zero for an unavailable player', () => {
    const result = projectMinutes(monitored(), official({ status: 'i', news: 'Hamstring injury' }), { listedPosition: 'DEF', tacticalRole: 'unknown', change: 'insufficient_data', confidence: 15, observations: 0, latestGameweek: null, evidence: [] }, 6);
    expect(result.expectedMinutes1).toBe(0);
    expect(result.appearanceProbability).toBe(0);
    expect(result.rotationRisk).toBe('unavailable');
  });

  it('blends a fresh independent minutes benchmark without letting it dominate', () => {
    const role = { listedPosition: 'DEF' as const, tacticalRole: 'unknown' as const, change: 'insufficient_data' as const, confidence: 15, observations: 0, latestGameweek: null, evidence: [] };
    const internal = projectMinutes(monitored(), official(), role, 6, 8);
    const blended = projectMinutes(monitored(), official(), role, 6, 8, {
      playerId: 1, gameweek: 9, expectedMinutes: 20, playChance: 0.5, projectedPoints: 1.2,
      confidence: 78, computedAt: '2026-10-27T12:00:00Z', source: 'FPL Cat', sourceUrl: 'https://fplcat.com/developers',
    });
    expect(blended.expectedMinutesPerFixture).toBeLessThan(internal.expectedMinutesPerFixture);
    expect(blended.expectedMinutesPerFixture).toBeGreaterThan(20);
    expect(blended.expectedMinutes3).toBeCloseTo(blended.expectedMinutesPerFixture + internal.expectedMinutesPerFixture * 2, 1);
    expect(blended.evidence.join(' ')).toContain('ensemble weight');
  });

  it('rejects a forward benchmark for the wrong Gameweek', () => {
    const parsed = parseForwardMinutes({ gameweek: 8, computed_at: '2026-10-27T12:00:00Z', players: [{ id: 1, xp: 5, expected_minutes: 80, play_chance: 0.95 }] }, 9, new Date('2026-10-27T13:00:00Z'));
    expect(parsed.signals).toEqual([]);
    expect(parsed.health.status).toBe('failed');
    expect(parsed.health.message).toContain('ignored');
  });

  it('separates observed returns from sustainable underlying returns', () => {
    const result = assessSustainability(monitored(), official({ total_points: 70, expected_goals: '0.2', expected_assists: '0.1', bonus: 12 }));
    expect(result.observedPointsPer90).toBeGreaterThan(result.sustainablePointsPer90);
    expect(result.label).toBe('overperforming');
  });

  it('propagates important absences into capped team ratings', () => {
    const teams = [
      { id: 1, name: 'Alpha', short_name: 'ALP', strength_attack_home: 1100, strength_attack_away: 1080, strength_defence_home: 1120, strength_defence_away: 1090 },
      { id: 2, name: 'Beta', short_name: 'BET', strength_attack_home: 1000, strength_attack_away: 980, strength_defence_home: 1000, strength_defence_away: 980 },
    ];
    const star = official({ status: 'i', minutes: 540, expected_goal_involvements: '6', element_type: 3, penalties_order: 1 });
    const bootstrap = { events: [], teams, elements: [star, official({ id: 2, team: 1, minutes: 90 }), official({ id: 3, team: 2, minutes: 540 })] } satisfies OfficialBootstrap;
    const fixtures = [{ id: 1, event: 1, kickoff_time: null, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: true, team_h_score: 2, team_a_score: 0 }] satisfies OfficialFixture[];
    const impacts = calculateInjuryImpacts(bootstrap);
    const alpha = buildTeamRatings(bootstrap, fixtures, impacts).find((team) => team.teamId === 1)!;
    expect(impacts[0].attackReduction).toBeGreaterThan(0);
    expect(alpha.attackInjuryMultiplier).toBeLessThan(1);
    expect(alpha.defenceInjuryMultiplier).toBeLessThanOrEqual(1.15);
  });

  it('turns opponent strength into a fixture-level xPts difference', () => {
    const player = monitored({ position: 'MID', nextFixtures: [
      { gameweek: 8, opponent: 'EAS', home: true, difficulty: 2 },
      { gameweek: 9, opponent: 'HRD', home: true, difficulty: 5 },
    ] });
    const rating = (teamId: number, team: string, teamShort: string, attack: number, defence: number): TeamRating => ({ teamId, team, teamShort, matches: 7, goalsForPerMatch: attack, goalsAgainstPerMatch: defence, recentGoalsForPerMatch: attack, recentGoalsAgainstPerMatch: defence, attackHome: attack, attackAway: attack, defenceHome: defence, defenceAway: defence, attackInjuryMultiplier: 1, defenceInjuryMultiplier: 1, confidence: 75 });
    const role = { listedPosition: 'MID' as const, tacticalRole: 'advanced' as const, change: 'none' as const, confidence: 75, observations: 3, latestGameweek: 7, evidence: [] };
    const minutes = projectMinutes(player, official({ element_type: 3 }), role, 2, 7);
    const sustainability = assessSustainability(player, official({ element_type: 3 }));
    const result = projectPlayer({ player, official: official({ element_type: 3 }), officialTeams: [
      { id: 1, name: 'Alpha', short_name: 'ALP' }, { id: 2, name: 'Easy', short_name: 'EAS' }, { id: 3, name: 'Hard', short_name: 'HRD' },
    ], teamRatings: [rating(1, 'Alpha', 'ALP', 1.1, 0.9), rating(2, 'Easy', 'EAS', 0.7, 1.4), rating(3, 'Hard', 'HRD', 1.4, 0.7)], minutes, role, sustainability });
    expect(result.fixtures[0].xPts).toBeGreaterThan(result.fixtures[1].xPts);
    expect(result.xPts3).toBeCloseTo(result.fixtures[0].xPts + result.fixtures[1].xPts, 1);
  });

  it('parses LiveScore team and result data from its public Next.js payload', () => {
    const html = (initialData: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData } } })}</script>`;
    expect(parseLiveScoreTeamRefs(html({ tables: { league: { overall: [{ teams: [{ id: '42', name: 'Alpha' }] }] } } }))).toEqual([{ id: '42', name: 'Alpha' }]);
    expect(parseLiveScoreResults(html({ results: [{ id: 'event-1', homeTeamName: 'Alpha', awayTeamName: 'Beta' }] }))).toMatchObject([{ id: 'event-1' }]);
  });

  it('maps a confirmed LiveScore lineup into official FPL player observations', () => {
    const bootstrap = {
      events: [],
      teams: [{ id: 1, name: 'Alpha', short_name: 'ALP' }, { id: 2, name: 'Beta', short_name: 'BET' }],
      elements: [official({ id: 10, first_name: 'Test', second_name: 'Player', web_name: 'Player', team: 1 }), official({ id: 11, first_name: 'Injured', second_name: 'Player', web_name: 'Injured', team: 1 })],
    } satisfies OfficialBootstrap;
    const result = parseLiveScoreLineup({
      response: { Lu: [{ Tnb: 1, Fo: [4, 3, 3], Ps: [{ Fn: 'Test', Ln: 'Player', Pon: 'Midfielder', Pos: 1, PosA: 2, Fp: '3:1' }], IS: [{ Fn: 'Injured', Ln: 'Player', Rs: 'Knee injury', Rton: 20261130000000, RtonS: 'Late November' }] }] },
      fixture: { id: 88, event: 8, kickoff_time: null, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: true },
      gameweek: 8,
      eventId: 'event-1',
      homeName: 'Alpha',
      awayName: 'Beta',
      bootstrap,
      retrievedAt: '2026-10-27T00:00:00.000Z',
    });
    expect(result.unresolved).toEqual([]);
    expect(result.observations[0]).toMatchObject({ playerId: 10, gameweek: 8, status: 'starter', actualPosition: 'MID', formation: '4-3-3', confidence: 98 });
    expect(result.availability[0]).toMatchObject({ playerId: 11, status: 'injury', returnDate: '2026-11-30T00:00:00.000Z', returnLabel: 'Late November' });
  });

  it('keeps predicted lineups in shadow mode and surfaces contradictions', () => {
    const bootstrap = { events: [], teams: [{ id: 1, name: 'Alpha', short_name: 'ALP' }], elements: [official({ id: 1, team: 1 }), official({ id: 2, team: 1 })] } satisfies OfficialBootstrap;
    const result = parseShadowLineups({ data: [{ team_id: 1, tactical_confidence_rate: 0.82, last_verified_iso: '2026-10-27 12:00:00 UTC', starters: [{ id: 1, status: 'i' }], bench: [{ id: 2, status: 'a' }] }] }, bootstrap, new Date('2026-10-27T13:00:00Z'));
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0]).toMatchObject({ prediction: 'starter', contradiction: true, confidence: 82 });
    expect(result.health.status).toBe('degraded');
  });
});
