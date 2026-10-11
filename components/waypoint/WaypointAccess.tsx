"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Loader2, Lock, Navigation } from "lucide-react";
import { API, SESSION_EXPIRED_EVENT } from "@/lib/waypoint/api";
import Waypoint from "./Waypoint";

type Access = "checking" | "ready" | "unconfigured" | "authenticated";

async function authentication(method: string, password?: string) {
  const response = await fetch(`${API}/auth`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(password !== undefined ? { body: JSON.stringify({ password }) } : {}),
    // Hosted Supabase-backed auth can take a few seconds for the rate-limit
    // check and the success write. Mobile networks need a little more room.
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : typeof result?.detail === "string"
          ? result.detail
          : "Sign-in is unavailable. Please try again shortly.",
    );
  }
  return result as { authenticated: boolean; configured: boolean };
}

export default function WaypointAccess() {
  const [access, setAccess] = useState<Access>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    authentication("GET")
      .then((result) => {
        if (active) {
          setAccess(
            result.authenticated
              ? "authenticated"
              : result.configured
                ? "ready"
                : "unconfigured",
          );
        }
      })
      .catch(() => {
        if (active) {
          setAccess("ready");
          setError("We couldn’t check your session. You can try signing in below.");
        }
      });
    const expired = () => {
      setAccess("ready");
      setPassword("");
      setError("Your session has ended. Sign in to continue.");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => {
      active = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    };
  }, []);

  const signOut = useCallback(async () => {
    await authentication("DELETE");
    setAccess("ready");
    setPassword("");
    setError("");
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authentication("POST", password);
      if (!result.authenticated) throw new Error("Please check your password and try again.");
      setPassword("");
      setAccess("authenticated");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  if (access === "authenticated") return <Waypoint onSignOut={signOut} />;

  return (
    <div className="waypoint-access">
      <section className="access-card" aria-labelledby="waypoint-access-title">
        <a href="/waypoint" className="access-brand" aria-label="Waypoint home">
          <span><Navigation size={25} fill="currentColor" /></span>
          waypoint<span className="heading-dot">.</span>
        </a>
        <p className="eyebrow">A clearer next step</p>
        <h1 id="waypoint-access-title">Your private workspace.</h1>
        <p className="access-description">
          Keep your research, plans, and trade journal together.
        </p>
        {access === "checking" ? (
          <p className="access-status" role="status"><Loader2 size={18} className="spin" /> Checking your session…</p>
        ) : access === "unconfigured" ? (
          <div className="access-notice" role="status">
            <Lock size={20} />
            <p>This workspace is being prepared. Private sign-in hasn’t been configured yet.</p>
          </div>
        ) : (
          <form onSubmit={signIn}>
            <label htmlFor="waypoint-password">Waypoint password</label>
            <input
              id="waypoint-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              autoFocus
            />
            {error && <p className="access-error" role="alert">{error}</p>}
            <button className="button primary" type="submit" disabled={busy || !password}>
              {busy ? <Loader2 size={17} className="spin" /> : <ArrowRight size={17} />}
              {busy ? "Signing in…" : "Open my workspace"}
            </button>
          </form>
        )}
        <p className="access-footnote"><Lock size={13} /> Password-protected access.</p>
      </section>
      <a className="access-site-link" href="/">Back to Evan Miles</a>
    </div>
  );
}
