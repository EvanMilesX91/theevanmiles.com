"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  HelpCircle,
  Clock3,
  Compass,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  AlertTriangle,
  Wallet,
  WifiOff,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  dateTime,
  humanize,
  money,
  parseDashboard,
  price,
  range,
  request,
  signed,
} from "@/lib/waypoint/api";
import type {
  BacktestReport,
  ComponentScore,
  Dashboard,
  Position,
  Settings,
  Source,
  State,
  Stock,
  TradeInput,
} from "@/lib/waypoint/types";

type Page = "today" | "positions" | "journal" | "research" | "settings";
type Trade = { stock: Stock; side: "buy" | "sell"; position?: Position };
function dublinInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function dublinOffset(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Dublin",
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .some((p) => p.type === "timeZoneName" && p.value.includes("+1"))
    ? "+01:00"
    : "+00:00";
}
const stateInfo: Record<State, { label: string; tone: string; short: string }> =
  {
    BUY_AREA: {
      label: "Buy area",
      tone: "green",
      short: "In the planned entry range",
    },
    WAIT: { label: "Wait", tone: "amber", short: "Let the price come to you" },
    HOLD: { label: "Hold", tone: "blue", short: "Follow your original plan" },
    TAKE_PROFIT: {
      label: "Take some profit",
      tone: "purple",
      short: "First profit area reached",
    },
    WATCH_CLOSELY: {
      label: "Watch closely",
      tone: "orange",
      short: "Getting close to your review level",
    },
    RECONSIDER_EXIT: {
      label: "Reconsider / exit",
      tone: "red",
      short: "Review the original setup",
    },
    WATCH: {
      label: "Watch",
      tone: "blue",
      short: "Interesting, with conditions",
    },
    SKIP: {
      label: "No trade",
      tone: "gray",
      short: "This setup does not qualify",
    },
    NO_SETUP: {
      label: "No trade",
      tone: "gray",
      short: "No qualifying setup right now",
    },
  };

