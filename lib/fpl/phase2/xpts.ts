import type { MonitoredPlayer, OfficialPlayer, OfficialTeam } from '../phase1';
import type { FixtureProjection, MinutesProjection, PlayerProjection, RoleAssessment, SustainablePerformance, TeamRating } from './types';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface ProjectionInput {
  player: MonitoredPlayer;
  official: OfficialPlayer;
  officialTeams: OfficialTeam[];
  teamRatings: TeamRating[];
  minutes: MinutesProjection;
  role: RoleAssessment;
  sustainability: SustainablePerformance;
  nextGameweek: number;
}

export function projectPlayer(input: ProjectionInput): PlayerProjection {
  const { player, official, officialTeams, teamRatings, minutes, role, sustainability, nextGameweek } = input;
  const own = teamRatings.find((team) => team.team === player.club);
  const goalPoints = player.position === 'FWD' ? 4 : player.position === 'MID' ? 5 : 6;
  const seasonMinutes = Math.max(1, official.minutes);
  const saves90 = (official.saves ?? 0) * 90 / seasonMinutes;
  const cards90 = ((official.yellow_cards ?? 0) + (official.red_cards ?? 0) * 3 + (official.own_goals ?? 0) * 2 + (official.penalties_missed ?? 0) * 2) * 90 / seasonMinutes;
  const fixtures = player.nextFixtures.map((fixture): FixtureProjection => {
    const opponentTeam = officialTeams.find((team) => team.name === fixture.opponent);
    const opponent = teamRatings.find((team) => team.teamId === opponentTeam?.id || team.teamShort === fixture.opponent || team.team === fixture.opponent);
    const isNextFixture = fixture.gameweek === nextGameweek;
    const expectedMinutes = isNextFixture ? minutes.expectedMinutesPerFixture : (minutes.futureExpectedMinutesPerFixture ?? minutes.expectedMinutesPerFixture);
    const startProbability = isNextFixture ? minutes.startProbability : (minutes.futureStartProbability ?? minutes.startProbability);
    const appearanceProbability = isNextFixture ? minutes.appearanceProbability : (minutes.futureAppearanceProbability ?? minutes.appearanceProbability);
    const minScale = expectedMinutes / 90;
    const attackMultiplier = fixture.home ? (opponent?.defenceAway ?? 1) : (opponent?.defenceHome ?? 1);
    const ownAttack = fixture.home ? (own?.attackHome ?? 1) : (own?.attackAway ?? 1);
    const appearance = appearanceProbability + startProbability;
    const goals = sustainability.expectedGoalsPer90 * minScale * goalPoints * clamp(attackMultiplier * ownAttack, 0.55, 1.65);
    const assists = sustainability.expectedAssistsPer90 * minScale * 3 * clamp(attackMultiplier * ownAttack, 0.6, 1.55);
    const opponentAttack = fixture.home ? (opponent?.attackAway ?? 1) : (opponent?.attackHome ?? 1);
    const ownDefence = fixture.home ? (own?.defenceHome ?? 1) : (own?.defenceAway ?? 1);
    const expectedGoalsAgainst = 1.35 * clamp(opponentAttack * ownDefence, 0.55, 1.8);
    const cleanProbability = Math.exp(-expectedGoalsAgainst) * startProbability;
    const cleanValue = player.position === 'GK' || player.position === 'DEF' ? 4 : player.position === 'MID' ? 1 : 0;
    const cleanSheet = cleanProbability * cleanValue;
    const saves = player.position === 'GK' ? saves90 * minScale / 3 : 0;
    const defensiveContribution = sustainability.defensiveContributionPointsPer90 * minScale;
    const bonus = sustainability.regressedBonusPer90 * minScale * clamp(0.85 + (goals + assists) / 4, 0.75, 1.4);
    const discipline = -cards90 * minScale;
    const xPts = Math.max(0, appearance + goals + assists + cleanSheet + saves + defensiveContribution + bonus + discipline);
    const uncertainty = clamp((1 - startProbability) * 2.2 + (100 - Math.min(minutes.confidence, sustainability.confidence, own?.confidence ?? 50)) / 35 + 0.8, 1.2, 4.5);
    const floor = Math.max(0, xPts - uncertainty);
    const ceiling = xPts + uncertainty + Math.min(2.5, goals + assists);
    return {
      gameweek: fixture.gameweek, opponent: fixture.opponent, home: fixture.home, expectedMinutes: round(expectedMinutes), xPts: round(xPts), floor: round(floor), ceiling: round(ceiling),
      components: { appearance: round(appearance), goals: round(goals), assists: round(assists), cleanSheet: round(cleanSheet), saves: round(saves), defensiveContribution: round(defensiveContribution), bonus: round(bonus), discipline: round(discipline) },
      explanation: `${round(expectedMinutes)} expected minutes; ${fixture.home ? 'home' : 'away'} to ${fixture.opponent}; opponent-adjusted attack and clean-sheet probabilities applied.`,
    };
  });
  const sum = (gameweeks: number, key: 'xPts' | 'floor' | 'ceiling') => round(fixtures
    .filter((fixture) => fixture.gameweek >= nextGameweek && fixture.gameweek < nextGameweek + gameweeks)
    .reduce((total, fixture) => total + fixture[key], 0));
  const confidence = Math.round(clamp(minutes.confidence * 0.45 + sustainability.confidence * 0.3 + (own?.confidence ?? 45) * 0.2 + (role.change === 'insufficient_data' ? 25 : role.confidence) * 0.05, 20, 92));
  const nextGameweekFixtures = fixtures.filter((fixture) => fixture.gameweek === nextGameweek);
  const first = nextGameweekFixtures[0];
  const oneLineReason = first
    ? `${sum(1, 'xPts')} xPts across ${nextGameweekFixtures.length} GW${nextGameweek} fixture${nextGameweekFixtures.length === 1 ? '' : 's'}: ${minutes.expectedMinutesPerFixture} expected minutes per fixture and ${sustainability.label} returns.`
    : `No scheduled fixture in GW${nextGameweek}; later fixtures remain in the planning horizon.`;
  return {
    playerId: player.id, playerName: player.name, teamId: official.team, team: player.club, position: player.position, price: player.price, owned: player.owned,
    minutes, role, sustainability, fixtures, xPts1: sum(1, 'xPts'), xPts3: sum(3, 'xPts'), xPts6: sum(6, 'xPts'), floor1: sum(1, 'floor'), ceiling1: sum(1, 'ceiling'), confidence, oneLineReason, shadowLineup: null,
  };
}
