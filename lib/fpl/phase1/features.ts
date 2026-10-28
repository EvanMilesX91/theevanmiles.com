import type {
  EventLive,
  LiveStats,
  MonitoredPlayer,
  OfficialBootstrap,
  OfficialFixture,
  Position,
  RollingWindow,
  SquadLedger,
  UpcomingFixture,
} from './types';
import { calculateSellingPrice } from './ledger';

const POSITION_BY_TYPE: Record<number, Position> = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POSITION_PRIOR: Record<Position, number> = { GK: 3.4, DEF: 3.5, MID: 4.0, FWD: 4.2 };

const asNumber = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const emptyStats = (): LiveStats => ({
  minutes: 0,
  total_points: 0,
  goals_scored: 0,
  assists: 0,
  clean_sheets: 0,
  bonus: 0,
  defensive_contribution: 0,
  expected_goals: '0',
  expected_assists: '0',
});

export function calculateRollingWindow(playerId: number, eventLives: EventLive[], gameweeks: number): RollingWindow {
  const selected = [...eventLives].sort((a, b) => a.event - b.event).slice(-gameweeks);
  const stats = selected.map((event) => event.elements.find((element) => element.id === playerId)?.stats ?? emptyStats());
  const minutes = stats.reduce((sum, item) => sum + item.minutes, 0);
  const appearances = stats.filter((item) => item.minutes > 0).length;
  const points = stats.reduce((sum, item) => sum + item.total_points, 0);
  const expectedGoals = stats.reduce((sum, item) => sum + asNumber(item.expected_goals), 0);
  const expectedAssists = stats.reduce((sum, item) => sum + asNumber(item.expected_assists), 0);
  const expectedGoalInvolvements = expectedGoals + expectedAssists;
  return {
    gameweeks,
    appearances,
    startEquivalents: stats.filter((item) => item.minutes >= 60).length,
    minutes,
    points,
    pointsPerAppearance: appearances ? round(points / appearances) : 0,
    goals: stats.reduce((sum, item) => sum + item.goals_scored, 0),
    assists: stats.reduce((sum, item) => sum + item.assists, 0),
    cleanSheets: stats.reduce((sum, item) => sum + item.clean_sheets, 0),
    bonus: stats.reduce((sum, item) => sum + item.bonus, 0),
    defensiveContribution: stats.reduce((sum, item) => sum + item.defensive_contribution, 0),
    expectedGoals: round(expectedGoals),
    expectedAssists: round(expectedAssists),
    expectedGoalInvolvements: round(expectedGoalInvolvements),
    expectedGoalInvolvementsPer90: minutes ? round((expectedGoalInvolvements * 90) / minutes) : 0,
  };
}

function upcomingFixturesFor(
  teamId: number,
  fixtures: OfficialFixture[],
  teams: Map<number, { short_name: string }>,
  nextGameweek: number,
): UpcomingFixture[] {
  return fixtures
    .filter((fixture) => !fixture.finished && fixture.event !== null && fixture.event >= nextGameweek && (fixture.team_h === teamId || fixture.team_a === teamId))
    .sort((a, b) => (a.event ?? 99) - (b.event ?? 99))
    .map((fixture) => {
      const home = fixture.team_h === teamId;
      const opponentId = home ? fixture.team_a : fixture.team_h;
      return {
        gameweek: fixture.event ?? nextGameweek,
        opponent: teams.get(opponentId)?.short_name ?? `Team ${opponentId}`,
        home,
        difficulty: home ? fixture.team_h_difficulty : fixture.team_a_difficulty,
      };
    });
}

