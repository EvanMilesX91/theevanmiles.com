# Waypoint deterministic methodology — 0.1.0

This is an **unvalidated experimental heuristic**, not an investment model with a demonstrated edge. Scores are ordinal screening tools, not probabilities. A high confidence score describes supported and consistent inputs; it does not establish a high probability of profit. There is no language model in the calculation path. There is no broker execution path.

The eight demo symbols identify real listed shares, but **all fixture prices, histories, financial information, category inputs, dates and catalysts are fictional**. Nothing in a demo card describes a real company's present condition. Source records carry this label individually. Demo signal performance cannot validate real-world performance.

## Reproducibility and provenance

`app.engine.MODEL_VERSION` is `waypoint-0.1.0`. Classification is versioned separately as `rules-0.1.0`. Inputs are ordinary dictionaries with `metrics`, `metric_sources`, and `sources`. A numerical observation is accepted only when its metric source identifier exists in the supplied source list. Missing, non-finite and invalid values are unavailable; they are not replaced with peer averages or model-generated facts. The current implementation trusts the normalizer to map source records accurately; it is not an independent filing-verification system.

Every displayed reason, risk and event references a source identifier. A calculation record stores the model version, input source identifiers, selected holding period, resulting scores and price ranges. All datetimes use UTC with an explicit offset. Pass the same input and `now` to reproduce a snapshot. Record historical snapshots at the application layer; do not recalculate old trades under a new model and relabel those results as their original signals.

`demo_stocks(now)` has no randomness, API calls or real market inputs. Each call returns independent fixture objects. Histories contain 60 synthetic daily closing observations. Metric values ending in `_pct` are percentage **points** except `spread_pct`, which is a decimal proportion. Settings `fx_fee_pct` is also a decimal proportion: `0.0015` means 0.15%. `fx_usd_per_eur` means USD received for EUR 1. Demo catalyst and stability values are fictional; live catalyst values are derived only from the current, timestamped Alpaca/Alpha Vantage headlines and SEC filing metadata, with their source records retained.

## Company classification

Sourced sector-group tags take precedence: financial → Financial (95% classification confidence); biotechnology → Biotechnology (95%); commodity or cyclical → Commodity/cyclical (90%). Otherwise positive net margin and growth ≥20 percentage points means High-growth profitable (85%); positive margin and lower growth means Mature profitable (90%); nonpositive margin with growth ≥15 means Early-stage/unprofitable growth (80%). Remaining companies are Other (55%), or 35% if growth/margin is unavailable. These percentages are heuristic completeness labels, not calibrated probabilities. Classification below 60 prevents a plan.

## Opportunity

Each component is clipped to 0–100; total = sum(component score × weight / 100), rounded to an integer. Displayed components store both score and weight.

| Component | Few weeks | Few months | 1+ years |
| --- | ---: | ---: | ---: |
| Company strength | 15 | 25 | 30 |
| Growth | 10 | 20 | 20 |
| Valuation | 10 | 20 | 20 |
| Price behaviour | 30 | 15 | 5 |
| Catalysts | 25 | 10 | 5 |
| Cash generation | 10 | 10 | 20 |

Company adjustments preserve total 100. Early-stage/biotechnology moves five points from valuation to company strength. Financial moves five from growth to company strength. Commodity/cyclical moves five from growth to valuation. Configurable dictionaries live in `engine.py`; changing them requires a model-version increment.

- Runway score = months / 36 × 100. Debt safety = 100 − 1.3 × debt/assets percentage. Stability uses the supplied 0–100 observation. Company strength = 35% runway + 35% debt safety + 30% stability.
- Banks use 60% capital-buffer score + 40% credit score instead. Capital-buffer score = (capital-buffer percentage − 5) × 10. Credit score = 100 − 20 × credit-loss percentage. Bank leverage is not interpreted with industrial debt thresholds.
- Growth = 45 + growth percentage × 1.2 for high-growth and early-stage businesses; multiplier 2 otherwise.
- Valuation = 100 − max(0, company multiple / sourced reference multiple − 0.5) × 60. Comparability of the supplied multiples is the normalizer's responsibility; this demonstration does not claim a validated valuation estimate.
- Price behaviour = 60 + 400 × trailing 20-observation price return − 700 × max(0, daily volatility − 0.03), clipped to 0–100. Daily volatility is population standard deviation of the last 20 daily fractional returns. Returns above 25% multiply price-behaviour score by 0.6 to reduce chasing. Multiply by min(1, dollar volume / 20 million) for liquidity.
- Catalyst score is a transparent 0–100 observation. In live mode it is derived from classified, timestamped provider headlines and filing descriptions, with a neutral baseline when only filing metadata is available. It is a current evidence screen, not a forecast and not a substitute for a point-in-time historical news archive.
- Cash score = 50 + 2 × free-cash-flow margin percentage. Early-stage/biotechnology uses 70% runway + 30% cash score. Financial uses 50% capital-buffer score + 50% clipped(net margin × 4).

