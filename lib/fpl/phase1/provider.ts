import type {
  EventLive,
  OfficialBootstrap,
  OfficialFixture,
  SourceHealth,
} from './types';

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';

export interface PhaseOneOfficialData {
  bootstrap: OfficialBootstrap;
  fixtures: OfficialFixture[];
  eventLives: EventLive[];
  currentGameweek: number;
  nextGameweek: number;
  sourceHealth: SourceHealth[];
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function fetchJson<T>(url: string, fetcher: FetchLike, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetcher(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'theevanmiles.com-fpl-phase-one/1.0' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`FPL request failed for ${url}: ${String(lastError)}`);
}

function resolveGameweeks(bootstrap: OfficialBootstrap): { current: number; next: number; completed: number[] } {
  const completed = bootstrap.events.filter((event) => event.finished).map((event) => event.id).sort((a, b) => a - b);
  const currentEvent = bootstrap.events.find((event) => event.is_current);
  const nextEvent = bootstrap.events.find((event) => event.is_next);
  const current = currentEvent?.id ?? completed.at(-1) ?? 0;
  const next = nextEvent?.id ?? Math.min(38, current + 1);
  return { current, next, completed };
}

export async function fetchPhaseOneOfficialData(fetcher: FetchLike = fetch): Promise<PhaseOneOfficialData> {
  const retrievedAt = new Date().toISOString();
  const [bootstrap, fixtures] = await Promise.all([
    fetchJson<OfficialBootstrap>(`${FPL_BASE_URL}/bootstrap-static/`, fetcher),
    fetchJson<OfficialFixture[]>(`${FPL_BASE_URL}/fixtures/`, fetcher),
  ]);
  if (bootstrap.teams.length !== 20 || bootstrap.elements.length < 300) {
    throw new Error('Official FPL bootstrap failed structural validation.');
  }
  if (fixtures.length < 300) throw new Error('Official FPL fixture payload failed structural validation.');
  const gameweeks = resolveGameweeks(bootstrap);
  const rollingEvents = gameweeks.completed.slice(-5);
  const eventLives = await Promise.all(rollingEvents.map(async (event): Promise<EventLive> => {
    const response = await fetchJson<{ elements: EventLive['elements'] }>(`${FPL_BASE_URL}/event/${event}/live/`, fetcher);
    return { event, elements: response.elements };
  }));
  return {
    bootstrap,
    fixtures,
    eventLives,
    currentGameweek: gameweeks.current,
    nextGameweek: gameweeks.next,
    sourceHealth: [
      { key: 'official_fpl_players', status: 'healthy', retrievedAt, records: bootstrap.elements.length, message: 'Current players, prices, availability and transfers validated.' },
      { key: 'official_fpl_fixtures', status: 'healthy', retrievedAt, records: fixtures.length, message: 'Current fixtures and difficulty fields validated.' },
      { key: 'official_fpl_event_live', status: rollingEvents.length ? 'healthy' : 'degraded', retrievedAt, records: eventLives.reduce((sum, event) => sum + event.elements.length, 0), message: `${rollingEvents.length} completed Gameweeks loaded for rolling features.` },
    ],
  };
}