function calculateSignal(args: {
  position: Position;
  seasonPpg: number;
  rolling3: RollingWindow;
  rolling5: RollingWindow;
  status: string;
  chanceOfPlaying: number | null;
  fixtures: UpcomingFixture[];
}): number {
  const availability = args.status === 'a' ? 1 : args.status === 'd' ? (args.chanceOfPlaying ?? 50) / 100 : 0;
  const minutesSecurity = clamp(args.rolling3.minutes / 270, 0, 1);
  const recentPpg = args.rolling5.appearances ? args.rolling5.pointsPerAppearance : POSITION_PRIOR[args.position] * 0.45;
  const regressedPpg = recentPpg * 0.45 + args.seasonPpg * 0.35 + POSITION_PRIOR[args.position] * 0.2;
  const attack = clamp(args.rolling5.expectedGoalInvolvementsPer90 / 0.7, 0, 1);
  const dcPerAppearance = args.rolling5.appearances ? args.rolling5.defensiveContribution / args.rolling5.appearances : 0;
  const defensiveRoute = clamp(dcPerAppearance / (args.position === 'MID' ? 12 : 10), 0, 1);
  const fixtureAverage = args.fixtures.slice(0, 3).reduce((sum, fixture) => sum + fixture.difficulty, 0) / Math.max(1, Math.min(3, args.fixtures.length));
  const fixtureScore = clamp((5.5 - fixtureAverage) / 4, 0, 1);
  return round(clamp(
    availability * 20 + minutesSecurity * 22 + clamp(regressedPpg / 8, 0, 1) * 30 + attack * 14 + defensiveRoute * 6 + fixtureScore * 8,
    0,
    100,
  ), 1);
}

export function buildMonitoredPlayers(args: {
  bootstrap: OfficialBootstrap;
  fixtures: OfficialFixture[];
  eventLives: EventLive[];
  ledger: SquadLedger;
  nextGameweek: number;
}): MonitoredPlayer[] {
  const teams = new Map(args.bootstrap.teams.map((team) => [team.id, team]));
  const owned = new Map(args.ledger.squad.map((player) => [player.elementId, player]));
  const records = args.bootstrap.elements
    .filter((player) => owned.has(player.id) || (player.can_select !== false && !player.removed))
    .map((player): MonitoredPlayer => {
      const position = POSITION_BY_TYPE[player.element_type];
      const rolling1 = calculateRollingWindow(player.id, args.eventLives, 1);
      const rolling3 = calculateRollingWindow(player.id, args.eventLives, 3);
      const rolling5 = calculateRollingWindow(player.id, args.eventLives, 5);
      const priorTwoMinutes = Math.max(0, rolling5.minutes - rolling3.minutes) / 2;
      const recentMinutes = rolling3.minutes / 3;
      const ledgerPlayer = owned.get(player.id);
      const price = player.now_cost / 10;
      const nextFixtures = upcomingFixturesFor(player.team, args.fixtures, teams, args.nextGameweek);
      const signalScore = calculateSignal({
        position,
        seasonPpg: asNumber(player.points_per_game),
        rolling3,
        rolling5,
        status: player.status,
        chanceOfPlaying: player.chance_of_playing_next_round,
        fixtures: nextFixtures,
      });
      const observedReturns = rolling5.goals + rolling5.assists;
      return {
        id: player.id,
        name: player.web_name,
        club: teams.get(player.team)?.name ?? `Team ${player.team}`,
        clubShort: teams.get(player.team)?.short_name ?? String(player.team),
        position,
        price,
        totalPoints: player.total_points,
        seasonPointsPerGame: asNumber(player.points_per_game),
        seasonMinutes: player.minutes,
        seasonStarts: player.starts,
        ownership: asNumber(player.selected_by_percent),
        transferBalance: player.transfers_in_event - player.transfers_out_event,
        status: player.status,
        news: player.news,
        chanceOfPlaying: player.chance_of_playing_next_round,
        eligible: player.status !== 'u' && player.can_select !== false && !player.removed,
        owned: Boolean(ledgerPlayer),
        purchasePrice: ledgerPlayer?.purchasePrice ?? null,
        sellingPrice: ledgerPlayer ? calculateSellingPrice(ledgerPlayer.purchasePrice, price) : null,
        rolling1,
        rolling3,
        rolling5,
        minutesTrend: round(recentMinutes - priorTwoMinutes, 1),
        returnOverperformance: round(observedReturns - rolling5.expectedGoalInvolvements),
        nextFixtures,
        signalScore,
        valueSignal: round(signalScore / Math.max(price, 3.5), 2),
        globalRank: 0,
        positionRank: 0,
      };
    });

  const byGlobal = [...records].sort((a, b) => b.signalScore - a.signalScore || b.valueSignal - a.valueSignal);
  byGlobal.forEach((player, index) => { player.globalRank = index + 1; });
  for (const position of Object.values(POSITION_BY_TYPE)) {
    [...records].filter((player) => player.position === position).sort((a, b) => b.signalScore - a.signalScore).forEach((player, index) => {
      player.positionRank = index + 1;
    });
  }
  return records.sort((a, b) => a.globalRank - b.globalRank);
}
