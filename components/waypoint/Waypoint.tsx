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
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Clock3,
  Compass,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
  LineChart,
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
  Line,
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
  subscribeWaypoint,
  marketFreshness,
  stockStateSafe,
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
  PerformanceReport,
  QuoteCheck,
} from "@/lib/waypoint/types";

type Page = "today" | "positions" | "journal" | "projections" | "performance" | "research" | "settings";
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
  marketOpen,
}: {
  state: State;
  safe?: boolean;
  large?: boolean;
  marketOpen?: boolean;
}) {
  const info = safe
    ? (stateInfo[state] ?? stateInfo.NO_SETUP)
    : marketOpen === false
      ? { label: "Market Closed", tone: "red", short: "The US market is closed" }
      : marketOpen === true
        ? { label: "Market Active", tone: "green", short: "The US market is open" }
        : { label: "Signals paused", tone: "gray", short: "Fresh market data is not available" };
  return (
    <span className={`state-badge ${info.tone} ${large ? "large" : ""}`} title={!safe ? "Fresh market data is not available, so action labels are paused." : (info.short ?? info.label)}>
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

type ChartRange = "24h" | "7d" | "30d" | "180d" | "365d";
const chartRanges: { id: ChartRange; label: string; days: number }[] = [
  { id: "24h", label: "24H", days: 1 },
  { id: "7d", label: "1W", days: 7 },
  { id: "30d", label: "1M", days: 30 },
  { id: "180d", label: "6M", days: 180 },
  { id: "365d", label: "1Y", days: 365 },
];
function Chart({ stock, safe, projection }: { stock: Stock; safe: boolean; projection?: Stock["projection"] }) {
  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const latest = new Date(stock.price_as_of ?? stock.freshness.market_at ?? Date.now());
  const timestamps = stock.history_timestamps ?? [];
  const history = stock.history.map((value, index) => {
    const parsed = timestamps[index] ? new Date(timestamps[index]) : null;
    const fallback = new Date(latest);
    fallback.setDate(fallback.getDate() - (stock.history.length - index));
    return { time: (parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback).getTime(), price: value };
  });
  const allPoints = [...history, { time: latest.getTime(), price: stock.price }].sort((a, b) => a.time - b.time);
  const selectedDays = chartRanges.find((item) => item.id === chartRange)?.days ?? 30;
  const cutoff = latest.getTime() - selectedDays * 24 * 60 * 60 * 1000;
  let points = allPoints.filter((point) => point.time >= cutoff);
  if (points.length < 2) points = allPoints.slice(-2);
  // Use an ordinal trading-session axis so weekends and missing sessions do
  // not create artificial empty space. Each two-point segment receives its
  // own direction colour, keeping the stroke continuous at every turn.
  const directed = points.map((point, index) => ({ ...point, index }));
  const historicalEndIndex = Math.max(0, directed.length - 1);
  const selectedProjection = projection?.horizons[String(projection.selected_horizon)];
  const projectionPath = selectedProjection?.path ?? [];
  const projectionData = [
    { day: 0, index: historicalEndIndex, p10: stock.price, p25: stock.price, median: stock.price, p75: stock.price, p90: stock.price },
    ...projectionPath.map((point) => ({ ...point, index: historicalEndIndex + point.day })),
  ];
  const projectionMaxIndex = projectionData.length ? projectionData[projectionData.length - 1].index : historicalEndIndex;
  const plan = safe ? stock.plan : null;
  const addTradingDays = (start: Date, days: number) => {
    const value = new Date(start);
    let remaining = days;
    while (remaining > 0) {
      value.setDate(value.getDate() + 1);
      const weekday = value.getDay();
      if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }
    return value;
  };
  const projectionDates = new Map(projectionData.map((point) => [point.index, addTradingDays(latest, point.day).getTime()]));
  const formatDate = (time: number) => {
    const date = new Date(time);
    return chartRange === "24h"
      ? date.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString("en-IE", { day: "numeric", month: "short" });
  };
  const formatTick = (value: number) => formatDate(directed[Math.round(value)]?.time ?? projectionDates.get(Math.round(value)) ?? latest.getTime());
  return (
    <>
      <div className="chart-toolbar">
        <span>Historical price</span>
        <div className="chart-ranges" role="group" aria-label="Chart time range">
          {chartRanges.map((item) => (
            <button key={item.id} className={`chart-range ${chartRange === item.id ? "active" : ""}`} onClick={() => setChartRange(item.id)}>{item.label}</button>
          ))}
        </div>
      </div>
      <div
      className="chart-wrap"
      role="img"
      aria-label={`${stock.symbol} historical price line for the last ${chartRange}. Latest supplied price ${price(stock.price)}. ${projectionData.length > 1 ? `Historical outcome projection for the next ${selectedProjection?.horizon_days ?? projection?.selected_horizon ?? 0} trading days.` : "Historical projection unavailable."} ${plan ? `Entry range ${range(plan.entry_low, plan.entry_high)}.` : "Trading overlays unavailable."}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={directed}
          margin={{ top: 16, right: 4, bottom: 8, left: -18 }}
        >
          <defs>
            <linearGradient id={`priceGradient-${stock.symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#248232" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#248232" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="#244555"
            strokeDasharray="3 5"
          />
          <XAxis
            type="number"
            dataKey="index"
            domain={[0, Math.max(1, projectionMaxIndex)]}
            tickFormatter={formatTick}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#a9c0ca", fontSize: 10 }}
            tickCount={Math.min(7, Math.max(directed.length, projectionData.length))}
            minTickGap={26}
          />
          <YAxis
            orientation="right"
            tickFormatter={(v) => `$${v}`}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#a9c0ca", fontSize: 11 }}
            domain={["auto", "auto"]}
            tickCount={4}
            width={54}
          />
          <Tooltip
            labelFormatter={(value) => directed[Math.round(Number(value))] ? formatDate(directed[Math.round(Number(value))].time) : "Historical observation"}
            formatter={(v) => [price(Number(v)), "Price"]}
            contentStyle={{
              border: "1px solid #244555",
              background: "#0b2435",
              color: "#f4fbff",
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          {plan && (
            <ReferenceArea
              y1={plan.entry_low}
              y2={plan.entry_high}
              fill="#248232"
              fillOpacity={0.18}
              ifOverflow="extendDomain"
            />
          )}
          {plan && (
            <ReferenceLine
              y={plan.reconsider}
              stroke="#ff0022"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
          )}
          <Area
            type="monotone"
            dataKey="price"
            stroke="transparent"
            fill={`url(#priceGradient-${stock.symbol})`}
            isAnimationActive={false}
          />
          {directed.slice(1).map((point, index) => {
            const previous = directed[index];
            return (
              <Line
                key={`${stock.symbol}-segment-${point.index}`}
                data={[previous, point]}
                type="monotone"
                dataKey="price"
                stroke={point.price >= previous.price ? "#248232" : "#ff0022"}
                strokeWidth={3}
                dot={false}
                isAnimationActive={false}
              />
            );
          })}
          {projectionData.length > 1 && (
            <>
              <ReferenceLine
                x={historicalEndIndex}
                stroke="#f9b9f2"
                strokeDasharray="2 4"
                strokeOpacity={0.65}
                ifOverflow="extendDomain"
              />
              <Line data={projectionData} type="monotone" dataKey="p10" stroke="#f9b9f2" strokeOpacity={0.42} strokeDasharray="3 4" dot={false} isAnimationActive={false} />
              <Line data={projectionData} type="monotone" dataKey="p25" stroke="#f9b9f2" strokeOpacity={0.22} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
              <Line data={projectionData} type="monotone" dataKey="median" stroke="#f9b9f2" strokeWidth={2} strokeDasharray="7 4" dot={false} isAnimationActive={false} />
              <Line data={projectionData} type="monotone" dataKey="p75" stroke="#f9b9f2" strokeOpacity={0.22} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
              <Line data={projectionData} type="monotone" dataKey="p90" stroke="#f9b9f2" strokeOpacity={0.42} strokeDasharray="3 4" dot={false} isAnimationActive={false} />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
      </div>
      <div className="chart-note">
        <span className="chart-key chart-key-history" />Observed price path
        {projectionData.length > 1 && <><span className="chart-key chart-key-projection" />Historical outcome range (not a forecast)</>}
      </div>
    </>
  );
}

function InfoTip({ text }: { text: string }) {
  return <span className="info-tip" title={text} aria-label={text}>i</span>;
}

function OpportunityBoard({
  stocks,
  selectedSymbol,
  onSelect,
  isFresh,
  marketOpen,
  researchRunning,
}: {
  stocks: Stock[];
  selectedSymbol?: string;
  onSelect: (symbol: string) => void;
  isFresh: (stock: Stock) => boolean;
  marketOpen: boolean;
  researchRunning: boolean;
}) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const ordered = [...stocks].sort((a, b) => {
    const aPlan = a.plan && !["SKIP", "NO_SETUP"].includes(a.state) ? 1 : 0;
    const bPlan = b.plan && !["SKIP", "NO_SETUP"].includes(b.state) ? 1 : 0;
    return bPlan - aPlan || (b.opportunity ?? -1) - (a.opportunity ?? -1);
  });
  const moveCarousel = (direction: -1 | 1) => {
    carouselRef.current?.scrollBy({
      left: direction * Math.max(280, carouselRef.current.clientWidth * 0.86),
      behavior: "smooth",
    });
  };
  return (
    <section className="card opportunity-board" aria-label="All monitored opportunities">
      <div className="opportunity-board-heading">
        <div>
          <p className="eyebrow">LIVE WATCHLIST</p>
          <h2>Opportunities today</h2>
        </div>
        <div className="opportunity-board-meta">
          <span>{ordered.length} monitored</span>
          <div className="opportunity-carousel-controls" aria-label="Move through opportunities">
            <button className="icon-button" type="button" aria-label="Previous opportunity" onClick={() => moveCarousel(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button className="icon-button" type="button" aria-label="Next opportunity" onClick={() => moveCarousel(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="opportunity-grid" ref={carouselRef}>
        {ordered.map((stock) => {
          const safe = isFresh(stock);
          const actionable = !!stock.plan && !["SKIP", "NO_SETUP"].includes(stock.state);
          const inBuyRange = !!stock.plan && stock.price >= stock.plan.entry_low && stock.price <= stock.plan.entry_high;
          const worthScore = stock.worth_score ?? (stock.opportunity == null || stock.risk == null
            ? null
            : Math.round(Math.max(0, Math.min(100, stock.opportunity * 0.55 + (100 - stock.risk) * 0.3 + stock.confidence * 0.15))));
          const worthTone = worthScore == null ? "" : worthScore >= 67 ? "good" : worthScore >= 45 ? "caution" : "weak";
          const worthLabel = stock.decision_label ?? (worthScore == null ? "Unavailable" : worthScore >= 67 ? "Strong" : worthScore >= 45 ? "Mixed" : "Weak");
          const opportunityWhy = "Opportunity combines the setup trend, momentum, volume, company evidence, catalysts, and data quality.";
          const riskWhy = "Risk combines volatility, downside distance, event risk, liquidity, and missing or uncertain evidence.";
          const worthWhy = "Worth considering blends Opportunity, inverse Risk, and Confidence. It is a guide, not a trade instruction.";
          const missingReasons = stock.research?.missing_reasons ?? [];
          const missingSummary = missingReasons.slice(0, 3).join(" ");
          const sizeWhy = stock.sizing.viable
            ? `This suggested amount follows your account size, configured risk limits, planned downside, fees, and minimum order rules. ${stock.sizing.reason}`
            : "No position size is currently viable under the account, fee, and risk limits.";
          const buyWhy = stock.plan
            ? "This buy range is the deterministic entry area from the setup price structure, volatility, reward/risk, and risk controls."
            : missingSummary
              ? `No buy range yet. The engine is waiting for verified evidence: ${missingSummary}`
              : "A buy range will appear after the required evidence is verified.";
          const sellWhy = stock.plan
            ? "This sell range is the first profit area from the trade plan, constrained by historical outcomes and risk controls."
            : missingSummary
              ? `No sell target yet. The engine is waiting for verified evidence: ${missingSummary}`
              : "A sell range will appear with a verified trade plan.";
          return (
            <button
              key={stock.symbol}
              className={`opportunity-tile ${selectedSymbol === stock.symbol ? "selected" : ""} ${inBuyRange ? "in-buy-range" : ""}`}
              onClick={() => onSelect(stock.symbol)}
              aria-pressed={selectedSymbol === stock.symbol}
            >
              <div className="opportunity-tile-top">
                <div className="company-heading compact">
                  <StockMark symbol={stock.symbol} small />
                  <div><strong>{stock.symbol}</strong><small>{stock.name}</small>{stock.research_lane === "discovery" && <span className="research-lane-badge">Discovery candidate</span>}</div>
                </div>
                <Badge state={stock.state} safe={safe} marketOpen={marketOpen} />
              </div>
              <div className="opportunity-tile-price"><strong>{price(stock.price)}</strong><span className={(stock.change_pct ?? 0) >= 0 ? "positive" : "negative"}>{stock.change_pct == null ? "—" : `${stock.change_pct >= 0 ? "+" : ""}${stock.change_pct.toFixed(2)}%`}</span></div>
              <div className="opportunity-tile-metrics">
                <span title={opportunityWhy}>Opportunity <b>{stock.opportunity ?? "—"}</b> <InfoTip text={opportunityWhy} /></span>
                <span title={riskWhy}>Risk <b>{stock.risk ?? "—"}</b> <InfoTip text={riskWhy} /></span>
                <span className={`worth-score ${worthTone}`} title={worthWhy}>Worth considering <b>{worthScore ?? "—"}</b> <em>{worthLabel}</em> <InfoTip text={worthWhy} /></span>
              </div>
              <p className={actionable ? "opportunity-plan" : "opportunity-research"} title={buyWhy}>{actionable && stock.plan ? <>Buy {range(stock.plan.entry_low, stock.plan.entry_high)} <InfoTip text={buyWhy} /></> : <>{researchRunning ? "Research in progress" : "Research incomplete"} <InfoTip text={buyWhy} /></>}</p>
              <p className="opportunity-size" title={sizeWhy}>Suggested amount: <strong>{stock.sizing.viable ? money(stock.sizing.amount_eur) : "—"}</strong> <InfoTip text={sizeWhy} /></p>
              {stock.plan ? <>
                <p className="opportunity-sell" title={sellWhy}>Sell low: {range(stock.plan.first_profit_low, stock.plan.first_profit_high)} <InfoTip text="The lower sell range is the first profit area: a more cautious exit if the setup moves in your favour." /></p>
                <p className="opportunity-sell strong" title={sellWhy}>Sell high: {range(stock.plan.strong_profit_low, stock.plan.strong_profit_high)} <InfoTip text="The higher sell range is the strong profit area: a more ambitious exit when the historical and deterministic evidence supports it." /></p>
                <p className="opportunity-reconsider">Reconsider below: {price(stock.plan.reconsider)} <InfoTip text="If price falls below this level, the original setup needs review rather than waiting for a profit target." /></p>
              </> : <p className="opportunity-sell">Sell target unavailable <InfoTip text={sellWhy} /></p>}
            </button>
          );
        })}
      </div>
      <p className="opportunity-board-footer"><RefreshCw size={13} /> Updates automatically as new prices and evidence arrive · “Worth considering” combines opportunity, risk, and confidence.</p>
    </section>
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

function MLOutlook({ prediction, shadow }: { prediction: NonNullable<Stock["ml"]>; shadow: boolean }) {
  const percent = (value?: number) => value == null ? "—" : `${Math.round(value * 100)}%`;
  const signedPercent = (value?: number) => value == null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  return (
    <section className="ml-outlook" aria-label="Model outlook">
      <div className="ml-outlook-heading">
        <div>
          <span className="eyebrow">MODEL OUTLOOK · NEXT 10 TRADING DAYS</span>
          <strong>{prediction.model_confidence} confidence</strong>
        </div>
        {shadow && <small>Research only · shadow mode</small>}
      </div>
      <div className="ml-outlook-metrics">
        <div><span>Positive return</span><strong>{percent(prediction.probability_positive_10d)}</strong></div>
        <div><span>Target first</span><strong>{percent(prediction.probability_target_first)}</strong></div>
        <div><span>Reconsider first</span><strong>{percent(prediction.probability_reconsider_first)}</strong></div>
        <div><span>Expected return</span><strong>{signedPercent(prediction.expected_return_10d)}</strong></div>
      </div>
      {prediction.feature_explanations && (
        <details className="ml-why">
          <summary>Why?</summary>
          <div><span>Likes</span>{prediction.feature_explanations.likes.slice(0, 3).map((item) => <p key={item}>{item}</p>)}</div>
          <div><span>Cautions</span>{prediction.feature_explanations.cautions.slice(0, 3).map((item) => <p key={item}>{item}</p>)}</div>
        </details>
      )}
    </section>
  );
}

function HistoricalProjectionOutlook({ projection }: { projection: NonNullable<Stock["projection"]> }) {
  const horizon = projection.horizons[String(projection.selected_horizon)];
  if (!horizon) return null;
  const percent = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value * 100)}%`;
  const priceRange = (range: [number | null, number | null]) => range[0] == null || range[1] == null
    ? "—" : `$${range[0].toFixed(2)}–$${range[1].toFixed(2)}`;
  return (
    <section className="projection-outlook" aria-label="Historical projection">
      <div className="projection-heading">
        <div>
          <span className="eyebrow">HISTORICAL PROJECTION · NEXT {projection.selected_horizon} TRADING DAYS</span>
          <strong>{projection.analogue_quality} analogue confidence</strong>
        </div>
        <small>{projection.analogue_count} similar cases</small>
      </div>
      <p className="projection-note">Historical outcome range, not a guaranteed future price.</p>
      <div className="projection-ranges">
        <div><span>Weak historical range</span><strong>{priceRange(horizon.weak_range)}</strong></div>
        <div><span>Typical historical range</span><strong>{priceRange(horizon.typical_range)}</strong></div>
        <div><span>Strong historical range</span><strong>{priceRange(horizon.strong_range)}</strong></div>
      </div>
      <div className="projection-metrics">
        <div><span>Positive outcomes</span><strong>{percent(projection.positive_rate)}</strong></div>
        <div><span>Target first</span><strong>{percent(projection.target_first_rate)}</strong></div>
        <div><span>Reconsider first</span><strong>{percent(projection.reconsider_first_rate)}</strong></div>
        <div><span>Median return</span><strong>{percent(projection.median_return)}</strong></div>
      </div>
      {projection.disagreement && <p className="projection-warning">⚠ {projection.disagreement.status}. Confidence reduced.</p>}
      {horizon.path && horizon.path.length > 1 && (
        <div className="projection-cone" aria-label="Historical outcome range by day">
          {horizon.path.filter((point) => point.day % Math.max(1, Math.floor(projection.selected_horizon / 5)) === 0 || point.day === 1).map((point) => {
            const width = Math.max(8, Math.min(100, ((point.p90 - point.p10) / Math.max(0.01, projection.current_price)) * 100));
            return <div className="projection-cone-row" key={point.day}><span>D{point.day}</span><div className="projection-cone-track"><i style={{ width: `${width}%` }} /><b style={{ left: `${Math.max(0, Math.min(100, ((point.median - point.p10) / Math.max(0.01, point.p90 - point.p10)) * 100))}%` }} /></div><strong>${point.median.toFixed(2)}</strong></div>;
          })}
        </div>
      )}
      <details className="projection-details">
        <summary>View similar cases and why</summary>
        <p>{projection.explanation}</p>
        {projection.cases.slice(0, 3).map((item) => <div key={`${item.symbol}-${item.as_of}`}><strong>{item.symbol}</strong> · {new Date(item.as_of).toLocaleDateString()} · {Math.round(item.similarity * 100)}% similar<p>{item.why_similar.join(" · ")}</p></div>)}
      </details>
    </section>
  );
}

function Trading212Check({ stock }: { stock: Stock }) {
  const [quote, setQuote] = useState("");
  const [spread, setSpread] = useState("");
  const [result, setResult] = useState<QuoteCheck | null>(null);
  const [busy, setBusy] = useState(false);
  async function check(event: FormEvent) {
    event.preventDefault();
    const brokerPrice = Number(quote);
    if (!Number.isFinite(brokerPrice) || brokerPrice <= 0) return;
    setBusy(true);
    try {
      setResult(await request<QuoteCheck>("/api/quote-check", { method: "POST", body: JSON.stringify({
        symbol: stock.symbol, broker_price: brokerPrice, broker_spread: spread ? Number(spread) : undefined,
      }) }));
    } finally { setBusy(false); }
  }
  if (!stock.plan) return null;
  return <section className="card quote-check">
    <div className="section-heading"><div><p className="eyebrow">BEFORE ENTRY</p><h3>Trading 212 quote check</h3></div><ShieldCheck size={21} /></div>
    <p className="muted">Trading 212 is not connected. Enter its current buy quote and optional spread to test the saved entry range.</p>
    <form onSubmit={check} className="quote-check-form">
      <label>Buy quote<input inputMode="decimal" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder={stock.price.toFixed(2)} /></label>
      <label>Spread (optional)<input inputMode="decimal" value={spread} onChange={(e) => setSpread(e.target.value)} placeholder="0.00" /></label>
      <button className="button secondary" disabled={busy || !quote}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Check quote</button>
    </form>
    {result && <div className={`quote-result ${result.valid ? "valid" : "invalid"}`} role="status"><strong>{result.valid ? "Quote still fits the plan" : "Do not use this entry suggestion"}</strong><p>{result.reason}</p>{result.effective_price && <small>Effective quote ${result.effective_price.toFixed(2)} · plan {result.entry_range?.map((v) => `$${v.toFixed(2)}`).join("–")}</small>}</div>}
  </section>;
}

function ProjectionView({ data }: { data: Dashboard }) {
  const stocks = data.stocks.filter((stock) => stock.projection);
  return <div className="research-view">
    <div className="research-banner"><div><span className="eyebrow">Historical projection mapping</span><h2>What happened after similar setups?</h2><p>Ranges are built from point-in-time historical analogues. They are not guaranteed future prices.</p></div><LineChart size={72} strokeWidth={1} /></div>
    {!stocks.length ? <section className="card"><Empty icon={<LineChart size={30} />} title="Waiting for labelled history">Run the historical ingestion job after Alpaca daily bars are available. The page will stay honest and show no fabricated projection.</Empty></section> : <div className="projection-page-grid">{stocks.map((stock) => { const projection = stock.projection!; const horizon = projection.horizons[String(projection.selected_horizon)]; return <section className="card projection-page-card" key={stock.symbol}><div className="section-heading"><div><p className="eyebrow">{stock.symbol} · {projection.selected_horizon} trading days</p><h3>{stock.name}</h3></div><strong>{projection.analogue_quality} confidence</strong></div><div className="projection-ranges"><div><span>Weak</span><strong>{horizon?.weak_range?.map((v) => v == null ? "—" : `$${v.toFixed(2)}`).join("–")}</strong></div><div><span>Typical</span><strong>{horizon?.typical_range?.map((v) => v == null ? "—" : `$${v.toFixed(2)}`).join("–")}</strong></div><div><span>Strong</span><strong>{horizon?.strong_range?.map((v) => v == null ? "—" : `$${v.toFixed(2)}`).join("–")}</strong></div></div><div className="projection-metrics"><div><span>Similar cases</span><strong>{projection.analogue_count}</strong></div><div><span>Positive</span><strong>{projection.positive_rate == null ? "—" : `${Math.round(projection.positive_rate * 100)}%`}</strong></div><div><span>Target first</span><strong>{projection.target_first_rate == null ? "—" : `${Math.round(projection.target_first_rate * 100)}%`}</strong></div></div><p className="muted">{projection.explanation}</p><button className="button secondary" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Review on Today</button></section>; })}</div>}
    <p className="page-note">Historical projections show distributions and disagreement. They never override deterministic risk controls.</p>
  </div>;
}

function PerformanceView({ data }: { data: Dashboard }) {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() { setBusy(true); try { setReport(await request<PerformanceReport>("/api/performance")); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, []);
  const paper = report?.paper_signals;
  const ml = report?.ml ?? data.ml;
  return <div className="research-view"><div className="research-banner"><div><span className="eyebrow">Engine performance</span><h2>Engine vs reality.</h2><p>Every paper signal is settled against observed prices and costs so you can inspect whether the rules earned trust.</p></div><Activity size={72} strokeWidth={1} /></div><div className="research-stats"><Stat label="Paper signals" value={String(paper?.total ?? data.shadow.signals)} /><Stat label="Open / pending" value={`${paper?.open ?? data.shadow.open} / ${paper?.pending ?? 0}`} /><Stat label="Closed" value={String(paper?.closed ?? data.shadow.closed)} /><Stat label="Realized result" value={signed(paper?.realized_pnl_eur ?? data.shadow.realized_pnl_eur)} /></div><section className="card research-card"><div className="section-heading"><div><p className="eyebrow">Research evidence</p><h2>Settlement and model status</h2></div><button className="button secondary" onClick={load} disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Refresh report</button></div><div className="performance-grid"><div><span>Paper win rate</span><strong>{paper?.win_rate == null ? "—" : `${Math.round(paper.win_rate * 100)}%`}</strong></div><div><span>ML predictions</span><strong>{ml?.predictions ?? 0}</strong></div><div><span>Settled ML outcomes</span><strong>{ml?.evaluated_outcomes ?? 0}</strong></div><div><span>Active model</span><strong>{ml?.active_model ?? "Rules only"}</strong></div></div><p className="notice"><HelpCircle size={17} />{report?.disclaimer ?? "Paper results are research records, not proof of future profitability."}</p></section></div>;
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
  reported_eps_consistency_pct: "Reported EPS consistency · SEC history",
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
            {data.mode === "live" ? "Replay cached Alpaca history" : "Run demo backtest"}
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
    const abort = new AbortController();
    // One cached initial read. All subsequent market updates are server-pushed.
    void request("/api/dashboard", { signal: abort.signal }).then((value) => {
      if (active) {
        setData((current) => current ?? parseDashboard(value));
        setClock(Date.now());
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Workspace unavailable.");
    });
    const stop = subscribeWaypoint({
      onSnapshot: (snapshot) => { if (active) { apply(snapshot); setError(""); } },
      onHeartbeat: () => { if (active) setReceived(Date.now()); },
      onState: (state, message) => {
        if (!active) return;
        setConnected(state === "connected");
        if (message) setError(message);
      },
    });
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { active = false; abort.abort(); stop(); clearInterval(timer); };
  }, [apply, retry]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timeout);
  }, [toast]);
  const closeTrade = useCallback(() => setTrade(null), []);
  const closeSource = useCallback(() => setSource(null), []);
  const freshConnection = connected && received > 0 && clock - received < 35000;
  const stockSafe = (s: Stock) => !!data && stockStateSafe(s, data, clock, freshConnection);
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
    { id: "projections", label: "Projections", icon: <LineChart size={19} /> },
    { id: "performance", label: "Engine performance", icon: <Activity size={19} /> },
    { id: "research", label: "Research lab", icon: <FlaskConical size={19} /> },
    { id: "settings", label: "Preferences", icon: <Settings2 size={19} /> },
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <Link className="brand" href="/waypoint" aria-label="Waypoint home">
          <img className="brand-logo" src="/waypoint-logo.png" alt="Waypoint" />
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
          {data?.mode === "live" && (
            <section className="card waypoint-data-status" aria-label="Data status">
              <details>
                <summary><strong>DATA STATUS</strong> · Alpaca {data.data_status?.stream.status ?? "unavailable"} · HOT {data.data_status?.hot_symbols.length ?? 0} / {data.data_status?.max_hot_symbols ?? 30}</summary>
                 <p><strong>LIVE PRICE FEED: ALPACA IEX</strong> · <strong>EXECUTION CHECK: TRADING 212</strong></p>
                 <p>Prices are real observations. Before acting, compare the live quote and spread in Trading 212.</p>
                 <p>HOT: {data.data_status?.hot_symbols.join(", ") || "Waiting for stream"} · WARM: {data.data_status?.warm_symbols.join(", ") || "None"}</p>
                 <div className="waypoint-session-status">
                   <strong>MARKET SESSION LOG</strong>
                   <p>
                     {data.data_status?.market_session?.observations_today ?? 0} minute observations across {data.data_status?.market_session?.symbols_today ?? 0} symbols.
                     {data.data_status?.market_session?.last_observed_at && ` Last saved ${dateTime(data.data_status.market_session.last_observed_at)}.`}
                   </p>
                   <small>Stored as an auditable stream history; raw quotes are coalesced to one observation per symbol per minute.</small>
                 </div>
                 {data.data_status?.stream.last_error && <p role="status">{data.data_status.stream.last_error}</p>}
                 <div className="waypoint-research-status">
                   <strong>RESEARCH PASS</strong>
                   <p>
                     {data.data_status?.schedule?.running
                       ? `Running · ${data.data_status.schedule.research_pass ?? "starting"}`
                       : data.data_status?.schedule?.research_pass
                         ? `Last pass · ${data.data_status.schedule.research_pass}`
                         : "Waiting for the first research pass"}
                     {data.data_status?.schedule?.research_last_symbol && ` · Last completed: ${data.data_status.schedule.research_last_symbol}`}
                   </p>
                   <small>
                     Last successful refresh: {dateTime(data.data_status?.schedule?.last_success)}
                   </small>
                   {(data.data_status?.schedule?.research_errors?.length ?? 0) > 0 && (
                     <small role="status">Provider issues: {data.data_status?.schedule?.research_errors?.join(" · ")}</small>
                   )}
                 </div>
                 <div className="waypoint-news-status">
                   <strong>NEWS EVIDENCE COLLECTOR</strong>
                   <p>
                     {data.data_status?.schedule?.news_last_success
                       ? `Last run ${dateTime(data.data_status.schedule.news_last_success)}`
                       : "Waiting for the first independent collection run"}
                     {typeof data.data_status?.schedule?.news_inserted === "number" && ` · ${data.data_status.schedule.news_inserted} new observations`}
                   </p>
                   <small>
                     Primary SEC: {data.data_status?.schedule?.news_sources?.primary ?? 0} · Verified feeds: {data.data_status?.schedule?.news_sources?.verified ?? 0} · Discovery: {data.data_status?.schedule?.news_sources?.discovery ?? 0}
                   </small>
                   {data.data_status?.schedule?.news_last_error && <small role="status">{data.data_status.schedule.news_last_error}</small>}
                 </div>
                 <div className="waypoint-provider-grid">
                  {Object.entries(data.data_status?.providers ?? {}).map(([name, usage]) => (
                    <div key={name}>
                      <strong>{name === "alpha_vantage" ? "Alpha Vantage" : name === "sec" ? "SEC EDGAR" : "Alpaca REST"}</strong>
                      <p>{usage.configured === false ? "Not configured" : usage.last_error ? "Using cached data / temporarily unavailable" : usage.last_success ? "Healthy" : "Waiting"}</p>
                      <p>{usage.requests_today}{usage.daily_limit ? ` / ${usage.daily_limit}` : ""} requests today · {usage.requests_minute} this minute</p>
                      <small>Last success: {dateTime(usage.last_success)} · Rate limits: {usage.rate_limit_responses}</small>
                    </div>
                  ))}
                </div>
                 <div className="waypoint-budget-status">
                   <strong>RESEARCH BUDGET</strong>
                   <p>
                     Alpha Vantage historical earnings are collected in rotating batches and cached.
                     {typeof data.data_status?.schedule?.alpha_vantage_budget_remaining === "number"
                       ? ` ${data.data_status.schedule.alpha_vantage_budget_remaining} calls remain today.`
                       : " The next available budget is shown after the provider reports it."}
                   </p>
                   {data.data_status?.schedule?.alpha_vantage_next_reset && <small>Next reset: {dateTime(data.data_status.schedule.alpha_vantage_next_reset)}</small>}
                   {data.data_status?.schedule?.earnings_history_next_attempt && (
                     <small>
                       Historical earnings retry: {dateTime(data.data_status.schedule.earnings_history_next_attempt)}
                       {data.data_status.schedule.earnings_history_budget_limited ? " (daily allowance reached; automatic retry)" : ""}
                     </small>
                   )}
                   {typeof data.data_status?.schedule?.earnings_history_collected === "number" && (
                     <small>
                       Last earnings batch: {data.data_status.schedule.earnings_history_collected} fetched · {data.data_status.schedule.earnings_history_skipped ?? 0} already cached
                     </small>
                   )}
                 </div>
                 <div className="waypoint-discovery-status">
                   <strong>DISCOVERY UNIVERSE</strong>
                   <p>{data.data_status?.schedule?.discovery_candidates ?? 0} rotating candidates are being checked alongside your core watchlist.</p>
                   {data.data_status?.schedule?.discovery_symbols?.length ? <small>Current lane: {data.data_status.schedule.discovery_symbols.join(", ")}</small> : null}
                   {data.data_status?.schedule?.discovery_last_error && <small role="status">{data.data_status.schedule.discovery_last_error}</small>}
                 </div>
                 <div className="waypoint-research-queue">
                   <strong>RESEARCH QUEUE</strong>
                   <p>{data.research_queue?.complete ?? 0} complete · {data.research_queue?.total ?? 0} waiting for evidence.</p>
                   {data.research_queue?.top_blockers?.slice(0, 3).map((item) => (
                     <small key={item.reason}>{item.count}× {item.reason}</small>
                   ))}
                   {data.research_queue?.evidence_readiness?.map((item) => (
                     <small key={item.label} title={item.next_step}>
                       {item.label}: {item.ready}/{item.total} {item.status === "ready" ? "ready" : item.status === "partial" ? "in progress" : "waiting"}
                     </small>
                   ))}
                 </div>
              </details>
            </section>
          )}
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
              <p><strong>Research is still loading.</strong> Prices and news are available, but some verified company inputs are missing. Trade plans will appear when the evidence is complete.</p>
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
                      <OpportunityBoard
                        stocks={data.stocks}
                        selectedSymbol={selected?.symbol}
                        onSelect={(next) => { setSymbol(next); setShowWhy(false); }}
                        isFresh={stockSafe}
                        marketOpen={data.market.is_open}
                        researchRunning={Boolean(data.data_status?.schedule?.running)}
                      />
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
                              <Badge state={selected.state} safe={safe} marketOpen={data.market.is_open} large />
                              <p>
                                {livePlanPaused
                                  ? "Live price found. Waiting for the company evidence needed to build a trade plan."
                                  : safe
                                  ? stateInfo[selected.state]?.short
                                  : "Fresh market data is needed before a next step."}
                              </p>
                            </div>
                            <div className="current-price">
                              <strong>{price(selected.price)}</strong>
                              {data.mode === "live" && <small className="waypoint-price-age">
                                {marketFreshness(selected, data, clock, freshConnection).stale ? "⚠ PRICE DATA STALE" : `Updated ${marketFreshness(selected, data, clock, freshConnection).age?.toFixed(1)} sec ago`}
                                {" · Alpaca IEX · "}{selected.watchlist_tier ?? "WARM"}
                              </small>}

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
                                ? "We have a live price and current news, but not enough verified company data to calculate a live trade plan yet."
                                : safe
                                ? selected.explanation
                                : "This is the last received price. Actionable labels and the trade plan are paused until the data is current."}
                            </p>
                          </div>
                          {selected.ml && <MLOutlook prediction={selected.ml} shadow={data.ml?.shadow_mode ?? true} />}
                          {selected.projection && <HistoricalProjectionOutlook projection={selected.projection} />}
                          {safe && <Trading212Check stock={selected} />}
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
                          {selected.plan ? (
                            <>
                              <PriceMap stock={selected} />
                              {!safe && <div className="plan-freshness-note"><Clock3 size={16} /> Research plan shown for context. Wait for a current Alpaca quote and compare Trading 212 before acting.</div>}
                            </>
                          ) : (
                            <div className="no-plan">
                              <ShieldCheck size={20} />
                              <div>
                                <span>
                                  {livePlanPaused
                                    ? "No live trade plan yet. We’ll show the entry, profit area, and reconsider level when the required evidence is verified."
                                    : safe
                                    ? "No qualifying trade plan. Sitting this one out is a valid outcome."
                                    : "The price plan will return with fresh data."}
                                </span>
                                {livePlanPaused && selected.research?.missing_reasons?.length ? (
                                  <details className="plan-gap">
                                    <summary>Why the plan is paused</summary>
                                    <p>These are evidence gaps, not failed API connections. The configured feeds are current, but free public data does not provide every input required for a responsible plan.</p>
                                    <ul>
                                      {selected.research.missing_reasons.slice(0, 8).map((reason: string, index: number) => <li key={index}>{reason}</li>)}
                                    </ul>
                                  </details>
                                ) : null}
                              </div>
                            </div>
                          )}
                          <div className="chart-heading">
                            <span>THE PRICE, IN PERSPECTIVE</span>
                            <div>
                              <span className="legend-dot" />{" "}
                              {selected.freshness.feed}
                            </div>
                          </div>
                          <Chart stock={selected} safe={safe} projection={selected.projection} />
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
                                  marketOpen={data.market.is_open}
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
              {page === "projections" && <ProjectionView data={data} />}
              {page === "performance" && <PerformanceView data={data} />}
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