These are intentionally simple transparent submetrics. They do not estimate economic fair value, competitive moat, or revenue durability from filings automatically.

## Risk (independent of opportunity)

| Component | Few weeks | Few months | 1+ years |
| --- | ---: | ---: | ---: |
| Price volatility | 25 | 20 | 10 |
| Valuation risk | 10 | 20 | 20 |
| Business risk | 15 | 20 | 30 |
| Event risk | 25 | 15 | 10 |
| Dilution / debt | 15 | 15 | 15 |
| Concentration | 10 | 10 | 15 |

Biotechnology moves five points each from valuation and price volatility into event risk. Financial moves ten from dilution/debt into business risk. Commodity/cyclical moves five from valuation into concentration.

Price risk is the largest of clipped(daily volatility / 0.06 × 100), liquidity deficiency (100 − liquidity score), and clipped(spread proportion × 4000). Valuation risk = 100 − valuation score. Business risk = 100 − company strength. Event risk = 85 for earnings in 0–7 days, 55 in 8–14 days, and 20 otherwise; a binary event raises it to at least 95. Unknown event data is 100. Dilution/debt is half clipped(dilution percentage × 4), half debt risk; banks use company-strength deficiency for the latter. Concentration uses its supplied percentage. Missing risk inputs are pessimistic, never zero risk.

Opportunity and risk are displayed separately. There is no subtraction of risk from opportunity and no combined "goodness" number.

## Confidence and freshness

Confidence is a weighted sum: completeness 25%; freshness 20%; component agreement 10%; estimate certainty 10%; inverse event risk 10%; fundamental stability 10%; classification confidence 10%; model sensitivity 5%. Agreement = clipped(100 − 2 × standard deviation of opportunity component scores). Estimate certainty = clipped(100 − estimate uncertainty percentage). Model sensitivity = 100 − 0.2 × largest opportunity weight, a bounded sensitivity proxy for perturbing the largest component by ±10 points. This proxy does not replace out-of-sample sensitivity analysis.

Freshness contributes 40 points for a fresh quote, 40 for fresh financials and 20 for a recent news check. Quotes expire after 15 minutes, except explicitly END OF DAY or MARKET CLOSED observations can be up to four calendar days old. Financial reporting dates expire at 190 days. News checks expire at 48 hours. These are conservative development defaults, not exchange-specific guarantees. Timestamp omissions, naive timestamps and timestamps more than one minute in the future are invalid. The application additionally gates actionable entries on the market session and appropriate feed availability.

Required metrics include growth, margin, cash flow, valuation/reference multiples, stability, concentration, dilution, catalyst, uncertainty, earnings timing, binary-event flag, volume and spread. Also require bank capital/credit metrics or non-bank debt metrics plus runway when free cash flow is negative, together with price, at least 30 valid positive historical prices, and quote/financial timestamps. A verified non-negative free cash flow observation is evidence that a finite runway is not applicable; the system never inserts an artificial runway number. Current Alpaca and optional Alpha Vantage headlines can provide a transparent catalyst/event screen, annual EPS or reported revenue can provide a descriptive valuation multiple, and same-refresh sector medians can provide a peer reference; each is labelled as a derivation rather than a reported fact. Customer concentration and estimate uncertainty remain unavailable until a reviewable source is connected, so the engine keeps the plan gate closed instead of guessing. Missing critical input caps confidence at 39 and suppresses plans. Stale information caps it at 49. Binary events cap confidence at 49; earnings within seven days caps it at 59. HIGH ≥80, MEDIUM ≥60, LOW otherwise. Quote absence is represented by numeric `0` solely to satisfy the UI contract, alongside `status=missing`, no history/plan, and explicit missing-input diagnostics; zero must never be used as an executable price.

## Qualifying and planning

A new plan requires: all required inputs present and fresh; opportunity ≥62; risk ≤70; confidence ≥60; classification confidence ≥60; at least USD 10 million daily dollar volume; spread ≤1.5%; no binary event; earnings more than seven days away (or no forthcoming positive-day event); and no business warning. There is no requirement to find a trade. Missing news-check time also prevents a plan. A final reward/downside ratio must be ≥1.6.

