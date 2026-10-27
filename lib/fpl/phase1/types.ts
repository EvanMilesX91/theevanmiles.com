export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface OfficialEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
}

export interface OfficialTeam {
  id: number;
  name: string;
  short_name: string;
  strength?: number;
  strength_attack_home?: number;
  strength_attack_away?: number;
  strength_defence_home?: number;
  strength_defence_away?: number;
}

export interface OfficialPlayer {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
  element_type: number;
  now_cost: number;
  total_points: number;
  points_per_game: string;
  form: string;
  minutes: number;
  starts: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  defensive_contribution: number;
  saves?: number;
  yellow_cards?: number;
  red_cards?: number;
  own_goals?: number;
  penalties_saved?: number;
  penalties_missed?: number;
  goals_conceded?: number;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded?: string;
  ict_index?: string;
  penalties_order?: number | null;
  direct_freekicks_order?: number | null;
  corners_and_indirect_freekicks_order?: number | null;
  selected_by_percent: string;
  transfers_in_event: number;
  transfers_out_event: number;
  status: string;
  news: string;
  news_added: string | null;
  chance_of_playing_next_round: number | null;
  can_select?: boolean;
  removed?: boolean;
}

export interface OfficialBootstrap {
  events: OfficialEvent[];
  teams: OfficialTeam[];
  elements: OfficialPlayer[];
}

export interface OfficialFixture {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  finished: boolean;
  team_h_score?: number | null;
  team_a_score?: number | null;
}

export interface LiveStats {
  minutes: number;
  total_points: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  defensive_contribution: number;
  saves?: number;
  yellow_cards?: number;
  red_cards?: number;
  own_goals?: number;
  penalties_saved?: number;
  penalties_missed?: number;
  goals_conceded?: number;
  expected_goals: string;
  expected_assists: string;
}

export interface EventLive {
  event: number;
  elements: Array<{ id: number; stats: LiveStats }>;
}

export interface LedgerPlayer {
  elementId: number;
  purchasePrice: number;
  acquiredGameweek: number;
}

export interface ConfirmedTransfer {
  id: string;
  gameweek: number;
  outElementId: number;
  inElementId: number;
  sellPrice: number;
  buyPrice: number;
  hitCost: number;
  confirmedAt: string;
  confirmationReference: string;
}

export interface ConfirmedGameweek {
  gameweek: number;
  points: number;
  starterIds: number[];
  benchIds: number[];
  captainId: number;
  viceCaptainId: number;
  confirmedAt: string;
  confirmationReference: string;
}

export interface SquadLedger {
  schemaVersion: 1;
  managerName: string;
  teamName: string;
  lastConfirmedGameweek: number;
  nextGameweek: number;
  bank: number;
  freeTransfers: number;
  squad: LedgerPlayer[];
  lastConfirmedXi: number[];
  captainId: number | null;
  viceCaptainId: number | null;
  chips: Record<string, 'available' | 'used' | 'unknown'>;
  confirmedTransfers: ConfirmedTransfer[];
  confirmedGameweeks: ConfirmedGameweek[];
  updatedAt: string;
}

export interface TransferProposal {
  id: string;
  gameweek: number;
  outElementId: number;
  inElementId: number;
  projectedBank: number;
  projectedHitCost: number;
  createdAt: string;
  status: 'proposed';
}

export interface RollingWindow {
  gameweeks: number;
  appearances: number;
  startEquivalents: number;
  minutes: number;
  points: number;
  pointsPerAppearance: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  defensiveContribution: number;
  expectedGoals: number;
  expectedAssists: number;
  expectedGoalInvolvements: number;
  expectedGoalInvolvementsPer90: number;
}

export interface UpcomingFixture {
  gameweek: number;
  opponent: string;
  home: boolean;
  difficulty: number;
}

export interface MonitoredPlayer {
  id: number;
  name: string;
  club: string;
  clubShort: string;
  position: Position;
  price: number;
  totalPoints: number;
  seasonPointsPerGame: number;
  seasonMinutes: number;
  seasonStarts: number;
  ownership: number;
  transferBalance: number;
  status: string;
  news: string;
  chanceOfPlaying: number | null;
  eligible: boolean;
  owned: boolean;
  purchasePrice: number | null;
  sellingPrice: number | null;
  rolling1: RollingWindow;
  rolling3: RollingWindow;
  rolling5: RollingWindow;
  minutesTrend: number;
  returnOverperformance: number;
  nextFixtures: UpcomingFixture[];
  signalScore: number;
  valueSignal: number;
  globalRank: number;
  positionRank: number;
}

export type ChangeKind =
  | 'price_rise'
  | 'price_fall'
  | 'availability_improved'
  | 'availability_worsened'
  | 'news_changed'
  | 'minutes_rising'
  | 'minutes_falling'
  | 'signal_rising'
  | 'signal_falling'
  | 'rank_rising'
  | 'rank_falling'
  | 'new_player';

export interface PlayerChange {
  playerId: number;
  playerName: string;
  kind: ChangeKind;
  importance: number;
  fact: string;
  interpretation: string;
}

export type AlertKind =
  | 'mandatory_sell'
  | 'premium_underperformer'
  | 'minutes_risk'
  | 'replacement_edge'
  | 'buy_watch'
  | 'price_risk'
  | 'structural_warning';

export interface ProactiveAlert {
  kind: AlertKind;
  severity: 'critical' | 'high' | 'medium' | 'low';
  playerId: number | null;
  playerName: string | null;
  replacementId: number | null;
  replacementName: string | null;
  confidence: number;
  reason: string;
  evidence: string[];
}

export interface SourceHealth {
  key: string;
  status: 'healthy' | 'degraded' | 'failed';
  retrievedAt: string;
  records: number;
  message: string;
}

export interface PhaseOneSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  currentGameweek: number;
  nextGameweek: number;
  sourceHealth: SourceHealth[];
  ledger: SquadLedger;
  players: MonitoredPlayer[];
  changes: PlayerChange[];
  alerts: ProactiveAlert[];
  structuralDebt: {
    score: number;
    deadSlots: number;
    premiumUnderperformers: number;
    unreliableOwnedPlayers: number;
    reasons: string[];
  };
}
