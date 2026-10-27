import type {
  FetchLike,
  OfficialBootstrap,
  OfficialFixture,
  OfficialPlayer,
  OfficialTeam,
} from '../phase1';
import type { LineupObservation } from './types';

const LIVE_SCORE_ROOT = 'https://www.livescore.com/en/football';
const LIVE_SCORE_API = 'https://prod-cdn-public-api.lsmedia1.com/v1/api/app';

interface LiveScoreEvent {
  id?: string;
  startDateTimeString?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  competitionId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
}

interface LiveScorePlayer {
  Aid?: string;
  Pid?: string;
  Fn?: string;
  Ln?: string;
  Pnt?: string;
  Pon?: string;
  Pos?: number;
  PosA?: number;
  Fp?: string;
}

interface LiveScoreTeamLineup {
  Tnb?: number;
  Ps?: LiveScorePlayer[];
  Fo?: number[];
}

interface LiveScoreLineupResponse {
  Eid?: string;
  Lu?: LiveScoreTeamLineup[];
}

interface LiveScoreTeamRef {
  id: string;
  name: string;
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalTeam(value: string): string {
  const team = normalize(value);
  const aliases: Record<string, string> = {
    'afc bournemouth': 'bournemouth',
    'manchester city': 'man city',
    'manchester united': 'man utd',
    'newcastle united': 'newcastle',
    'nottingham forest': 'nott m forest',
    'tottenham hotspur': 'spurs',
    'leeds united': 'leeds',
  };
  return aliases[team] ?? team;
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, '-');
}

