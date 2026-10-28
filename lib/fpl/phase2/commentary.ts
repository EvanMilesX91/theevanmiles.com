import type { FetchLike, OfficialBootstrap, OfficialFixture, OfficialPlayer, SourceHealth } from '../phase1';
import { discoverLiveScoreFixtureEvents, liveScoreSlug } from './livescore';
import type {
  CommentaryObservation,
  CommentarySignalKind,
  LineupObservation,
  PlayerCommentaryInsight,
} from './types';

const COMMENTARY_API = 'https://prod-cdn-commentary-api.lsmedia1.com/v1/api/app';
const COMMENTARY_PAGE = 'https://www.livescore.com/en/football/england/premier-league';

interface LiveScoreComment {
  Min?: number;
  MinEx?: number;
  Txt?: string;
}

export interface LiveScoreCommentaryResponse {
  Eid?: string;
  Lang?: string;
  Els?: { Txt?: string; GenTs?: number };
  Com?: LiveScoreComment[];
}

const signalLabels: Record<CommentarySignalKind, string> = {
  attacking_threat: 'attacking threat',
  creative_involvement: 'creative involvement',
  set_piece_duty: 'set-piece duty',
  defensive_activity: 'defensive activity',
  advanced_role: 'advanced-role evidence',
  availability_context: 'availability concern',
};

const patterns: Record<CommentarySignalKind, RegExp> = {
  attacking_threat: /\b(shot|shoots?|effort|header|chance|saved|blocked|goal|post|crossbar|penalty area|inside the box|in the box)\b/g,
  creative_involvement: /\b(cross|crosses|creates?|through ball|key pass|finds|cut[ -]?back|delivery|lays? off|assist|square ball)\b/g,
  set_piece_duty: /\b(corners?|free[ -]?kicks?|set[ -]?pieces?|penalt(?:y|ies)|dead[ -]?ball)\b/g,
  defensive_activity: /\b(tackles?|intercepts?|interception|clears?|clearance|blocks?|wins? possession|recovers? possession)\b/g,
  advanced_role: /\b(pushed forward|moves? into midfield|operating (?:as|behind|high)|leading the line|playing (?:as|up front)|drops? deep|advanced position|number 10|wing[ -]?back)\b/g,
  availability_context: /\b(injur(?:y|ed)|receiving treatment|forced off|limps?|knock|cannot continue|comes off hurt)\b/g,
};

