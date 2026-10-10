import type { Dashboard, Stock } from "./types";

export const API = "/api/waypoint";
export const SESSION_EXPIRED_EVENT = "waypoint:session-expired";

export type StreamState = "connecting" | "connected" | "reconnecting" | "unavailable";

export function marketFreshness(stock: Stock, data: Dashboard, now: number, transportFresh: boolean) {
  const timestamp = stock.market?.timestamp ?? stock.price_as_of ?? stock.freshness.market_at;
  const milliseconds = Date.parse(timestamp ?? "");
  const age = Number.isFinite(milliseconds) ? Math.max(0, (now - milliseconds) / 1000) : null;
  const staleAfter = data.mode === "demo" ? 120 : data.data_status?.price_stale_seconds ?? 30;
  const stale = !transportFresh || age === null || milliseconds > now + 5000 || age >= staleAfter ||
    (data.mode === "live" && (
      !data.data_status?.stream.connected || stock.watchlist_tier !== "HOT" || !stock.market || stock.market.stale || stock.price_basis === "completed_close"
    ));
  return { age, stale, timestamp };
}

export function stockStateSafe(stock: Stock, data: Dashboard, now: number, transportFresh: boolean) {
  return !marketFreshness(stock, data, now, transportFresh).stale && stock.freshness.status === "current" && (data.mode === "demo" || stock.actionable === true);
}

export function subscribeWaypoint(options: {
  onSnapshot: (data: Dashboard) => void;
  onHeartbeat: () => void;
  onState: (state: StreamState, message?: string) => void;
}): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  const clearConnection = () => {
    source?.close();
    source = null;
    clearTimeout(watchdog);
  };
  const schedule = (message = "Live updates disconnected. Prices and signals are paused while reconnecting.") => {
    clearConnection();
    if (closed) return;
    options.onState("reconnecting", message);
    clearTimeout(retry);
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.5 + Math.random() * 0.5);
    retry = setTimeout(connect, delay);
  };
  const alive = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => schedule("No stream heartbeat received. Prices and signals are paused while reconnecting."), 35000);
  };
  const connect = () => {
    if (closed) return;
    options.onState(attempt ? "reconnecting" : "connecting");
    const current = new EventSource(`${API}/events`, { withCredentials: true });
    source = current;
    alive();
    current.addEventListener("snapshot", (event) => {
      if (closed || source !== current) return;
      try {
        const snapshot = parseDashboard(JSON.parse((event as MessageEvent).data));
        attempt = 0;
        alive();
        options.onSnapshot(snapshot);
        options.onState("connected");
      } catch { schedule("An incomplete stream update was received. Signals are paused while reconnecting."); }
    });
    current.addEventListener("heartbeat", () => {
      if (closed || source !== current) return;
      alive();
      options.onHeartbeat();
    });
    current.addEventListener("unavailable", (event) => {
      if (closed || source !== current) return;
      try {
        const status = JSON.parse((event as MessageEvent).data);
        if (status.retryable === false) {
          clearConnection();
          options.onState("unavailable", typeof status.detail === "string" ? status.detail : "A persistent background engine is required for live updates.");
        } else schedule();
      } catch { schedule(); }
    });
    current.onerror = async () => {
      if (closed || source !== current) return;
      clearConnection();
      options.onState("reconnecting", "Live updates disconnected. Prices and signals are paused while reconnecting.");
      try {
        // EventSource hides HTTP status. Check the session, never poll market data.
        const session = await request<{ authenticated: boolean }>("/auth");
        if (closed) return;
        if (!session.authenticated) {
          closed = true;
          window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
          return;
        }
      } catch { /* A temporary network outage is retried with backoff. */ }
      if (!closed) schedule();
    };
  };
  connect();
  return () => { closed = true; clearTimeout(retry); clearConnection(); };
}

export function parseDashboard(value: unknown): Dashboard {
  if (!value || typeof value !== "object")
    throw new Error("The engine returned an invalid response.");
  const data = value as Dashboard;
  if (
    !["demo", "live"].includes(data.mode) ||
    !data.settings ||
    !data.market ||
    !data.portfolio ||
    !Number.isFinite(data.portfolio.total_eur) ||
    !Array.isArray(data.portfolio.positions) ||
    !Array.isArray(data.stocks) ||
    !Array.isArray(data.journal) ||
    !Array.isArray(data.alerts) ||
    !data.shadow ||
    data.stocks.some(
      (s) =>
        !s ||
        typeof s.symbol !== "string" ||
        !Number.isFinite(s.price) ||
        !s.freshness ||
        !s.sizing ||
        !Array.isArray(s.sources),
    )
  ) {
    throw new Error("The engine response is incomplete. Signals are paused.");
  }
  return data;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path.replace(/^\/api(?=\/)/, "")}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    credentials: "same-origin",
    signal: init?.signal ?? AbortSignal.timeout(path === "/api/refresh" ? 60000 : 15000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new Error("Your session has ended. Sign in to continue.");
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? (body as { detail: unknown }).detail
        : null;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `The engine could not complete this request (${response.status}). Check the values and try again.`,
    );
  }
  return body as T;
}

export const money = (value: number, currency = "EUR") =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(Math.abs(value) < 0.005 ? 0 : value)
    : "—";
export const signed = (value: number, currency = "EUR") =>
  `${value >= 0.005 ? "+" : ""}${money(value, currency)}`;
export const price = (value: number) =>
  value > 0 ? money(value, "USD") : "Unavailable";
export const range = (low: number, high: number) =>
  `${price(low)} – ${price(high)}`;
export function dateTime(
  value: string | null | undefined,
  compact = false,
): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    ...(compact
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
  }).format(date);
}
export const humanize = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