Plans are created in the **slow loop**, then held fixed while fast quotes change state. The reference anchor is median of the last ten closes. A move unit is max(1.6 × mean absolute daily dollar movement over the last 20 changes, 1.8% of anchor), multiplied by 1 / 1.5 / 2.2 for weeks / months / years. This is a closing-price movement measure, not ATR (no high/low bars are supplied).

Entry low = anchor − 0.7 move units; entry high = anchor + 0.15 units. Reconsider = entry low − 1.7 units. Define downside distance conservatively from entry high to reconsider. First-profit range = entry high + 2.0–2.7 downside distances; strong-profit range = entry high + 3.4–4.4 distances. Round to USD 0.05 below USD 100, 0.10 below 500, and 0.50 otherwise. Reject nonpositive or collapsed levels. Reward/risk is measured from upper entry to lower first profit. These multiples provide a reproducible map of possible outcomes; they are **not evidence those outcomes will occur**.

Weak scenario = reconsider minus two move units through reconsider; base = entry low through first-profit high; strong = strong-profit range. Each stores explicit assumptions. No probabilities are assigned. Prices can fall outside all scenario ranges. An owned position retains its entry plan at the application layer unless an explicit review changes it.

## State precedence

Business warnings → RECONSIDER_EXIT if owned, SKIP otherwise. Missing/stale price data → WATCH_CLOSELY if owned, NO_SETUP otherwise. No qualifying plan → WATCH_CLOSELY if owned, SKIP otherwise. Price at/below reconsider → RECONSIDER_EXIT if owned, SKIP otherwise. Price warning does not assert that the company business failed.

For owned shares: at/above first-profit low → TAKE_PROFIT; within the lower 35% of reconsider-to-entry-low distance → WATCH_CLOSELY; otherwise HOLD. For a candidate: inside either inclusive entry boundary → BUY_AREA; above entry-high → WAIT; below entry-low but above reconsider → WATCH. All messages are suggestions for manual review. **Actual losses can be higher if price moves suddenly past the reconsider level.**

## Tiny-account sizing and costs

All cost calculations use Python Decimal. No target, borrowing, leverage, previous trade result or recovery objective enters the formula. Small/medium/large allocation caps start at 15% / 25% / 35% of current equity, with planned downside budgets 2.5% / 4% / 6%. Larger accounts use progressively protective marginal bands: count the first EUR 50 at 100%, the next EUR 150 at 75%, and equity beyond EUR 200 at 50%, then apply both fractions to this protected-equity sum. This continuous formula avoids a threshold cliff where a loss crossing a band could increase the next allocation. An unchanged-size-policy loss cannot increase the suggested euro amount; effective fractions gradually decline as equity grows. Risk budgets describe planned outcomes, not maximum possible loss.

Full bid/ask spread is divided into half at entry and half at exit. Estimated buy price = current mid × (1 + half-spread). `amount_eur` is share consideration before entry fees. Quantity = consideration × USD/EUR ÷ estimated buy price. Entry debit = consideration × (1 + FX fee fraction) + fixed fee. Exit proceeds = quantity × exit mid × (1 − half-spread) ÷ USD/EUR × (1 − FX fee fraction) − fixed fee. Thus both FX conversion directions and both fixed fees are counted. Exit projections assume unchanged exchange rate; actual FX, fees, fill and spread may differ. The broker's actual recorded execution replaces this estimated quote in accounting; do not add an estimated spread again to a real fill.

Consideration is the minimum of allocation cap, available cash after entry costs, and amount permitted by the planned downside budget after both fixed fees, rounded **down** to euro cents. Fractional quantity rounds down to eight places. Reject sizes below broker minimum. Reject first net profit below EUR 0.05, below/equal total projected friction, or below 1.2 × planned downside. Reject prices at/below reconsider or at/above first profit. An unviable trade returns zero amount and an explicit explanation. Default fee assumptions are editable examples, not a statement of Trading 212's actual current pricing.

## Validation boundaries

Automated tests cover reproducibility, component totals, classification-specific metrics, holding-period changes, traceability, missing/stale/future data, state boundaries, business warning precedence, fractional conversion, round-trip FX/spread/fixed costs, minimum orders, no-position choice, growth protection, no recovery sizing and independence from the EUR 200 target. The separate backtest is a price-only synthetic walk-forward illustration. Neither these tests nor demo returns establish predictive validity. Live fundamental/news mapping, out-of-sample calibration, survivorship-bias controls and point-in-time real-data evaluation remain required before treating any live analytics as dependable.