function normalize(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, ' and ')
    .replace(/&quot;/gi, ' ')
    .replace(/&#39;/gi, "'")
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliases(player: OfficialPlayer): string[] {
  return [...new Set([
    `${player.first_name} ${player.second_name}`,
    player.second_name,
    player.web_name,
  ].map(normalize).filter((value) => value.length >= 4))].sort((a, b) => b.length - a.length);
}

function playerMatches(text: string, players: OfficialPlayer[]): Array<{ player: OfficialPlayer; index: number }> {
  const owners = new Map<string, Set<number>>();
  for (const player of players) {
    for (const alias of aliases(player)) owners.set(alias, new Set([...(owners.get(alias) ?? []), player.id]));
  }
  const matched = new Map<number, { player: OfficialPlayer; index: number; aliasLength: number }>();
  for (const player of players) {
    for (const alias of aliases(player)) {
      if ((owners.get(alias)?.size ?? 0) !== 1) continue;
      const index = ` ${text} `.indexOf(` ${alias} `);
      if (index < 0) continue;
      const current = matched.get(player.id);
      if (!current || alias.length > current.aliasLength) matched.set(player.id, { player, index: Math.max(0, index - 1), aliasLength: alias.length });
    }
  }
  return [...matched.values()].map(({ player, index }) => ({ player, index }));
}

function classify(window: string): Array<{ signal: CommentarySignalKind; strength: number }> {
  return (Object.keys(patterns) as CommentarySignalKind[]).flatMap((signal) => {
    const hits = [...window.matchAll(patterns[signal])].length;
    if (!hits) return [];
    const base = signal === 'advanced_role' || signal === 'availability_context' ? 68 : signal === 'set_piece_duty' ? 62 : 52;
    return [{ signal, strength: Math.min(90, base + Math.max(0, hits - 1) * 8) }];
  });
}

function minuteLabel(minute: number | null, addedTime: number | null): string {
  if (minute === null) return 'post-match';
  return `${minute}${addedTime ? `+${addedTime}` : ''}'`;
}

export function parseLiveScoreCommentary(args: {
  response: LiveScoreCommentaryResponse;
  fixture: OfficialFixture;
  eventId: string;
  homeName: string;
  awayName: string;
  bootstrap: OfficialBootstrap;
  retrievedAt: string;
}): CommentaryObservation[] {
  if (args.fixture.event === null) return [];
  const fixturePlayers = args.bootstrap.elements.filter((player) => player.team === args.fixture.team_h || player.team === args.fixture.team_a);
  const teams = new Map(args.bootstrap.teams.map((team) => [team.id, team.name]));
  const sourceUrl = `${COMMENTARY_PAGE}/${liveScoreSlug(args.homeName)}-vs-${liveScoreSlug(args.awayName)}/${args.eventId}/`;
  const rows: LiveScoreComment[] = [
    ...(args.response.Els?.Txt ? [{ Min: undefined, MinEx: undefined, Txt: args.response.Els.Txt }] : []),
    ...(args.response.Com ?? []),
  ];
  const dedupe = new Map<string, CommentaryObservation>();
  for (const row of rows) {
    const text = normalize(row.Txt ?? '');
    if (!text) continue;
    const matches = playerMatches(text, fixturePlayers).sort((a, b) => a.index - b.index);
    for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
      const match = matches[matchIndex];
      const previous = matches[matchIndex - 1];
      const next = matches[matchIndex + 1];
      const start = previous ? Math.floor((previous.index + match.index) / 2) : Math.max(0, match.index - 80);
      const end = next ? Math.ceil((match.index + next.index) / 2) : Math.min(text.length, match.index + 130);
      const window = text.slice(start, end);
      for (const classified of classify(window)) {
        const teamId = match.player.team;
        const opponentId = teamId === args.fixture.team_h ? args.fixture.team_a : args.fixture.team_h;
        const minute = Number.isFinite(row.Min) ? row.Min! : null;
        const addedTime = Number.isFinite(row.MinEx) ? row.MinEx! : null;
        const observation: CommentaryObservation = {
          playerId: match.player.id,
          playerName: match.player.web_name,
          teamId,
          gameweek: args.fixture.event,
          fixtureId: args.fixture.id,
          opponent: teams.get(opponentId) ?? 'unknown opponent',
          minute,
          addedTime,
          signal: classified.signal,
          strength: classified.strength,
          derivedSummary: `${signalLabels[classified.signal]} noted at ${minuteLabel(minute, addedTime)} in GW${args.fixture.event} against ${teams.get(opponentId) ?? 'the opponent'}.`,
          source: 'LiveScore commentary',
          sourceUrl,
          retrievedAt: args.retrievedAt,
        };
        dedupe.set(`${observation.playerId}:${observation.fixtureId}:${observation.minute}:${observation.addedTime}:${observation.signal}`, observation);
      }
    }
  }
  return [...dedupe.values()];
}

async function inBatches<T, R>(items: T[], size: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(...await Promise.all(items.slice(index, index + size).map(mapper)));
  }
  return output;
}

