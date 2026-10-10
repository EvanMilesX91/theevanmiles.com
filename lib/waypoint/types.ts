export type State =
  | "NO_SETUP"
  | "WATCH"
  | "WAIT"
  | "BUY_AREA"
  | "HOLD"
  | "TAKE_PROFIT"
  | "WATCH_CLOSELY"
  | "RECONSIDER_EXIT"
  | "SKIP";
export type Settings = {
  horizon: "weeks" | "months" | "years";
  size: "small" | "medium" | "large" | "none";
  shadow_enabled: boolean;
  fx_usd_per_eur: number;
  fx_fee_pct: number;
  fixed_fee_eur: number;
  min_order_eur: number;
};
export type Source = {
  id: string;
  provider: string;
  url: string | null;
  published_at: string | null;
  retrieved_at: string;
  reporting_period: string | null;
  raw_value: unknown;
  normalized_value: unknown;
  description: string;
};
export type Plan = {
  entry_low: number;
  entry_high: number;
  first_profit_low: number;
  first_profit_high: number;
  strong_profit_low: number;
  strong_profit_high: number;
  reconsider: number;
  reward_risk: number;
  scenarios: {
    name: string;
    low: number;
    high: number;
    assumptions: string[];
  }[];
};
export type ComponentScore = { name: string; score: number; weight: number };
export type ProviderHealth = {
  status: string;
  checked_at: string | null;
  message?: string;
  code?: string;
};
export type LiveResearch = {
  metrics: Record<string, number>;
  raw_metrics: Record<string, number>;
  metric_sources: Record<string, string>;
  news: { title: string; published_at: string | null; url: string | null; source_id: string }[];
  coverage: Record<string, ProviderHealth>;
  missing_reasons: string[];
  financial_period: string;
  filings: unknown[];
};
export type Stock = {
  symbol: string;
  name: string;
  sector: string;
  company_type: string;
  classification_confidence: number;
  classification_version: string;
  price: number;
  price_basis?: "completed_close" | "quote";
  price_as_of?: string | null;
  watchlist_tier?: "HOT" | "WARM";
  actionable?: boolean;
  market?: {
    timestamp: string | null;
    provider: string;
    feed: string;
    age_seconds: number | null;
    stale: boolean;
    bid?: number | null;
    ask?: number | null;
    bid_size?: number | null;
    ask_size?: number | null;
    last_trade?: number | null;
    volume?: number | null;
  };
  previous_close: number | null;
  change_pct: number | null;
  history: number[];
  state: State;
  explanation: string;
  opportunity: number | null;
  risk: number | null;
  confidence: number;
  confidence_label: "HIGH" | "MEDIUM" | "LOW";
  opportunity_components: ComponentScore[];
  risk_components: ComponentScore[];
  plan: Plan | null;
  sizing: {
    amount_eur: number;
    quantity: number;
    planned_downside_eur: number;
    first_profit_eur: number;
    strong_profit_eur: number;
    viable: boolean;
    reason: string;
  };
  freshness: {
    market_at: string | null;
    financial_period: string;
    news_checked_at: string | null;
    feed: string;
    status: "current" | "stale" | "missing";
  };
  reasons: { text: string; source_id: string }[];
  risks: { text: string; source_id: string }[];
  next_events: {
    label: string;
    date: string | null;
    detail: string;
    source_id: string;
  }[];
  changes: string[];
  sources: Source[];
  business_warning: boolean;
  research?: LiveResearch;
  ml?: MLPrediction;
};
export type MLPrediction = {
  model_version: string;
  model_family: string;
  probability_positive_5d?: number;
  probability_positive_10d?: number;
  probability_positive_20d?: number;
  expected_return_5d?: number;
  expected_return_10d?: number;
  expected_return_20d?: number;
  probability_target_first?: number;
  probability_reconsider_first?: number;
  probability_neither?: number;
  expected_max_upside?: number;
  expected_max_drawdown?: number;
  model_confidence: "HIGH" | "MEDIUM" | "LOW";
  feature_explanations?: { likes: string[]; cautions: string[] };
  similar_setups?: {
    count: number;
    median_return_10d: number | null;
    positive_rate: number | null;
    target_first_rate: number | null;
    median_drawdown_10d: number | null;
  };
};
export type Position = {
  symbol: string;
  quantity: number;
  average_price_usd: number;
  cost_eur: number;
  value_eur: number;
  unrealized_pnl_eur: number;
  mode: string;
};
export type JournalEntry = {
  id: string;
  symbol: string;
  side: string;
  price_usd: number;
  quantity: number;
  amount_eur: number;
  fee_eur: number;
  fx_usd_per_eur: number;
  executed_at: string;
  mode: string;
  realized_pnl_eur: number;
  notes: string;
  model_version: string;
};
export type Dashboard = {
  mode: "demo" | "live";
  now: string;
  model_version: string;
  settings: Settings;
  market: {
    is_open: boolean;
    label: string;
    next_open: string;
    timezone: string;
  };
  portfolio: {
    initial_eur: number;
    goal_eur: number;
    cash_eur: number;
    invested_eur: number;
    realized_pnl_eur: number;
    unrealized_pnl_eur: number;
    total_eur: number;
    return_pct: number;
    max_drawdown_pct: number;
    positions: Position[];
  };
  stocks: Stock[];
  alerts: {
    id: string;
    symbol: string;
    state: State;
    message: string;
    created_at: string;
  }[];
  journal: JournalEntry[];
  shadow: {
    signals: number;
    open: number;
    closed: number;
    realized_pnl_eur: number;
  };
  last_slow_refresh: string;
  provider_status: string;
  provider_health?: Record<string, ProviderHealth>;
  data_status?: DataStatus;
  fx?: { rate: number | string; timestamp: string | null; health: ProviderHealth; source: Partial<Source> } | null;
  ml?: {
    enabled: boolean;
    shadow_mode: boolean;
    influence_enabled: boolean;
    active_model: string | null;
    model_family: string | null;
    predictions: number;
    shadow_predictions: number;
    evaluated_outcomes: number;
    drift: { status: string; confidence_reduced?: boolean };
  };
};
export type ProviderUsage = {
  configured?: boolean;
  requests_today: number;
  requests_minute: number;
  last_request: string | null;
  last_success: string | null;
  last_error: string | null;
  rate_limit_responses: number;
  daily_limit?: number | null;
  status?: string;
};
export type DataStatus = {
  stream: {
    status: string;
    connected: boolean;
    feed: string;
    last_event_at: string | null;
    connected_at: string | null;
    last_error?: string | null;
  };
  hot_symbols: string[];
  warm_symbols: string[];
  max_hot_symbols: number;
  price_stale_seconds?: number;
  providers: Record<string, ProviderUsage>;
};
export type TradeInput = {
  symbol: string;
  side: "buy" | "sell";
  price_usd: number;
  amount_eur?: number;
  quantity?: number;
  fx_usd_per_eur: number;
  fee_eur: number;
  executed_at: string;
  notes: string;
  mode: "paper" | "manual";
  idempotency_key: string;
};
export type BacktestReport = {
  description: string;
  metrics: Record<string, unknown>;
  trades: Record<string, unknown>[];
  equity: (number | Record<string, unknown>)[];
  [key: string]: unknown;
};
