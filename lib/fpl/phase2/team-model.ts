import type { OfficialBootstrap, OfficialFixture, OfficialPlayer } from '../phase1';
import type { AvailabilityObservation, InjuryImpact, TeamRating } from './types';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function availability(player: OfficialPlayer): number {
  if (player.status === 'u' || player.status === 'i' || player.status === 's') return 0;
  if (player.chance_of_playing_next_round !== null) return player.chance_of_playing_next_round / 100;
  return player.status === 'd' ? 0.5 : 1;
}

export function calculateInjuryImpacts(bootstrap: OfficialBootstrap, independent: AvailabilityObservation[] = [], now = new Date()): InjuryImpact[] {
  const teamMinutes = new Map<number, number>();
  const independentById = new Map(independent.filter((item) => !item.returnDate || new Date(item.returnDate).getTime() > now.getTime()).map((item) => [item.playerId, item]));
  for (const player of bootstrap.elements) teamMinutes.set(player.team, (teamMinutes.get(player.team) ?? 0) + player.minutes);
  return bootstrap.elements.flatMap((player): InjuryImpact[] => {
    const independentFlag = independentById.get(player.id);
    const officialAvailability = availability(player);
    const available = officialAvailability < 0.99 ? officialAvailability : independentFlag ? (independentFlag.status === 'suspension' ? 0.65 : independentFlag.status === 'injury' ? 0.8 : 0.85) : 1;
    if (available >= 0.99 || player.removed || player.can_select === false) return [];
    const minutesShare = player.minutes / Math.max(1, (teamMinutes.get(player.team) ?? 1) / 11);
    const attackingOutput = Number(player.expected_goal_involvements || 0);
    const setPieceWeight = player.penalties_order === 1 ? 0.15 : player.direct_freekicks_order === 1 || player.corners_and_indirect_freekicks_order === 1 ? 0.07 : 0;
    const outputWeight = Math.min(0.4, attackingOutput / 8);
    const importance = Math.min(1, minutesShare * 0.5 + outputWeight + setPieceWeight);
    const lost = 1 - available;
    const attackRole = player.element_type >= 3 ? 1 : 0.35;
    const defenceRole = player.element_type <= 2 ? 1 : 0.2;
    const attackReduction = Math.min(0.08, importance * lost * 0.08 * attackRole);
    const defenceWeakening = Math.min(0.08, importance * lost * 0.08 * defenceRole);
    if (importance < 0.05) return [];
    return [{
      playerId: player.id, playerName: player.web_name, teamId: player.team, availability: round(available), importance: round(importance),
      attackReduction: round(attackReduction, 3), defenceWeakening: round(defenceWeakening, 3),
      fact: officialAvailability < 0.99
        ? `${player.web_name} is ${player.status === 'd' ? 'flagged as doubtful' : 'officially unavailable'}${player.news ? `: ${player.news}` : '.'}`
        : `${player.web_name} has an independent availability flag from ${independentFlag?.source}: ${independentFlag?.reason ?? 'unknown issue'}. Effect is capped pending official confirmation.`,
      modelEffect: `Estimated team attack -${round(attackReduction * 100, 1)}%; expected goals conceded +${round(defenceWeakening * 100, 1)}%.`,
    }];
  });
}

export function buildTeamRatings(bootstrap: OfficialBootstrap, fixtures: OfficialFixture[], impacts: InjuryImpact[]): TeamRating[] {
  const finished = fixtures.filter((fixture) => fixture.finished && fixture.team_h_score != null && fixture.team_a_score != null).sort((a, b) => (a.event ?? 0) - (b.event ?? 0));
  const leagueGoals = finished.reduce((sum, fixture) => sum + fixture.team_h_score! + fixture.team_a_score!, 0);
  const leaguePerTeamMatch = leagueGoals / Math.max(1, finished.length * 2);
  const strengthValues = bootstrap.teams.flatMap((team) => [team.strength_attack_home, team.strength_attack_away, team.strength_defence_home, team.strength_defence_away]).filter((value): value is number => Number.isFinite(value));
  const strengthMean = strengthValues.reduce((sum, value) => sum + value, 0) / Math.max(1, strengthValues.length);
  return bootstrap.teams.map((team): TeamRating => {
    const matches = finished.filter((fixture) => fixture.team_h === team.id || fixture.team_a === team.id);
    const values = matches.map((fixture) => fixture.team_h === team.id
      ? { gf: fixture.team_h_score!, ga: fixture.team_a_score!, home: true }
      : { gf: fixture.team_a_score!, ga: fixture.team_h_score!, home: false });
    const recent = values.slice(-5);
    const home = values.filter((value) => value.home);
    const away = values.filter((value) => !value.home);
    const avg = (rows: typeof values, key: 'gf' | 'ga') => rows.reduce((sum, row) => sum + row[key], 0) / Math.max(1, rows.length);
    const shrink = (observed: number, sample: number) => (observed * sample + leaguePerTeamMatch * 5) / (sample + 5);
    const official = (value: number | undefined, inverse = false) => {
      const normal = (value ?? strengthMean) / Math.max(1, strengthMean);
      return inverse ? 1 / Math.max(0.5, normal) : normal;
    };
    const attackHome = shrink(avg(home, 'gf'), home.length) / Math.max(0.5, leaguePerTeamMatch) * 0.7 + official(team.strength_attack_home) * 0.3;
    const attackAway = shrink(avg(away, 'gf'), away.length) / Math.max(0.5, leaguePerTeamMatch) * 0.7 + official(team.strength_attack_away) * 0.3;
    const defenceHome = shrink(avg(home, 'ga'), home.length) / Math.max(0.5, leaguePerTeamMatch) * 0.7 + official(team.strength_defence_home, true) * 0.3;
    const defenceAway = shrink(avg(away, 'ga'), away.length) / Math.max(0.5, leaguePerTeamMatch) * 0.7 + official(team.strength_defence_away, true) * 0.3;
    const teamImpacts = impacts.filter((impact) => impact.teamId === team.id);
    const attackInjuryMultiplier = Math.max(0.85, 1 - teamImpacts.reduce((sum, impact) => sum + impact.attackReduction, 0));
    const defenceInjuryMultiplier = Math.min(1.15, 1 + teamImpacts.reduce((sum, impact) => sum + impact.defenceWeakening, 0));
    return {
      teamId: team.id, team: team.name, teamShort: team.short_name, matches: matches.length,
      goalsForPerMatch: round(avg(values, 'gf')), goalsAgainstPerMatch: round(avg(values, 'ga')),
      recentGoalsForPerMatch: round(avg(recent, 'gf')), recentGoalsAgainstPerMatch: round(avg(recent, 'ga')),
      attackHome: round(attackHome * attackInjuryMultiplier, 3), attackAway: round(attackAway * attackInjuryMultiplier, 3),
      defenceHome: round(defenceHome * defenceInjuryMultiplier, 3), defenceAway: round(defenceAway * defenceInjuryMultiplier, 3),
      attackInjuryMultiplier: round(attackInjuryMultiplier, 3), defenceInjuryMultiplier: round(defenceInjuryMultiplier, 3),
      confidence: Math.round(Math.min(90, 35 + matches.length * 5)),
    };
  });
}
