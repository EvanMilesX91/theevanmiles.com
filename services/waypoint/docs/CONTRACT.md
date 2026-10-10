# Waypoint implementation contract

Local first Next.js frontend (localhost:3000) + FastAPI (127.0.0.1:8000).
All backend amounts JSON numbers; accounting internally Decimal. Time UTC ISO, UI Europe/Dublin.
Root agent owns backend API, persistence, accounting, integration and startup documentation.
Engine agent owns app/engine.py, app/fixtures.py, tests/test_engine.py, docs/METHODOLOGY.md.
Providers agent owns app/providers.py, app/calendar.py, app/backtest.py, tests/test_providers.py, tests/test_backtest.py, docs/PROVIDERS.md.
Frontend agent owns frontend/ entirely. No shared file edits outside ownership without coordination.

## HTTP
- GET /api/dashboard -> Dashboard below
- GET /api/events -> local persistent-runtime SSE events: `snapshot` contains Dashboard JSON; `heartbeat` keeps the connection active. Serverless runtime returns 409 because it cannot own the Alpaca stream.
- POST /api/trades -> TradeInput; response Dashboard
- PATCH /api/settings -> partial Settings; response Dashboard
- POST /api/demo/step {scenario: "entry"|"profit"|"warning"|"exit"|"wait", symbol: "RKLB"} -> Dashboard
- POST /api/refresh -> slow refresh -> Dashboard
- GET /api/backtest -> deterministic fixture-only walk-forward backtest report (description, metrics, trades, equity)
- GET /api/sources/{source_id} -> provenance object
- GET /api/health -> {status:"ok", mode:"demo"|"live", model_version}

## JSON models
Settings = {horizon:"weeks"|"months"|"years", size:"small"|"medium"|"large"|"none", shadow_enabled:boolean, fx_usd_per_eur:number, fx_fee_pct:number, fixed_fee_eur:number, min_order_eur:number}
TradeInput = {symbol:string, side:"buy"|"sell", price_usd:number, amount_eur?:number, quantity?:number, fx_usd_per_eur:number, fee_eur:number, executed_at:string, notes:string, mode:"paper"|"manual", idempotency_key:string}
Buy amount_eur is share consideration before explicit fee; quantity = amount_eur * fx / price. Sell quantity required. UI is paper mode by default; demo uses paper only, manual record disabled in demo.

Dashboard = {
 mode:"demo"|"live", now:string, model_version:string, settings:Settings,
 market:{is_open:boolean,label:string,next_open:string,timezone:"Europe/Dublin"},
 portfolio:{initial_eur:20,goal_eur:200,cash_eur:number,invested_eur:number,realized_pnl_eur:number,unrealized_pnl_eur:number,total_eur:number,return_pct:number,max_drawdown_pct:number,positions:Position[]},
 stocks:Stock[], alerts:Alert[], journal:JournalEntry[], shadow:{signals:number,open:number,closed:number,realized_pnl_eur:number}, last_slow_refresh:string, provider_status:string
}
Position = {symbol,quantity,average_price_usd,cost_eur,value_eur,unrealized_pnl_eur,mode}
JournalEntry = {id,symbol,side,price_usd,quantity,amount_eur,fee_eur,fx_usd_per_eur,executed_at,mode,realized_pnl_eur,notes,model_version}
Alert = {id,symbol,state,message,created_at}
Stock = {
 symbol,name,sector,company_type,classification_confidence,classification_version,
 price:number,previous_close:number|null,change_pct:number|null,history:number[],
 state:"NO_SETUP"|"WATCH"|"WAIT"|"BUY_AREA"|"HOLD"|"TAKE_PROFIT"|"WATCH_CLOSELY"|"RECONSIDER_EXIT"|"SKIP",
 explanation:string, opportunity:number|null,risk:number|null,confidence:number,confidence_label:"HIGH"|"MEDIUM"|"LOW",
 opportunity_components:{name:string,score:number,weight:number}[],risk_components:{name:string,score:number,weight:number}[],
 plan:null|{entry_low,entry_high,first_profit_low,first_profit_high,strong_profit_low,strong_profit_high,reconsider,reward_risk,scenarios:{name,low,high,assumptions:string[]}[]},
 sizing:{amount_eur,quantity,planned_downside_eur,first_profit_eur,strong_profit_eur,viable:boolean,reason:string},
 freshness:{market_at:string|null,financial_period:string,news_checked_at:string|null,feed:"DEMO DATA"|"REAL-TIME"|"DELAYED"|"END OF DAY"|"MARKET CLOSED"|"UNAVAILABLE",status:"current"|"stale"|"missing"},
 reasons:{text:string,source_id:string}[], risks:{text:string,source_id:string}[], next_events:{label:string,date:string|null,detail:string,source_id:string}[], changes:string[],sources:Source[],business_warning:boolean
}
Stock may also include optional `projection` and `ml` evidence objects. A
HistoricalProjection contains the selected horizon, quantiles, weak/typical/
strong historical ranges, normalized forward path percentiles, analogue counts
and quality, barrier rates, disagreement and inspectable past cases. It is
historical outcome evidence, never a guaranteed target price, and is omitted
until labelled point-in-time rows exist.
Source = {id,provider,url:string|null,published_at,retrieved_at,reporting_period:string|null,raw_value:any,normalized_value:any,description:string}

## Engine interface (agent implements)
MODEL_VERSION: str
analyze_stock(fixture:dict, horizon:str="weeks", now:datetime|None=None) -> dict: normalized Stock base with deterministic scores, plan, sources, history, freshness; no state/sizing necessary
trade_state(price:float, plan:dict|None, owned:bool=False, fresh:bool=True, business_warning:bool=False) -> tuple[str,str]
position_size(plan:dict|None, price:float, equity_eur:float, cash_eur:float, settings:dict, spread_pct:float=0.002) -> dict
fixtures.demo_stocks(now:datetime|None=None) -> list[dict] acceptable input for analyze_stock; fictional example facts on real ordinary US-listed symbols, explicitly demo; deterministically generated history, no RNG.

## Provider/calendar/backtest interface (agent implements)
calendar.market_status(now:datetime|None=None) -> {is_open,label,next_open,timezone}
providers: typed Pydantic models and protocols for bars, quote, fundamentals, news, filings, macro; Alpaca official historical/quote adapter with env credentials, SEC public submissions adapter with identifying User-Agent. No automatic live enable or fake live on failure. Agent documents methods and dependencies.
backtest.demo_backtest() -> JSON description, metrics, trades, equity. Pure deterministic price-only toy strategy explicitly no validated predictive claim; next-bar fills, no future facts, costs, gap-aware exits.