export async function loadCommentaryObservations(args: {
  bootstrap: OfficialBootstrap;
  fixtures: OfficialFixture[];
  currentGameweek: number;
  fetcher?: FetchLike;
  now?: Date;
}): Promise<{ observations: CommentaryObservation[]; health: SourceHealth }> {
  const fetcher = args.fetcher ?? fetch;
  const retrievedAt = (args.now ?? new Date()).toISOString();
  const completed = args.bootstrap.events
    .filter((event) => event.finished && event.id <= args.currentGameweek)
    .map((event) => event.id)
    .sort((a, b) => a - b)
    .slice(-4);
  try {
    const matched = await discoverLiveScoreFixtureEvents({
      bootstrap: args.bootstrap,
      fixtures: args.fixtures,
      targetGameweeks: completed,
      fetcher,
    });
    const parsed = await inBatches(matched, 5, async ({ fixture, event }) => {
      const response = await fetcher(`${COMMENTARY_API}/event/${event.id}/comments?locale=en`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`LiveScore commentary ${event.id} failed (${response.status}).`);
      return parseLiveScoreCommentary({
        response: await response.json() as LiveScoreCommentaryResponse,
        fixture,
        eventId: event.id!,
        homeName: event.homeTeamName ?? 'home',
        awayName: event.awayTeamName ?? 'away',
        bootstrap: args.bootstrap,
        retrievedAt,
      });
    });
    const observations = parsed.flat();
    const coveredGameweeks = new Set(observations.map((row) => row.gameweek));
    return {
      observations,
      health: {
        key: 'match_commentary_context',
        status: matched.length && observations.length && coveredGameweeks.size >= Math.min(3, completed.length) ? 'healthy' : matched.length ? 'degraded' : 'failed',
        retrievedAt,
        records: observations.length,
        message: `${matched.length} matches inspected across the previous ${completed.length} completed Gameweeks; ${observations.length} derived player-context signals retained. Raw commentary is not stored or used as direct xPts.`,
      },
    };
  } catch (error) {
    return {
      observations: [],
      health: {
        key: 'match_commentary_context',
        status: 'failed',
        retrievedAt,
        records: 0,
        message: `Commentary enrichment failed safely (${String(error)}). Core projections were not blocked.`,
      },
    };
  }
}

function lineupCorroboratesRole(player: OfficialPlayer, lineups: LineupObservation[]): boolean {
  const listed = player.element_type === 1 ? 'GK' : player.element_type === 2 ? 'DEF' : player.element_type === 3 ? 'MID' : 'FWD';
  return lineups.some((row) => {
    if (row.playerId !== player.id || row.status !== 'starter') return false;
    const gridRow = Number.parseInt(row.grid?.split(':')[0] ?? '', 10);
    return row.actualPosition !== 'UNKNOWN' && row.actualPosition !== listed || (listed === 'DEF' && Number.isFinite(gridRow) && gridRow >= 3);
  });
}

