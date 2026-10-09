import type { Dashboard } from "./types";

export const API = "/api/waypoint";
export const SESSION_EXPIRED_EVENT = "waypoint:session-expired";

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