function extractNextData(html: string): Record<string, unknown> {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('LiveScore page did not contain Next.js data.');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function pageProps(document: Record<string, unknown>): Record<string, unknown> {
  const props = document.props as Record<string, unknown> | undefined;
  const value = props?.pageProps;
  if (!value || typeof value !== 'object') throw new Error('LiveScore page data did not contain page props.');
  return value as Record<string, unknown>;
}

function initialData(document: Record<string, unknown>): Record<string, unknown> {
  const value = pageProps(document).initialData;
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function parseLiveScoreTeamRefs(html: string): LiveScoreTeamRef[] {
  const tables = initialData(extractNextData(html)).tables as Record<string, unknown> | undefined;
  const league = tables?.league as Record<string, unknown> | undefined;
  const groups = league ? Object.values(league).flatMap((value) => Array.isArray(value) ? value : []) : [];
  const teams = groups.flatMap((group) => {
    if (!group || typeof group !== 'object') return [];
    const rows = (group as Record<string, unknown>).teams;
    return Array.isArray(rows) ? rows : [];
  });
  return teams.flatMap((team) => {
    if (!team || typeof team !== 'object') return [];
    const row = team as Record<string, unknown>;
    return typeof row.id === 'string' && typeof row.name === 'string' ? [{ id: row.id, name: row.name }] : [];
  });
}

export function parseLiveScoreResults(html: string): LiveScoreEvent[] {
  const data = initialData(extractNextData(html));
  if (Array.isArray(data.results)) return data.results as LiveScoreEvent[];
  const sections = data.sections;
  const rows = Array.isArray(sections) ? sections : sections && typeof sections === 'object' ? [sections] : [];
  return rows.flatMap((section) => {
    if (!section || typeof section !== 'object') return [];
    const events = (section as Record<string, unknown>).events;
    return Array.isArray(events) ? events as LiveScoreEvent[] : [];
  });
}

function matchPlayer(source: LiveScorePlayer, teamId: number, bootstrap: OfficialBootstrap): OfficialPlayer | null {
  const candidates = bootstrap.elements.filter((player) => player.team === teamId);
  const sourceFull = normalize(`${source.Fn ?? ''} ${source.Ln ?? ''}`);
  const sourceLast = normalize(source.Ln ?? '');
  const exact = candidates.find((player) => normalize(`${player.first_name} ${player.second_name}`) === sourceFull);
  if (exact) return exact;
  const web = candidates.filter((player) => normalize(player.web_name) === sourceLast || normalize(player.web_name) === sourceFull);
  if (web.length === 1) return web[0];
  const surname = candidates.filter((player) => normalize(player.second_name) === sourceLast);
  if (surname.length === 1) return surname[0];
  const sourceTokens = sourceFull.split(' ').filter((token) => token.length >= 3);
  const scored = candidates.map((player) => {
    const candidateTokens = normalize(`${player.first_name} ${player.second_name} ${player.web_name}`).split(' ');
    const tokenScores = sourceTokens.map((token) => candidateTokens.some((candidate) => candidate === token) ? 2 :
      candidateTokens.some((candidate) => token.length >= 5 && candidate.length >= 5 && (candidate.startsWith(token) || token.startsWith(candidate))) ? 1 : 0);
    return { player, score: tokenScores.reduce<number>((sum, value) => sum + value, 0), matched: tokenScores.filter(Boolean).length };
  }).filter((row) => row.matched === sourceTokens.length && row.score >= Math.max(2, sourceTokens.length));
  scored.sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score !== scored[1]?.score ? scored[0].player : null;
}

function actualPosition(value: string | undefined): string {
  const position = normalize(value ?? '');
  if (position === 'goalkeeper') return 'GK';
  if (position === 'defender') return 'DEF';
  if (position === 'midfielder') return 'MID';
  if (position === 'forward' || position === 'attacker') return 'FWD';
  return 'UNKNOWN';
}

export function parseLiveScoreLineup(args: {
  response: LiveScoreLineupResponse;
  fixture: OfficialFixture;
  gameweek: number;
  eventId: string;
  homeName: string;
  awayName: string;
  bootstrap: OfficialBootstrap;
  retrievedAt: string;
}): { observations: LineupObservation[]; unresolved: string[] } {
  const observations: LineupObservation[] = [];
  const unresolved: string[] = [];
  for (const side of args.response.Lu ?? []) {
    const home = side.Tnb === 1;
    const teamId = home ? args.fixture.team_h : args.fixture.team_a;
    const formation = side.Fo?.join('-') ?? null;
    for (const source of side.Ps ?? []) {
      if (source.Pos === 10 || normalize(source.Pon ?? '') === 'coach') continue;
      const player = matchPlayer(source, teamId, args.bootstrap);
      if (!player) {
        if ((source.PosA ?? 10) <= 5) unresolved.push(`${source.Fn ?? ''} ${source.Ln ?? ''}`.trim());
        continue;
      }
      const status = source.Pos === 5 || source.PosA === 5 ? 'substitute' : 'starter';
      observations.push({
        playerId: player.id,
        gameweek: args.gameweek,
        fixtureId: args.fixture.id,
        teamId,
        formation,
        status,
        actualPosition: actualPosition(source.Pon),
        grid: source.Fp ?? null,
        confidence: 98,
        source: 'LiveScore confirmed lineups',
        sourceUrl: `${LIVE_SCORE_ROOT}/england/premier-league/${slug(args.homeName)}-vs-${slug(args.awayName)}/${args.eventId}/lineups/`,
        retrievedAt: args.retrievedAt,
      });
    }
  }
  return { observations, unresolved };
}

async function text(url: string, fetcher: FetchLike): Promise<string> {
  const response = await fetcher(url, { headers: { Accept: 'text/html,application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function officialName(teamId: number, teams: OfficialTeam[]): string {
  return teams.find((team) => team.id === teamId)?.name ?? `team-${teamId}`;
}

function eventMatchesFixture(event: LiveScoreEvent, fixture: OfficialFixture, teams: OfficialTeam[]): boolean {
  return canonicalTeam(event.homeTeamName ?? '') === canonicalTeam(officialName(fixture.team_h, teams)) &&
    canonicalTeam(event.awayTeamName ?? '') === canonicalTeam(officialName(fixture.team_a, teams));
}

export async function fetchLiveScoreObservations(args: {
  bootstrap: OfficialBootstrap;
  fixtures: OfficialFixture[];
  currentGameweek: number;
  fetcher?: FetchLike;
  now?: Date;
}): Promise<{ observations: LineupObservation[]; unresolved: string[]; matches: number }> {
  const fetcher = args.fetcher ?? fetch;
  const completed = args.bootstrap.events.filter((event) => event.finished && event.id <= args.currentGameweek).map((event) => event.id).sort((a, b) => a - b);
  const targetGameweeks = new Set(completed.slice(-2));
  const fixtures = args.fixtures.filter((fixture) => fixture.finished && fixture.event !== null && targetGameweeks.has(fixture.event));
  if (!fixtures.length) return { observations: [], unresolved: [], matches: 0 };

  const resultsHtml = await text(`${LIVE_SCORE_ROOT}/england/premier-league/results/`, fetcher);
  const latestEvents = parseLiveScoreResults(resultsHtml).filter((event) => event.competitionId === '65' && event.id);
  if (!latestEvents.length) throw new Error('LiveScore results page returned no Premier League event identifiers.');
  const eventPool = new Map(latestEvents.map((event) => [event.id!, event]));
  const teamRefs = new Map<string, LiveScoreTeamRef>();
  const visited = new Set<string>();
  const collectTeams = (events: LiveScoreEvent[]) => {
    for (const event of events) {
      if (event.homeTeamId && event.homeTeamName) teamRefs.set(event.homeTeamId, { id: event.homeTeamId, name: event.homeTeamName });
      if (event.awayTeamId && event.awayTeamName) teamRefs.set(event.awayTeamId, { id: event.awayTeamId, name: event.awayTeamName });
    }
  };
  collectTeams(latestEvents);
  // The results page exposes the latest matchday. Team overviews then provide the preceding
  // matches and reveal any remaining club IDs, without relying on hard-coded IDs.
  for (let round = 0; round < 2; round += 1) {
    const pending = [...teamRefs.values()].filter((team) => !visited.has(team.id));
    if (!pending.length) break;
    const resultPages = await Promise.all(pending.map(async (team) => {
      visited.add(team.id);
      return parseLiveScoreResults(await text(`${LIVE_SCORE_ROOT}/team/${slug(team.name)}/${team.id}/overview/`, fetcher));
    }));
    const leagueEvents = resultPages.flat().filter((event) => event.competitionId === '65' && event.id);
    for (const event of leagueEvents) eventPool.set(event.id!, event);
    collectTeams(leagueEvents);
  }
  const matched = fixtures.flatMap((fixture) => {
    const event = [...eventPool.values()].find((candidate) => eventMatchesFixture(candidate, fixture, args.bootstrap.teams));
    return event?.id ? [{ fixture, event }] : [];
  });
  const retrievedAt = (args.now ?? new Date()).toISOString();
  const parsed = await Promise.all(matched.map(async ({ fixture, event }) => {
    const response = await fetcher(`${LIVE_SCORE_API}/lineups/soccer/${event.id}?locale=en`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`LiveScore lineup ${event.id} failed (${response.status}).`);
    return parseLiveScoreLineup({
      response: await response.json() as LiveScoreLineupResponse,
      fixture,
      gameweek: fixture.event!,
      eventId: event.id!,
      homeName: event.homeTeamName ?? officialName(fixture.team_h, args.bootstrap.teams),
      awayName: event.awayTeamName ?? officialName(fixture.team_a, args.bootstrap.teams),
      bootstrap: args.bootstrap,
      retrievedAt,
    });
  }));
  return {
    observations: parsed.flatMap((item) => item.observations),
    unresolved: [...new Set(parsed.flatMap((item) => item.unresolved))],
    matches: matched.length,
  };
}