export function aggregateCommentaryInsights(args: {
  observations: CommentaryObservation[];
  bootstrap: OfficialBootstrap;
  lineups: LineupObservation[];
}): PlayerCommentaryInsight[] {
  const players = new Map(args.bootstrap.elements.map((player) => [player.id, player]));
  const teams = new Map(args.bootstrap.teams.map((team) => [team.id, team.name]));
  const grouped = new Map<number, CommentaryObservation[]>();
  for (const observation of args.observations) grouped.set(observation.playerId, [...(grouped.get(observation.playerId) ?? []), observation]);
  const summaries = [...grouped.entries()].flatMap(([playerId, rows]) => {
    const player = players.get(playerId);
    if (!player) return [];
    const signalGroups = new Map<CommentarySignalKind, CommentaryObservation[]>();
    for (const row of rows) signalGroups.set(row.signal, [...(signalGroups.get(row.signal) ?? []), row]);
    const signals = [...signalGroups.entries()].map(([kind, signalRows]) => ({
      kind,
      observations: signalRows.length,
      gameweeks: new Set(signalRows.map((row) => row.gameweek)).size,
      score: Math.round(signalRows.reduce((sum, row) => sum + row.strength, 0) / signalRows.length),
    }));
    return [{ player, rows, signals }];
  });
  const minimumRate: Record<CommentarySignalKind, number> = {
    attacking_threat: 4,
    creative_involvement: 3,
    set_piece_duty: 2,
    defensive_activity: 5,
    advanced_role: 1,
    availability_context: 1,
  };
  const thresholds = new Map<CommentarySignalKind, number>();
  for (const kind of Object.keys(minimumRate) as CommentarySignalKind[]) {
    const rates = summaries.flatMap((summary) => summary.signals.filter((signal) => signal.kind === kind).map((signal) => signal.observations / Math.max(1, signal.gameweeks))).sort((a, b) => a - b);
    const percentile = rates.length ? rates[Math.floor((rates.length - 1) * 0.85)] : minimumRate[kind];
    thresholds.set(kind, Math.max(minimumRate[kind], percentile));
  }
  const priority: Record<CommentarySignalKind, number> = {
    advanced_role: 6,
    set_piece_duty: 5,
    attacking_threat: 4,
    creative_involvement: 3,
    availability_context: 2,
    defensive_activity: 1,
  };
  return summaries.flatMap(({ player, rows, signals: allSignals }) => {
    const setPieceOrder = Math.min(
      player.penalties_order ?? 99,
      player.direct_freekicks_order ?? 99,
      player.corners_and_indirect_freekicks_order ?? 99,
    );
    const signals = allSignals.filter((signal) => {
      const structured = signal.kind === 'advanced_role' || signal.kind === 'availability_context' || signal.kind === 'set_piece_duty' && setPieceOrder <= 3;
      const rate = signal.observations / Math.max(1, signal.gameweeks);
      return structured || rate >= (thresholds.get(signal.kind) ?? minimumRate[signal.kind]) && (signal.gameweeks >= 2 || signal.observations >= 3);
    }).sort((a, b) => priority[b.kind] - priority[a.kind] || b.gameweeks - a.gameweeks || b.observations - a.observations || b.score - a.score);
    if (!signals.length) return [];
    const setPieceCorroborated = signals.some((signal) => signal.kind === 'set_piece_duty') && setPieceOrder <= 3;
    const roleCorroborated = signals.some((signal) => signal.kind === 'advanced_role') && lineupCorroboratesRole(player, args.lineups);
    const repeatedProminence = signals.some((signal) => signal.gameweeks >= 2 && signal.observations / signal.gameweeks >= (thresholds.get(signal.kind) ?? minimumRate[signal.kind]));
    const corroborated = repeatedProminence || setPieceCorroborated || roleCorroborated;
    const sampleGameweeks = [...new Set(rows.map((row) => row.gameweek))].sort((a, b) => b - a);
    const relevantObservations = signals.reduce((sum, signal) => sum + signal.observations, 0);
    const confidence = Math.min(88, Math.round(28 + sampleGameweeks.length * 8 + Math.min(5, relevantObservations) * 4 + (corroborated ? 14 : 0)));
    const primary = signals[0];
    const evidence = [
      `${relevantObservations} notable derived observations across ${sampleGameweeks.length} Gameweek${sampleGameweeks.length === 1 ? '' : 's'}.`,
      ...signals.slice(0, 3).map((signal) => `${signalLabels[signal.kind]}: ${signal.observations} observation${signal.observations === 1 ? '' : 's'} across ${signal.gameweeks} Gameweek${signal.gameweeks === 1 ? '' : 's'}.`),
    ];
    const primaryExamples = rows.filter((row) => row.signal === primary.kind).sort((a, b) => b.gameweek - a.gameweek || (b.minute ?? 0) - (a.minute ?? 0)).slice(0, 2);
    evidence.push(...primaryExamples.map((row) => row.derivedSummary));
    if (setPieceCorroborated) evidence.push('Official FPL set-piece order corroborates the commentary signal.');
    if (roleCorroborated) evidence.push('Confirmed-lineup positioning corroborates the commentary role signal.');
    return [{
      playerId: player.id,
      playerName: player.web_name,
      team: teams.get(player.team) ?? 'Unknown',
      sampleGameweeks,
      observations: relevantObservations,
      signals,
      status: corroborated ? 'corroborated' : 'watch',
      confidence,
      headline: primary ? `${signalLabels[primary.kind]} ${corroborated ? 'corroborated' : 'flagged for monitoring'}.` : 'No repeat signal.',
      evidence,
      sourceUrls: [...new Set(rows.map((row) => row.sourceUrl))].slice(0, 4),
      modelEffect: roleCorroborated ? 'role_evidence' : corroborated ? 'confidence_only' : 'none',
    } satisfies PlayerCommentaryInsight];
  }).sort((a, b) => (b.status === 'corroborated' ? 1 : 0) - (a.status === 'corroborated' ? 1 : 0) || b.confidence - a.confidence || b.observations - a.observations);
}