function Badge({
  state,
  safe = true,
  large = false,
}: {
  state: State;
  safe?: boolean;
  large?: boolean;
}) {
  const info = safe
    ? (stateInfo[state] ?? stateInfo.NO_SETUP)
    : { label: "Signals paused", tone: "gray" };
  return (
    <span className={`state-badge ${info.tone} ${large ? "large" : ""}`}>
      <span className="state-dot" />
      {info.label}
    </span>
  );
}
function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon ?? <Compass size={30} />}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function StockMark({
  symbol,
  small = false,
}: {
  symbol: string;
  small?: boolean;
}) {
  return (
    <div
      className={`stock-mark mark-${symbol.charCodeAt(0) % 4} ${small ? "small" : ""}`}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}

function Modal({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? [],
      );
    (focusable()[0] ?? dialog)?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = before;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Chart({ stock, safe }: { stock: Stock; safe: boolean }) {
  const points = [...stock.history, stock.price].map((value, index) => ({
    index,
    price: value,
  }));
  const plan = safe ? stock.plan : null;
  return (
    <div
      className="chart-wrap"
      role="img"
      aria-label={`${stock.symbol} historical price line. Latest supplied price ${price(stock.price)}. ${plan ? `Entry range ${range(plan.entry_low, plan.entry_high)}.` : "Trading overlays unavailable."}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 16, right: 4, bottom: 0, left: -18 }}
        >
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#107366" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#107366" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="#e7e9e5"
            strokeDasharray="3 5"
          />
          <XAxis dataKey="index" hide />
          <YAxis
            orientation="right"
            tickFormatter={(v) => `$${v}`}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#929b98", fontSize: 11 }}
            domain={["auto", "auto"]}
            tickCount={4}
            width={54}
          />
          <Tooltip
            labelFormatter={() => "Supplied price history"}
            formatter={(v) => [price(Number(v)), "Price"]}
            contentStyle={{
              border: "1px solid #e2e7e2",
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          {plan && (
            <ReferenceArea
              y1={plan.entry_low}
              y2={plan.entry_high}
              fill="#d8eee0"
              fillOpacity={0.6}
              ifOverflow="extendDomain"
            />
          )}
          {plan && (
            <ReferenceLine
              y={plan.reconsider}
              stroke="#d59984"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
          )}
          <Area
            type="monotone"
            dataKey="price"
            stroke="#16796b"
            strokeWidth={2.5}
            fill="url(#priceGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function PriceMap({ stock }: { stock: Stock }) {
  const plan = stock.plan;
  if (!plan) return null;
  const stops = [
    {
      name: "Reconsider below",
      value: price(plan.reconsider),
      tone: "red",
      label: "Review the setup",
      at: plan.reconsider,
    },
    {
      name: "Buy around",
      value: range(plan.entry_low, plan.entry_high),
      tone: "green",
      label: "Preferred entry",
      at: (plan.entry_low + plan.entry_high) / 2,
    },
    {
      name: "First profit area",
      value: range(plan.first_profit_low, plan.first_profit_high),
      tone: "purple",
      label: "Consider taking some",
      at: (plan.first_profit_low + plan.first_profit_high) / 2,
    },
    {
      name: "Strong profit area",
      value: range(plan.strong_profit_low, plan.strong_profit_high),
      tone: "blue",
      label: "A stronger scenario",
      at: (plan.strong_profit_low + plan.strong_profit_high) / 2,
    },
  ];
  const active =
    Math.abs(stock.price - stops[1].at) < Math.abs(stock.price - stops[2].at)
      ? 1
      : 2;
  return (
    <div className="price-map" aria-label="Your price plan">
      {stops.map((stop, i) => (
        <div
          className={`map-stop ${stop.tone} ${active === i ? "near-current" : ""}`}
          key={stop.name}
        >
          <div className="route-node">
            <span />
          </div>
          <p>{stop.name}</p>
          <strong>{stop.value}</strong>
          <small>{stop.label}</small>
        </div>
      ))}
    </div>
  );
}

function Score({
  label,
  value,
  tone,
  suffix,
}: {
  label: string;
  value: number | null;
  tone: string;
  suffix?: string;
}) {
  return (
    <div className="score">
      <div>
        <span>{label}</span>
        <strong className={tone}>
          {value ?? "—"}
          {value != null && <small>/100</small>}
        </strong>
      </div>
      <div className="score-track">
        <span
          style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
          className={tone}
        />
      </div>
      {suffix && <small>{suffix}</small>}
      {value == null && <small>Data missing</small>}
    </div>
  );
}

function TradeModal({
  trade,
  data,
  onClose,
  onSaved,
}: {
  trade: Trade;
  data: Dashboard;
  onClose: () => void;
  onSaved: (value: Dashboard) => void;
}) {
  const selling = trade.side === "sell";
  const [fill, setFill] = useState(
    data.mode === "demo" ? String(trade.stock.price) : "",
  );
  const [amount, setAmount] = useState(
    selling
      ? String(trade.position?.quantity ?? "")
      : data.mode === "demo"
        ? String(trade.stock.sizing.amount_eur || "")
        : "",
  );
  const [fx, setFx] = useState(String(data.settings.fx_usd_per_eur));
  const [fee, setFee] = useState("0");
  const [time, setTime] = useState(dublinInput(new Date()));
  const [offset, setOffset] = useState(dublinOffset(new Date()));
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"paper" | "manual">(
    data.mode === "demo" ? "paper" : "manual",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const fingerprint = useRef("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const numeric = [Number(fill), Number(amount), Number(fx), Number(fee)];
    if (
      numeric.some((v) => !Number.isFinite(v)) ||
      numeric.slice(0, 3).some((v) => v <= 0) ||
      numeric[3] < 0
    ) {
      setError(
        "Enter positive prices, amounts and exchange rates. Fees can be zero.",
      );
      return;
    }
    if (
      !selling &&
      Number(amount) + Number(fee) > data.portfolio.cash_eur + 0.000001
    ) {
      setError("The amount plus fees is more than the available cash.");
      return;
    }
    if (
      selling &&
      Number(amount) > (trade.position?.quantity ?? 0) + 0.00000001
    ) {
      setError("You cannot sell more shares than this position contains.");
      return;
    }
    const executed = new Date(`${time}:00${offset}`);
    if (Number.isFinite(executed.getTime()) && dublinInput(executed) !== time) {
      setError(
        "The selected offset does not match this Dublin time. Choose summer (+01:00) or winter (+00:00) as appropriate.",
      );
      return;
    }
    if (
      !Number.isFinite(executed.getTime()) ||
      executed.getTime() > Date.now() + 60000
    ) {
      setError("Use a valid execution time that is not in the future.");
      return;
    }
    setBusy(true);
    setError("");
    const input: TradeInput = {
      symbol: trade.stock.symbol,
      side: trade.side,
      price_usd: Number(fill),
      ...(selling
        ? { quantity: Number(amount) }
        : { amount_eur: Number(amount) }),
      fx_usd_per_eur: Number(fx),
      fee_eur: Number(fee),
      executed_at: executed.toISOString(),
      notes,
      mode: data.mode === "demo" ? "paper" : mode,
      idempotency_key: key.current,
    };
    const payload = JSON.stringify({ ...input, idempotency_key: undefined });
    if (fingerprint.current && fingerprint.current !== payload)
      key.current = crypto.randomUUID();
    fingerprint.current = payload;
    input.idempotency_key = key.current;
    try {
      onSaved(
        parseDashboard(
          await request("/api/trades", {
            method: "POST",
            body: JSON.stringify(input),
          }),
        ),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this record.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${selling ? "Record a sell" : "Record a buy"} · ${trade.stock.symbol}`}
      eyebrow={
        data.mode === "demo" ? "Paper trading only" : "Manual execution record"
      }
      onClose={onClose}
    >
      <p className="modal-intro">
        {data.mode === "demo"
          ? "Practice a fill with fictional funds. No order is sent and no real money is used."
          : "For a real record, first complete your trade in Trading 212, then enter your actual execution. This app never sends an order."}
      </p>
      <form onSubmit={submit} className="trade-form">
        {data.mode !== "demo" && (
          <label>
            Record type
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as "paper" | "manual");
                key.current = crypto.randomUUID();
              }}
            >
              <option value="manual">Actual manual execution</option>
            </select>
          </label>
        )}
        <div className="form-grid">
          <label>
            Execution price · USD
            <input
              type="number"
              inputMode="decimal"
              min="0.000001"
              step="any"
              required
              value={fill}
              onChange={(e) => setFill(e.target.value)}
              placeholder="Your actual fill"
            />
          </label>
          <label>
            {selling
              ? "Shares sold (fractions allowed)"
              : "Amount invested · EUR"}
            <input
              type="number"
              inputMode="decimal"
              min="0.000001"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            USD for €1
            <input
              type="number"
              min="0.000001"
              step="any"
              required
              value={fx}
              onChange={(e) => setFx(e.target.value)}
            />
          </label>
          <label>
            Total execution fees · EUR
            <input
              type="number"
              min="0"
              step="any"
              required
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
        </div>
        <p className="field-hint">
          {selling
            ? `Available: ${trade.position?.quantity.toFixed(6)} shares. Partial sales are supported.`
            : `Available cash: ${money(data.portfolio.cash_eur)}. The amount excludes your separately entered fees.`}{" "}
          Include any broker conversion costs in total fees.
        </p>
        <div className="form-grid execution-time">
          <label>
            Execution time · Dublin
            <input
              type="datetime-local"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label>
            Dublin clock offset
            <select value={offset} onChange={(e) => setOffset(e.target.value)}>
              <option value="+01:00">Summer · +01:00</option>
              <option value="+00:00">Winter · +00:00</option>
            </select>
          </label>
        </div>
        <label>
          What was your reason? <span className="muted">(optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            placeholder="The setup, your reasoning, and what to learn…"
            rows={3}
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            Save {data.mode === "demo" || mode === "paper" ? "paper " : ""}
            record
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SourceModal({
  source,
  onClose,
}: {
  source: Source;
  onClose: () => void;
}) {
  let link: string | null = null;
  try {
    if (
      source.url &&
      ["https:", "http:"].includes(new URL(source.url).protocol)
    )
      link = source.url;
  } catch {
    /* Invalid source URLs are shown as text only. */
  }
  return (
    <Modal
      title="Follow the source"
      eyebrow={source.provider}
      onClose={onClose}
    >
      <p className="modal-intro">{source.description}</p>
      <dl className="source-facts">
        <div>
          <dt>Reference</dt>
          <dd>{source.id}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{dateTime(source.published_at)}</dd>
        </div>
        <div>
          <dt>Retrieved</dt>
          <dd>{dateTime(source.retrieved_at)}</dd>
        </div>
        <div>
          <dt>Reporting period</dt>
          <dd>{source.reporting_period || "Not specified"}</dd>
        </div>
      </dl>
      <p className="eyebrow">Raw input</p>
      <pre className="source-json">
        {JSON.stringify(source.raw_value, null, 2) ?? "Not available"}
      </pre>
      <p className="eyebrow">Normalized input</p>
      <pre className="source-json">
        {JSON.stringify(source.normalized_value, null, 2) ?? "Not available"}
      </pre>
      {link ? (
        <a
          className="button primary"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open source <ExternalLink size={15} />
        </a>
      ) : (
        <p className="notice">
          <FlaskConical size={16} />
          This reference has no public URL. Its provenance and inputs are shown
          above.
        </p>
      )}
    </Modal>
  );
}

function Details({
  stock,
  onSource,
}: {
  stock: Stock;
  onSource: (value: Source) => void;
}) {
  function sourceButton(id: string) {
    const source = stock.sources.find((s) => s.id === id);
    return source ? (
      <button className="source-link" onClick={() => onSource(source)}>
        Source <ArrowUpRight size={12} />
      </button>
    ) : (
      <span className="muted">Source unavailable</span>
    );
  }
  return (
    <div className="stock-detail" id="why">
      {stock.research && <ObservedResearch stock={stock} onSource={onSource} />}
      <div className="detail-grid">
        <section className="card detail-card">
          <p className="eyebrow">
            <TrendingUp size={14} /> Why it could rise
          </p>
          {stock.reasons.slice(0, 3).map((r, i) => (
            <div className="reason" key={`${r.source_id}-${i}`}>
              <Check size={15} />
              <div>
                <p>{r.text}</p>
                {sourceButton(r.source_id)}
              </div>
            </div>
          ))}
          {!stock.reasons.length && (
            <p className="muted">No sourced reasons are available.</p>
          )}
        </section>
        <section className="card detail-card">
          <p className="eyebrow">
            <ShieldCheck size={14} /> What could go wrong
          </p>
          {stock.risks.slice(0, 3).map((r, i) => (
            <div className="reason risk-reason" key={`${r.source_id}-${i}`}>
              <AlertTriangle size={15} />
              <div>
                <p>{r.text}</p>
                {sourceButton(r.source_id)}
              </div>
            </div>
          ))}
          {!stock.risks.length && (
            <p className="muted">
              Risk information is missing. That does not mean risk is low.
            </p>
          )}
        </section>
      </div>
      <div className="detail-grid">
        <section className="card detail-card">
          <h3>What matters next</h3>
          {stock.next_events.slice(0, 5).map((event, i) => (
            <div className="next-event" key={i}>
              <div className="event-icon">
                <Clock3 size={16} />
              </div>
              <div>
                <strong>{event.label}</strong>
                {event.date && <small>{dateTime(event.date)}</small>}
                <p>{event.detail}</p>
                {sourceButton(event.source_id)}
              </div>
            </div>
          ))}
          {!stock.next_events.length && (
            <p className="muted">No sourced upcoming events are available.</p>
          )}
        </section>
        <section className="card detail-card">
          <h3>What changed</h3>
          {stock.changes.length ? (
            stock.changes.map((change, i) => (
              <div className="change" key={i}>
                <Activity size={15} />
                <p>{change}</p>
              </div>
            ))
          ) : (
            <p className="muted">
              No material changes since the last analysis.
            </p>
          )}
          <div className="data-freshness">
            <p className="eyebrow">Data behind this view</p>
            <dl>
              <div>
                <dt>Market · {stock.freshness.feed}</dt>
                <dd>{dateTime(stock.price_as_of || stock.freshness.market_at)}</dd>
              </div>
              <div>
                <dt>Financials</dt>
                <dd>{stock.freshness.financial_period || "Data missing"}</dd>
              </div>
              <div>
                <dt>News checked</dt>
                <dd>{dateTime(stock.freshness.news_checked_at)}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
      <details className="card advanced">
        <summary>
          <SlidersHorizontal size={16} /> Advanced details{" "}
          <ChevronDown size={16} />
        </summary>
        <div className="advanced-body">
          <p className="muted">
            {humanize(stock.company_type)} · Classification confidence{" "}
            {stock.classification_confidence} · {stock.classification_version}.
            Scores describe different things; opportunity never cancels out
            risk.
          </p>
          <div className="detail-grid">
            <ComponentScores
              title="Opportunity components"
              scores={stock.opportunity_components}
            />
            <ComponentScores
              title="Risk components"
              scores={stock.risk_components}
            />
          </div>
          {stock.plan && (
            <>
              <h3>Scenarios, not predictions</h3>
              <div className="scenario-grid">
                {stock.plan.scenarios.map((s) => (
                  <div key={s.name}>
                    <span>{humanize(s.name)}</span>
                    <strong>{range(s.low, s.high)}</strong>
                    {s.assumptions.map((a, i) => (
                      <p key={i}>{a}</p>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
          <h3>All source references</h3>
          <div className="source-list">
            {stock.sources.map((s) => (
              <button key={s.id} onClick={() => onSource(s)}>
                {s.description}
                <span>
                  {s.provider}
                  <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

const observedMetricLabels: Record<string, string> = {
  revenue_growth_pct: "Revenue growth · year on year",
  net_margin_pct: "Net margin",
  fcf_margin_pct: "Free cash flow margin",
  debt_to_assets_pct: "Debt / assets",
  cash_runway_months: "Cash runway at observed burn rate",
  revenue_usd: "Reported revenue",
  free_cash_flow_usd: "Reported free cash flow",
  cash_usd: "Cash and equivalents",
  net_income_usd: "Reported net income",
  operating_cash_flow_usd: "Operating cash flow",
  capital_expenditure_usd: "Capital expenditure",
  assets_usd: "Total assets",
  dollar_volume: "Average daily dollar volume · 20 sessions",
  diluted_weighted_average_shares: "Diluted weighted-average shares",
  annual_diluted_eps_usd: "Annual diluted EPS",
  earnings_in_days: "Days until expected earnings",
};

function observedMetricValue(name: string, value: number) {
  if (name.endsWith("_pct")) return `${value.toFixed(1)}%`;
  if (name.endsWith("_months")) return `${value.toFixed(1)} months`;
  if (name.endsWith("_days")) return `${value.toFixed(0)} days`;
  if (name.endsWith("_usd") || name === "dollar_volume") {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  return new Intl.NumberFormat("en-IE", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function webLink(value: string | null | undefined) {
  try { return value && ["http:", "https:"].includes(new URL(value).protocol) ? value : null; }
  catch { return null; }
}

function ObservedResearch({ stock, onSource }: { stock: Stock; onSource: (source: Source) => void }) {
  const research = stock.research;
  if (!research) return null;
  const values = { ...research.raw_metrics, ...research.metrics };
  const metrics = Object.keys(observedMetricLabels).filter((name) => Number.isFinite(values[name]));
  const sourceFor = (name: string) => stock.sources.find((item) => item.id === research.metric_sources[name]);
  return (
    <>
      <section className="card observed-research">
        <div className="section-heading">
          <h3><BookOpen size={16} /> Reported company data</h3>
          <span>Observed values</span>
        </div>
        <p className="research-period">Financial reporting period: {research.financial_period || "Unavailable"}. Source details show the period and calculation for each metric.</p>
        {metrics.length ? (
          <dl className="observed-metrics">
            {metrics.slice(0, 8).map((name) => {
              const source = sourceFor(name);
              return <div key={name}>
                <dt>{observedMetricLabels[name]}</dt>
                <dd>{observedMetricValue(name, values[name])}</dd>
                {source && <button className="source-link" onClick={() => onSource(source)}>Source <ArrowUpRight size={12} /></button>}
              </div>;
            })}
          </dl>
        ) : <p className="research-period">Company metrics will appear when the configured feeds return verified data.</p>}
        {!stock.plan && <div className="research-plan-note"><ShieldCheck size={17} /><p>A trade plan is not available yet. Reported metrics and headlines alone do not establish all the required inputs.</p></div>}
        {!!research.missing_reasons?.length && <details className="research-coverage-details"><summary>What is still missing ({research.missing_reasons.length})</summary><ul>{research.missing_reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}
      </section>
      <div className="detail-grid">
        <section className="card detail-card observed-news">
          <h3>Recent news</h3>
          {research.news?.length ? research.news.slice(0, 5).map((item, index) => {
            const link = webLink(item.url);
            const source = stock.sources.find((candidate) => candidate.id === item.source_id);
            return <article key={`${item.source_id}-${index}`}>
              {link ? <a href={link} target="_blank" rel="noopener noreferrer">{item.title}<ExternalLink size={12} /></a> : <p>{item.title}</p>}
              <small>{dateTime(item.published_at)}</small>
              {source && <button className="source-link" onClick={() => onSource(source)}>Source <ArrowUpRight size={12} /></button>}
            </article>;
          }) : <p className="muted">No verified news is available for this stock.</p>}
        </section>
        <section className="card detail-card observed-coverage">
          <h3>Data coverage</h3>
          {Object.entries(research.coverage ?? {}).map(([name, health]) => <div key={name}>
            <p><strong>{humanize(name)}</strong><span className={health.status === "current" ? "positive" : "muted"}>{humanize(health.status)}</span></p>
            <small>{health.checked_at ? `Last successful check: ${dateTime(health.checked_at)}` : "Awaiting the first successful check"}</small>
            {health.message && <small>{health.message}</small>}
          </div>)}
        </section>
      </div>
    </>
  );
}

function ComponentScores({
  title,
  scores,
}: {
  title: string;
  scores: ComponentScore[];
}) {
  return (
    <section>
      <h4>{title}</h4>
      {scores.map((c) => (
        <div className="component-score" key={c.name}>
          <span>{humanize(c.name)}</span>
          <strong>
            {Number(((c.score * c.weight) / 100).toFixed(1))} / {c.weight}
          </strong>
        </div>
      ))}
    </section>
  );
}

function SettingsView({
  data,
  onSaved,
}: {
  data: Dashboard;
  onSaved: (value: Dashboard) => void;
}) {
  const [settings, setSettings] = useState<Settings>(data.settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      onSaved(
        parseDashboard(
          await request("/api/settings", {
            method: "PATCH",
            body: JSON.stringify(settings),
          }),
        ),
      );
      setMessage(
        "Preferences saved. Holding-period changes recalculate candidate plans; owned positions keep their original levels.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="settings-layout" onSubmit={save}>
      <section className="card settings-card">
        <p className="eyebrow">Make this your own</p>
        <h2>A plan that fits your pace.</h2>
        <p className="muted">
          These preferences change deterministic calculations. They never change
          a result to fit your goal.
        </p>
        <fieldset>
          <legend>How long are you thinking of holding?</legend>
          <div className="option-grid">
            {(
              [
                [
                  "weeks",
                  "A few weeks",
                  "More focus on price and near-term events",
                ],
                [
                  "months",
                  "A few months",
                  "A balance of business and price behaviour",
                ],
                [
                  "years",
                  "1+ years",
                  "More focus on lasting business strength",
                ],
              ] as const
            ).map(([value, label, detail]) => (
              <label
                key={value}
                className={`option ${settings.horizon === value ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="horizon"
                  value={value}
                  checked={settings.horizon === value}
                  onChange={() => setSettings({ ...settings, horizon: value })}
                />
                <strong>{label}</strong>
                <span>{detail}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Your experimental position size</legend>
          <div className="size-options">
            {(
              [
                ["small", "Small"],
                ["medium", "Medium"],
                ["large", "Large speculative"],
                ["none", "No position"],
              ] as const
            ).map(([value, label]) => (
              <label
                className={settings.size === value ? "selected" : ""}
                key={value}
              >
                <input
                  type="radio"
                  name="size"
                  checked={settings.size === value}
                  onChange={() => setSettings({ ...settings, size: value })}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="field-hint">
            Even a small position can lose its full value. Risk never increases
            just because a previous trade lost.
          </p>
        </fieldset>
        <div className="toggle-row">
          <div>
            <h3>Shadow mode</h3>
            <p>Track qualifying setups in a separate simulated ledger.</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.shadow_enabled}
              onChange={(e) =>
                setSettings({ ...settings, shadow_enabled: e.target.checked })
              }
            />
            <span />
            <span className="sr-only">Enable shadow mode</span>
          </label>
        </div>
        <fieldset>
          <legend>Conversion and trading costs</legend>
          <p className="field-hint">
            Estimates for position sizing. Record actual conversion and fees on
            every fill.
          </p>
          <div className="form-grid">
            <label>
              USD for €1
              <input
                type="number"
                min="0.000001"
                step="any"
                required
                value={settings.fx_usd_per_eur}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    fx_usd_per_eur: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              FX fee · %
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                required
                value={Number((settings.fx_fee_pct * 100).toFixed(6))}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    fx_fee_pct: Number(e.target.value) / 100,
                  })
                }
              />
            </label>
            <label>
              Fixed fee · EUR
              <input
                type="number"
                min="0"
                step="any"
                required
                value={settings.fixed_fee_eur}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    fixed_fee_eur: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Minimum order · EUR
              <input
                type="number"
                min="0"
                step="any"
                required
                value={settings.min_order_eur}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    min_order_eur: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success-text" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}
          Save preferences
        </button>
      </section>
      <aside className="settings-aside">
        <div className="card">
          <ShieldCheck size={24} />
          <h3>You stay in control.</h3>
          <p>
            Waypoint suggests reviews and keeps records. You make every decision
            and place any real trades yourself.
          </p>
          <p>Borrowing, leverage, and automatic orders are outside this app.</p>
        </div>
        <div className="card">
          <FlaskConical size={24} />
          <h3>Learn before you risk.</h3>
          <p>
            Paper records and shadow signals let you evaluate the rules without
            using your real €20.
          </p>
          <p>
            The €200 goal is an objective, never evidence that a strategy works.
          </p>
        </div>
      </aside>
    </form>
  );
}

function ResearchView({ data }: { data: Dashboard }) {
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    setError("");
    try {
      setReport(await request<BacktestReport>("/api/backtest"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest unavailable.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="research-view">
      <div className="research-banner">
        <div>
          <span className="eyebrow">Practice, observe, improve</span>
          <h2>A place to test your thinking.</h2>
          <p>
            Study the rules with simulated outcomes before putting money at
            risk.
          </p>
        </div>
        <FlaskConical size={72} strokeWidth={1} />
      </div>
      <div className="research-stats">
        <Stat label="Shadow signals" value={String(data.shadow.signals)} />
        <Stat label="Still being tracked" value={String(data.shadow.open)} />
        <Stat label="Completed" value={String(data.shadow.closed)} />
        <Stat
          label="Simulated result"
          value={signed(data.shadow.realized_pnl_eur)}
        />
      </div>
      <section className="card research-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Deterministic experiment</p>
            <h2>Walk-forward backtest</h2>
          </div>
          <button className="button primary" onClick={run} disabled={loading}>
            {loading ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <FlaskConical size={16} />
            )}
            Run demo backtest
          </button>
        </div>
        <p className="muted">
          A price-only demonstration with next-bar execution and trading costs.
          It is not evidence of future performance or a validated
          stock-selection strategy.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {report ? (
          <>
            <p className="notice">
              <HelpCircle size={17} />
              {report.description}
            </p>
            <div className="backtest-metrics">
              {Object.entries(report.metrics).map(([label, value]) => (
                <Stat
                  key={label}
                  label={humanize(label)}
                  value={
                    typeof value === "number"
                      ? String(Number(value.toFixed(4)))
                      : typeof value === "string"
                        ? value
                        : JSON.stringify(value)
                  }
                />
              ))}
            </div>
            <details className="backtest-details">
              <summary>
                Inspect {report.trades.length} trades and model assumptions{" "}
                <ChevronDown size={16} />
              </summary>
              <pre className="source-json">
                {JSON.stringify({ ...report, equity: undefined }, null, 2)}
              </pre>
            </details>
          </>
        ) : (
          <Empty
            icon={<Activity size={30} />}
            title="Test the engine, not your luck."
          >
            Run a reproducible fixture backtest to inspect its results and trade
            records.
          </Empty>
        )}
      </section>
      <p className="page-note">
        Model {data.model_version} · Shadow signals are separate from your
        manually recorded portfolio.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function Waypoint({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [connected, setConnected] = useState(false);
  const [received, setReceived] = useState(0);
  const [clock, setClock] = useState(0);
  const [error, setError] = useState("");
  const [page, setPage] = useState<Page>("today");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [trade, setTrade] = useState<Trade | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [retry, setRetry] = useState(0);
  const apply = useCallback((snapshot: Dashboard) => {
    setData(snapshot);
    setReceived(Date.now());
    setClock(Date.now());
    setConnected(true);
  }, []);
  useEffect(() => {
    let active = true;
    let pending = false;
    let abort: AbortController | null = null;
    async function poll() {
      if (pending || document.hidden) return;
      pending = true;
      abort = new AbortController();
      const timeout = window.setTimeout(() => abort?.abort(), 15000);
      try {
        const d = parseDashboard(await request("/api/dashboard", { signal: abort.signal }));
        if (active) {
          apply(d);
          setError("");
        }
      } catch (reason) {
        if (active) {
          setConnected(false);
          setError(reason instanceof Error ? reason.message : "Your workspace is temporarily unavailable. Retrying automatically.");
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    }
    void poll();
    const snapshots = window.setInterval(() => { void poll(); }, 30000);
    const timer = window.setInterval(() => setClock(Date.now()), 5000);
    const visible = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      abort?.abort();
      clearInterval(snapshots);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [apply, retry]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timeout);
  }, [toast]);
  const closeTrade = useCallback(() => setTrade(null), []);
  const closeSource = useCallback(() => setSource(null), []);
  const freshConnection = connected && received > 0 && clock - received < 75000;
  const stockSafe = (s: Stock) =>
    freshConnection &&
    s.freshness.status === "current" &&
    ["DEMO DATA", "REAL-TIME"].includes(s.freshness.feed) &&
    Number.isFinite(Date.parse(s.freshness.market_at ?? "")) &&
    clock - Date.parse(s.freshness.market_at ?? "") < 120000;
  const selected =
    data?.stocks.find((s) => s.symbol === symbol) ??
    data?.stocks.find(
      (s) => s.plan && s.state !== "SKIP" && s.state !== "NO_SETUP",
    ) ??
    data?.stocks[0];
  const position = data?.portfolio.positions.find(
    (p) => p.symbol === selected?.symbol,
  );
  const safe = !!selected && stockSafe(selected);
  const livePlanPaused = data?.mode === "live" && !selected?.plan;
  async function mutate(path: string, body?: unknown, key = path) {
    setBusy(key);
    setError("");
    try {
      apply(
        parseDashboard(
          await request(path, {
            method: "POST",
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
        ),
      );
      setToast(
        path.includes("refresh")
          ? "Analysis refreshed from the configured data sources."
          : "Demo price updated. The state engine recalculated.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed.");
    } finally {
      setBusy("");
    }
  }
  const navigation: { id: Page; label: string; icon: ReactNode }[] = [
    { id: "today", label: "Today", icon: <LayoutDashboard size={19} /> },
    { id: "positions", label: "My positions", icon: <Wallet size={19} /> },
    { id: "journal", label: "Trade journal", icon: <BookOpen size={19} /> },
    { id: "research", label: "Research lab", icon: <FlaskConical size={19} /> },
    { id: "settings", label: "Preferences", icon: <Settings2 size={19} /> },
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <Link className="brand" href="/waypoint" aria-label="Waypoint home">
          <span>
            <Navigation size={22} fill="currentColor" />
          </span>
          waypoint<span className="brand-period">.</span>
        </Link>
        <p className="sidebar-caption">A CLEARER NEXT STEP</p>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              onClick={() => {
                setPage(item.id);
                setShowWhy(false);
              }}
              className={page === item.id ? "active" : ""}
              aria-current={page === item.id ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "positions" &&
                !!data?.portfolio.positions.length && (
                  <small>{data.portfolio.positions.length}</small>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="paper-callout">
            <div className="paper-icon">
              <FlaskConical size={19} />
            </div>
            <strong>Small steps. Real learning.</strong>
            <p>
              Explore with paper trades.
              <br />
              Build understanding first.
            </p>
            <button onClick={() => setPage("research")}>
              Visit the research lab <ArrowRight size={14} />
            </button>
          </div>
          <div className="profile">
            <div>
              <Compass size={16} />
            </div>
            <span>
              Personal workspace<small>Private · No auto-trading</small>
            </span>
          </div>
        </div>
      </aside>
      <main id="main-content">
        <header className="topbar">
          <span>
            <span className={`connection-dot ${freshConnection ? "on" : ""}`} />
            {freshConnection
              ? "Workspace connected"
              : "Connecting to your workspace"}
          </span>
          <div>
            <span className="timezone">Europe / Dublin</span>
            <span className="workspace-label">
              <ShieldCheck size={14} /> Personal workspace
            </span>
            <button
              className="text-button sign-out-button"
              disabled={busy === "sign-out"}
              onClick={async () => {
                setBusy("sign-out");
                try { await onSignOut(); }
                catch { setError("Unable to sign out. Please try again."); }
                finally { setBusy(""); }
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-header">
            <div>
              <p className="eyebrow">
                {page === "today"
                  ? "Your next step, made clearer"
                  : "Your personal workspace"}
              </p>
              <h1>
                {navigation.find((n) => n.id === page)?.label}
                {page === "today" && <span className="heading-dot">.</span>}
              </h1>
              <p>
                {page === "today"
                  ? data
                    ? new Intl.DateTimeFormat("en-IE", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        timeZone: "Europe/Dublin",
                      }).format(new Date(data.now))
                    : "A little patience is part of the plan."
                  : (
                      {
                        positions:
                          "Your open positions. One clear plan for each.",
                        journal: "Every decision is an opportunity to learn.",
                        research:
                          "Explore what happened. Question what it means.",
                        settings: "Keep the experiment suited to you.",
                      } as Record<string, string>
                    )[page]}
              </p>
            </div>
            <div className="header-actions">
              {data && (
                <span className={`mode-badge ${data.mode}`}>
                  <FlaskConical size={13} />
                  {data.mode === "demo" ? "DEMO DATA" : "PROVIDER DATA"}
                </span>
              )}
              <button
                aria-label="Refresh analysis"
                className="button secondary refresh-button"
                disabled={!data || !!busy}
                onClick={() => mutate("/api/refresh")}
              >
                <RefreshCw
                  size={15}
                  className={busy === "/api/refresh" ? "spin" : ""}
                />
                <span>Refresh analysis</span>
              </button>
            </div>
          </div>
          {data?.mode === "demo" && (
            <div className="demo-strip">
              <FlaskConical size={16} />
              <p>
                <strong>A practice space.</strong> Prices and company facts are
                fictional fixtures. Every record here is a paper trade.
              </p>
              <span>No real money</span>
            </div>
          )}
          {data?.mode === "live" && Object.values(data.provider_health ?? {}).some((health) => health.code === "not_configured") && (
            <div className="demo-strip live-setup-strip" role="status">
              <Activity size={16} />
              <p><strong>Limited research coverage.</strong> View available price history and news below. Some company data and live FX are unavailable; live trade plans remain paused.</p>
            </div>
          )}
          {(error || (data && !freshConnection)) && (
            <div className="connection-alert" role="status">
              <WifiOff size={18} />
              <div>
                <strong>Signals paused</strong>
                <p>
                  {error ||
                    "Your workspace needs a fresh update. No current action is being suggested."}
                </p>
              </div>
              <button
                onClick={() => setRetry((r) => r + 1)}
                className="text-button"
              >
                Reconnect <RefreshCw size={14} />
              </button>
            </div>
          )}
          {!data ? (
            <section className="card loading-card">
              <Empty
                icon={
                  error ? (
                    <WifiOff size={30} />
                  ) : (
                    <Loader2 className="spin" size={30} />
                  )
                }
                title={
                  error
                    ? "Your workspace needs a moment."
                    : "Finding your bearings…"
                }
              >
                {error ? (
                  <>
                    Check that the data connection is configured, then reconnect.
                    Prices and signals appear when verified data arrives.
                  </>
                ) : (
                  "Loading your account, plans, and latest data."
                )}
              </Empty>
            </section>
          ) : (
            <>
              {page === "today" && (
                <>
                  <section className="account-overview">
                    <div className="account-primary">
                      <span className="eyebrow">
                        {data.mode === "demo"
                          ? "Paper account"
                          : "Recorded account"}
                      </span>
                      <div className="account-amount">
                        {money(data.portfolio.total_eur)}
                        <span>
                          <ArrowRight size={16} />
                          {money(data.portfolio.goal_eur)} <small>goal</small>
                        </span>
                      </div>
                      <p
                        className={
                          data.portfolio.return_pct >= 0
                            ? "positive"
                            : "negative"
                        }
                      >
                        {data.portfolio.return_pct >= 0 ? (
                          <ArrowUpRight size={15} />
                        ) : (
                          <ArrowDownRight size={15} />
                        )}{" "}
                        {Math.abs(data.portfolio.return_pct) < 0.005
                          ? "0.00"
                          : data.portfolio.return_pct.toFixed(2)}
                        % since the start{" "}
                        <span>· An experiment, not a promise</span>
                      </p>
                      <div className="goal-track">
                        <span
                          style={{
                            width: `${Math.min(100, Math.max(0, (data.portfolio.total_eur / data.portfolio.goal_eur) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="account-stats">
                      <Stat
                        label="Cash available"
                        value={money(data.portfolio.cash_eur)}
                      />
                      <Stat
                        label="Open positions"
                        value={String(data.portfolio.positions.length)}
                      />
                      <Stat
                        label="Watching"
                        value={String(data.stocks.length)}
                        hint="Ordinary US shares"
                      />
                    </div>
                  </section>
                  <div className="dashboard-grid">
                    <div className="main-column">
                      <div className="section-heading setup-section-heading">
                        <h2>
                          <span className="tiny-compass">
                            <Compass size={15} />
                          </span>
                          {symbol
                            ? "Your selected setup"
                            : "Your next waypoint"}
                        </h2>
                        <span>
                          {
                            data.stocks.filter(
                              (s) =>
                                s.plan &&
                                !["SKIP", "NO_SETUP"].includes(s.state),
                            ).length
                          }{" "}
                          setups to explore
                        </span>
                      </div>
                      {selected ? (
                        <article className="card setup-card">
                          <div className="setup-header">
                            <div className="company-heading">
                              <StockMark symbol={selected.symbol} />
                              <div>
                                <h2>{selected.name}</h2>
                                <p>
                                  {selected.symbol}
                                  <span>·</span>
                                  {selected.sector}
                                </p>
                              </div>
                            </div>
                            <button
                              className="icon-button help-button"
                              title="Why this setup?"
                              aria-label="Show reasons and sources"
                              onClick={() => setShowWhy((v) => !v)}
                            >
                              <HelpCircle size={20} />
                            </button>
                          </div>
                          <div className="setup-state">
                            <div>
                              <Badge state={selected.state} safe={safe} large />
                              <p>
                                {livePlanPaused
                                  ? "Research inputs are incomplete; no trade plan is available."
                                  : safe
                                  ? stateInfo[selected.state]?.short
                                  : "Fresh market data is needed before a next step."}
                              </p>
                            </div>
                            <div className="current-price">
                              <strong>{price(selected.price)}</strong>
                              <span
                                className={
                                  (selected.change_pct ?? 0) >= 0
                                    ? "positive"
                                    : "negative"
                                }
                              >
                                {selected.change_pct != null &&
                                selected.change_pct >= 0
                                  ? "+"
                                  : ""}
                                {selected.change_pct == null
                                  ? "Change unavailable"
                                  : `${selected.change_pct.toFixed(2)}%`}{" "}
                                <small>vs. previous close</small>
                              </span>
                            </div>
                          </div>
                          <div className="explanation">
                            <MapPin size={18} />
                            <p>
                              {livePlanPaused
                                ? "Available prices and news are real observations. They do not yet establish all the inputs required for a live trade plan."
                                : safe
                                ? selected.explanation
                                : "This is the last received price. Actionable labels and the trade plan are paused until the data is current."}
                            </p>
                          </div>
                          {position && (
                            <div className="owned-summary">
                              <Stat
                                label="Bought around"
                                value={price(position.average_price_usd)}
                              />
                              <Stat
                                label="Invested"
                                value={money(position.cost_eur)}
                              />
                              <Stat
                                label="Current result"
                                value={signed(position.unrealized_pnl_eur)}
                              />
                            </div>
                          )}
                          {safe && selected.plan ? (
                            <PriceMap stock={selected} />
                          ) : (
                            <div className="no-plan">
                              <ShieldCheck size={20} />
                              <span>
                                {livePlanPaused
                                  ? "Live trade plans are paused while required research inputs are missing."
                                  : safe
                                  ? "No qualifying trade plan. Sitting this one out is a valid outcome."
                                  : "The price plan will return with fresh data."}
                              </span>
                            </div>
                          )}
                          <div className="chart-heading">
                            <span>THE PRICE, IN PERSPECTIVE</span>
                            <div>
                              <span className="legend-dot" />{" "}
                              {selected.freshness.feed}
                            </div>
                          </div>
                          <Chart stock={selected} safe={safe} />
                          <div className="chart-footer">
                            <span>
                              {selected.price_basis === "completed_close" ? "Completed-session historical closes" : "Supplied historical closes + latest quote"}
                            </span>
                            <span>
                              {selected.price_basis === "completed_close" && selected.price_as_of
                                ? `Session ${new Date(selected.price_as_of).toLocaleDateString("en-IE", { timeZone: "America/New_York", day: "numeric", month: "short", year: "numeric" })}`
                                : `Updated ${dateTime(selected.freshness.market_at, true)} Dublin`}
                            </span>
                          </div>
                          <div className="setup-action">
                            <div>
                              <span>
                                {position
                                  ? "Position value"
                                  : "Suggested experimental amount"}
                              </span>
                              <strong>
                                {position
                                  ? money(position.value_eur)
                                  : safe && selected.sizing.viable
                                    ? money(selected.sizing.amount_eur)
                                    : "No position"}
                              </strong>
                              <small>
                                {position
                                  ? `${position.quantity.toFixed(6)} shares · ${position.mode}`
                                  : safe
                                    ? selected.sizing.reason
                                    : livePlanPaused ? "Required research inputs are missing" : "Waiting for current data"}
                              </small>
                            </div>
                            <div className="setup-buttons">
                              <button
                                className="button secondary"
                                onClick={() => setShowWhy((v) => !v)}
                              >
                                <HelpCircle size={16} />
                                {showWhy ? "Less detail" : "Why this setup?"}
                              </button>
                              <button
                                className="button primary"
                                disabled={
                                  !freshConnection ||
                                  (data.mode === "demo" &&
                                    (!safe ||
                                      (!position && !selected.sizing.viable)))
                                }
                                onClick={() =>
                                  setTrade({
                                    stock: selected,
                                    side: position ? "sell" : "buy",
                                    position,
                                  })
                                }
                              >
                                {data.mode === "demo"
                                  ? position
                                    ? "Record paper sell"
                                    : "Record paper buy"
                                  : position
                                    ? "I sold this"
                                    : "I bought this"}
                                <ArrowRight size={16} />
                              </button>
                            </div>
                          </div>
                          {safe &&
                            selected.plan &&
                            (position || selected.sizing.viable) && (
                              <p className="risk-note">
                                Planned downside ~
                                {money(selected.sizing.planned_downside_eur)} ·
                                First profit ~
                                {money(selected.sizing.first_profit_eur)}.
                                Actual losses can be higher if the price moves
                                suddenly past the reconsider level.
                              </p>
                            )}
                        </article>
                      ) : (
                        <div className="card">
                          <Empty
                            title="No trade today."
                            icon={<ShieldCheck size={30} />}
                          >
                            No current setup meets the requirements. Keeping
                            your cash is a valid next step.
                          </Empty>
                        </div>
                      )}
                      {selected && (
                        <section className="card confidence-card">
                          <Score
                            label="Opportunity"
                            value={selected.opportunity}
                            tone="green"
                          />
                          <Score
                            label="Risk"
                            value={selected.risk}
                            tone="orange"
                          />
                          <div className="confidence">
                            <span>Confidence</span>
                            <strong>
                              {freshConnection
                                ? humanize(selected.confidence_label)
                                : "Unavailable"}
                            </strong>
                            <small>
                              {freshConnection
                                ? `${selected.confidence}/100 · Data and model agreement`
                                : "Reconnect to reassess"}
                            </small>
                          </div>
                        </section>
                      )}
                      {showWhy && selected && (
                        <Details stock={selected} onSource={setSource} />
                      )}
                    </div>
                    <aside className="right-column">
                      <section className="card watchlist-card">
                        <div className="section-heading">
                          <h2>Your watchlist</h2>
                          <span className="count-badge">
                            {data.stocks.length}
                          </span>
                        </div>
                        <p className="card-subtitle">
                          A short list. A clearer focus.
                        </p>
                        <div className="watchlist">
                          {data.stocks.map((stock) => (
                            <button
                              key={stock.symbol}
                              className={`watch-item ${selected?.symbol === stock.symbol ? "selected" : ""}`}
                              onClick={() => {
                                setSymbol(stock.symbol);
                                setShowWhy(false);
                              }}
                            >
                              <StockMark symbol={stock.symbol} small />
                              <div className="watch-name">
                                <strong>{stock.symbol}</strong>
                                <span>{stock.name}</span>
                              </div>
                              <div className="watch-price">
                                <strong>{price(stock.price)}</strong>
                                <Badge
                                  state={stock.state}
                                  safe={stockSafe(stock)}
                                />
                              </div>
                            </button>
                          ))}
                        </div>
                        <div className="watchlist-footer">
                          <span
                            className={`connection-dot ${freshConnection ? "on" : ""}`}
                          />
                          {freshConnection
                            ? "Updates arrive automatically"
                            : "Updates paused"}
                        </div>
                      </section>
                      <section className="patience-card">
                        <div>
                          <Compass size={23} />
                          <span>A GOOD RULE TO KEEP</span>
                        </div>
                        <h3>
                          You don’t need to
                          <br />
                          trade every day.
                        </h3>
                        <p>
                          Wait for the setup to meet your plan. “No trade” is a
                          decision, too.
                        </p>
                        <div className="decorative-route" aria-hidden="true">
                          <span />
                          <i />
                          <span />
                          <i />
                          <Navigation size={19} />
                        </div>
                      </section>
                      <section className="card market-card">
                        <div className="section-heading">
                          <h3>
                            <Clock3 size={16} /> Market context
                          </h3>
                          <span
                            className={`market-pill ${data.market.is_open ? "open" : ""}`}
                          >
                            {data.market.is_open ? "Open" : "Closed"}
                          </span>
                        </div>
                        <p>{data.market.label}</p>
                        {!data.market.is_open && (
                          <small>
                            Next open: {dateTime(data.market.next_open)} Dublin
                          </small>
                        )}
                        <div className="market-divider" />
                        <span>Last analysis refresh</span>
                        <strong>{dateTime(data.last_slow_refresh)}</strong>
                        <small className="provider-label">
                          {data.provider_status}
                        </small>
                        {data.mode === "live" && (
                          <div className="fx-context">
                            <span>Account conversion · EUR → USD</span>
                            <strong>€1 = ${data.settings.fx_usd_per_eur.toFixed(4)}</strong>
                            <small>{data.fx?.health?.status === "current" && Math.abs(Number(data.fx.rate) - data.settings.fx_usd_per_eur) < 0.00000001 ? `Provider rate · ${dateTime(data.fx.timestamp)}` : "Saved account rate · live FX is not currently verified"}</small>
                          </div>
                        )}
                      </section>
                      {!!data.alerts.length && (
                        <section className="card alerts-card">
                          <h3>
                            <Activity size={16} /> What just changed
                          </h3>
                          {data.alerts.slice(0, 3).map((alert) => (
                            <div key={alert.id}>
                              <span>
                                {alert.symbol}{" "}
                                <small>
                                  {dateTime(alert.created_at, true)}
                                </small>
                              </span>
                              <p>
                                {freshConnection
                                  ? alert.message
                                  : "A previous signal is stored. Reconnect to review current status."}
                              </p>
                            </div>
                          ))}
                        </section>
                      )}
                    </aside>
                  </div>
                  {data.mode === "demo" && (
                    <section className="demo-controls">
                      <div>
                        <span className="demo-icon">
                          <FlaskConical size={20} />
                        </span>
                        <div>
                          <h3>Take the engine for a test drive.</h3>
                          <p>
                            Move RKLB to a scenario. Record a paper buy first to
                            explore position states.
                          </p>
                        </div>
                      </div>
                      <div>
                        {(
                          [
                            ["wait", "Wait"],
                            ["entry", "Entry area"],
                            ["profit", "Profit area"],
                            ["warning", "Price warning"],
                            ["exit", "Reconsider"],
                          ] as const
                        ).map(([scenario, label]) => (
                          <button
                            key={scenario}
                            disabled={!!busy || !freshConnection}
                            onClick={() =>
                              mutate(
                                "/api/demo/step",
                                { scenario, symbol: "RKLB" },
                                scenario,
                              )
                            }
                          >
                            {busy === scenario ? (
                              <Loader2 className="spin" size={13} />
                            ) : null}
                            {label}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
              {page === "positions" && (
                <>
                  <section className="card portfolio-summary">
                    <Stat
                      label="Total account"
                      value={money(data.portfolio.total_eur)}
                    />
                    <Stat
                      label="Invested"
                      value={money(data.portfolio.invested_eur)}
                    />
                    <Stat
                      label="Unrealized result"
                      value={signed(data.portfolio.unrealized_pnl_eur)}
                    />
                    <Stat
                      label="Realized result"
                      value={signed(data.portfolio.realized_pnl_eur)}
                    />
                  </section>
                  {!data.portfolio.positions.length ? (
                    <section className="card">
                      <Empty
                        title="Room for your first paper position."
                        icon={<Wallet size={30} />}
                      >
                        Your recorded purchases will appear here with their next
                        price levels. Explore a setup on Today, then record a
                        paper buy.
                      </Empty>
                      <div className="empty-action">
                        <button
                          className="button primary"
                          onClick={() => setPage("today")}
                        >
                          Explore today’s setups <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                  ) : (
                    <div className="positions-grid">
                      {data.portfolio.positions.map((p) => {
                        const stock = data.stocks.find(
                          (s) => s.symbol === p.symbol,
                        );
                        return (
                          <section
                            className="card position-card"
                            key={`${p.symbol}-${p.mode}`}
                          >
                            <div className="section-heading">
                              <div className="company-heading">
                                <StockMark symbol={p.symbol} />
                                <div>
                                  <h2>{p.symbol}</h2>
                                  <p>
                                    {p.mode === "paper"
                                      ? "Paper position"
                                      : "Manual record"}
                                  </p>
                                </div>
                              </div>
                              {stock && (
                                <Badge
                                  state={stock.state}
                                  safe={stockSafe(stock)}
                                />
                              )}
                            </div>
                            <div className="position-value">
                              <strong>{money(p.value_eur)}</strong>
                              <span
                                className={
                                  p.unrealized_pnl_eur >= 0
                                    ? "positive"
                                    : "negative"
                                }
                              >
                                {signed(p.unrealized_pnl_eur)} current result
                              </span>
                            </div>
                            <div className="owned-summary">
                              <Stat
                                label="Average fill"
                                value={price(p.average_price_usd)}
                              />
                              <Stat
                                label="Shares"
                                value={p.quantity.toFixed(6)}
                              />
                              <Stat label="Cost" value={money(p.cost_eur)} />
                            </div>
                            {stock && stockSafe(stock) && stock.plan && (
                              <div className="position-levels">
                                <div>
                                  <span>First profit area</span>
                                  <strong>
                                    {range(
                                      stock.plan.first_profit_low,
                                      stock.plan.first_profit_high,
                                    )}
                                  </strong>
                                </div>
                                <div>
                                  <span>Reconsider below</span>
                                  <strong>
                                    {price(stock.plan.reconsider)}
                                  </strong>
                                </div>
                              </div>
                            )}
                            <div className="modal-actions">
                              <button
                                className="button secondary"
                                onClick={() => {
                                  setSymbol(p.symbol);
                                  setPage("today");
                                  setShowWhy(true);
                                }}
                              >
                                Review plan
                              </button>
                              <button
                                className="button primary"
                                disabled={!stock || !freshConnection}
                                onClick={() =>
                                  stock &&
                                  setTrade({ stock, side: "sell", position: p })
                                }
                              >
                                {data.mode === "demo"
                                  ? "Record paper sell"
                                  : "I sold this"}
                                <ArrowRight size={15} />
                              </button>
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {page === "journal" && (
                <section className="card journal-card">
                  <div className="section-heading">
                    <div>
                      <h2>Your decision trail</h2>
                      <p className="muted">
                        Actual entered fills, saved with the model version.
                      </p>
                    </div>
                    <span className="count-badge">
                      {data.journal.length} records
                    </span>
                  </div>
                  {!data.journal.length ? (
                    <Empty
                      title="Your story starts with a decision."
                      icon={<BookOpen size={30} />}
                    >
                      Paper buys and sells will appear here, along with your
                      notes and actual entered execution details.
                    </Empty>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Execution · Dublin</th>
                            <th>Stock</th>
                            <th>Record</th>
                            <th>Fill price</th>
                            <th>Shares</th>
                            <th>Amount</th>
                            <th>Realized result</th>
                            <th>Reason / model</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.journal.map((entry) => (
                            <tr key={entry.id}>
                              <td>{dateTime(entry.executed_at)}</td>
                              <td>
                                <strong>{entry.symbol}</strong>
                              </td>
                              <td>
                                <span className={`journal-side ${entry.side}`}>
                                  {humanize(entry.side)}
                                </span>
                                <small>{entry.mode}</small>
                              </td>
                              <td>{price(entry.price_usd)}</td>
                              <td>{entry.quantity.toFixed(6)}</td>
                              <td>
                                {money(entry.amount_eur)}
                                <small>{money(entry.fee_eur)} fees</small>
                              </td>
                              <td
                                className={
                                  entry.realized_pnl_eur >= 0
                                    ? "positive"
                                    : "negative"
                                }
                              >
                                {entry.side === "sell"
                                  ? signed(entry.realized_pnl_eur)
                                  : "—"}
                              </td>
                              <td className="notes-cell">
                                {entry.notes || "No note recorded"}
                                <small>{entry.model_version}</small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
              {page === "research" && <ResearchView data={data} />}{" "}
              {page === "settings" && (
                <SettingsView data={data} onSaved={apply} />
              )}
              <footer className="page-footer">
                <span>
                  <Navigation size={13} /> A clearer next step. Always your
                  decision.
                </span>
                <span>
                  Model {data.model_version} ·{" "}
                  {data.mode === "demo"
                    ? "Fictional demo inputs"
                    : "Check source freshness"}
                </span>
              </footer>
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {trade && data && (
        <TradeModal
          trade={trade}
          data={data}
          onClose={closeTrade}
          onSaved={(snapshot) => {
            apply(snapshot);
            setToast(
              "Execution recorded. Your portfolio and journal are updated.",
            );
          }}
        />
      )}
      {source && <SourceModal source={source} onClose={closeSource} />}
    </div>
  );
}
