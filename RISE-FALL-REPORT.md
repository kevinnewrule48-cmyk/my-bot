# Consent ATM — Rise/Fall implementation and verification

## Status

Implemented on 2026-10-01; publication requested the same day. The replacement dashboard is at `/rise-fall/index.html`. Real-money execution is unconditionally disabled in the new module. No actual demo purchase has been made during development: the local process had no configured OAuth environment or authenticated account session. The audit explicitly records `PENDING_AUTHENTICATED_DEMO_SESSION`. Deployment does not constitute demo execution verification.

## Preservation and architecture

Checkpoint: `checkpoints/before-rise-fall-20261001-100239/` contains the original public directory, server modules and package configuration. The existing Part One strategy, digit barrier, thresholds, selection, wheel and execution implementation are unchanged. Their source hashes were compared with the checkpoint.

Original architecture: browser public Deriv tick feed → Part One digit/strategy modules → explicit server execution permission and risk checks → `PartOneExecution` authenticated OTP WebSocket → proposal → buy → `proposal_open_contract` → durable results. Part Two had independent browser code plus `part-two-orders.mjs`, `part-two-fast.mjs`, and `part-two-auto.mjs`.

The server no longer loads Part Two's execution modules. Its old API returns 410 and old page URLs redirect to Rise/Fall. The main navigation opens Rise/Fall. Old source files are retained for recovery but are not served through the old page or executed by the server.

New path: live prices / past-only tick history → multi-window movement pressure → EMA and price structure → efficiency-based trend strength → momentum/persistence → chop and volatility → independent CALL/PUT candidates → mandatory gate → current authenticated demo Auto authority → live contract availability/duration check → matching fresh proposal → one purchase → broker contract monitor → settlement. OAuth, account lookup and authenticated OTP connection factory are reused. The new strategy does not reuse digit scores or infer settlement from chart prices.

## Formula definitions

- Movement: `up_i = max(p_i-p_(i-1),0)`, `down_i = max(p_(i-1)-p_i,0)`.
- Pressure: `100*sum(up)/(sum(up)+sum(down))`, and the analogous down ratio. Flat windows yield neutral 50/50 pressure and zero efficiency.
- Windows: 10-tick diagnostic, configurable micro 20, short 50, medium 100, structural 200; optional macro 500. Windows count price changes and require one extra price. Every required window must meet the directional pressure threshold.
- Efficiency: `100*abs(last-first)/sum(abs(change))` over each window.
- EMAs: recursive `EMA = alpha*price+(1-alpha)*previousEMA`, `alpha=2/(period+1)`, periods 10/30/80 initially. Warm-up requires at least max(structural+1, slow*3, optional macro+1) prices.
- Slopes: ordinary least-squares price slope over micro prices and EMA slopes over the last 10 values.
- Structure: complete groups of 10 ticks form OHLC tick candles. Mean highs and lows of the latest three completed candles are compared with the preceding three. Rise requires both to increase; Fall requires both to decrease. These are tick candles, not one-minute exchange candles.
- Trend strength (ADX alternative, not ADX): `0.60*shortEfficiency + 0.40*mediumEfficiency`. Direction is determined separately.
- Persistence: percentage of five recent, non-overlapping 10-price segments that move in the candidate direction.
- Tick/candle alternation: percentage of adjacent nonzero movement signs that reverse.
- EMA compression: `100*(1-min(1,abs(fastEMA-slowEMA)/(5*shortMeanAbsoluteMove)))`.
- Range compression: `100*(1-min(1,shortPriceRange/(structuralMeanAbsoluteMove*sqrt(shortWindow))))`.
- Pressure balance: `100-abs(shortUpPressure-shortDownPressure)`.
- Failed breakouts: percentage of breaks beyond the preceding ten prices whose immediately following price returns inside that range; only already-observed prices are used.
- ChopScore: `0.22*tickAlternation + 0.10*candleAlternation + 0.20*(100-efficiency) + 0.12*emaCompression + 0.08*rangeCompression + 0.12*pressureBalance + 0.08*failedBreakouts + 0.08*(100-persistence)`.
- Velocity: mean micro price change. Acceleration: current micro velocity minus preceding micro velocity.
- Candle body strength: mean of the last five candles' direction-adjusted body/range percentages, clamped to 0–100.
- Momentum: `0.45*microDirectionalPressure + 0.30*microDirectionContinuation + 0.25*candleBodyStrength`.
- Pullback: distance from the candidate's recent directional extreme divided by total micro travel, as a percentage. Maximum 35%.
- Reversal pressure: opposite micro pressure. Sharp deceleration blocks when current directional velocity falls more than 65% below the preceding micro velocity.
- Volatility: short mean absolute movement / structural mean absolute movement. UI shows this relative ratio times 100, not implied volatility or an annualized measure. Default accepted ratio 0.05–4.
- Confidence: `0.22*shortPressure + 0.14*mediumPressure + 0.10*structuralPressure + 0.15*trendStrength + 0.14*momentum + 0.10*directionalPersistence + 0.10*efficiency + 0.05*(100-ChopScore)`.

Mandatory starting gates: pressure ≥65%, confidence ≥80%, chop ≤35%, efficiency ≥60%, trend strength ≥60%, persistence ≥65%, directional EMA alignment/slopes/structure, positive candidate velocity, momentum ≥65%, acceptable volatility/pullback/deceleration, sufficient fresh data. A tie/conflict produces NO TRADE. Scores are not calibrated winning probabilities.

## Execution and discovered integration issues

Live `contracts_for` returned CALL/PUT entries under `contract_category: callput` with `barriers: 1`. Assuming Rise/Fall metadata always has zero barriers was incorrect. The filter now uses CALL/PUT and callput metadata, and deliberately omits the suggested barrier from the proposal. Read-only live proposals confirmed the descriptions “strictly higher than entry spot” and “strictly lower than entry spot” for five ticks.

For R10/R25/R50/R75/R100 the sampled metadata allowed 1–10 ticks, 15 seconds–1 day, and 1–365 days. These are observations, not hard-coded runtime permissions. Each account's connection fetches its own availability; pre-purchase metadata expires after 60 seconds, and Deriv must accept the exact proposal. Replay coverage currently permits demo Auto only for tested symbol/settings/duration combinations (1, 5, 10 ticks).

The host clock was about one hour behind Deriv. New browser/server analyzers obtain the offset from Deriv's `time` endpoint before checking tick timestamps. Proposal age and authorization leases use elapsed local time separately.

Every purchase requires an active demo account, an explicitly started Auto session, a current heartbeat (20-second lease), unexpired authentication, fresh matching signal, unconsumed signal episode, matching symbol/duration/stake/currency, valid recent proposal, no unresolved Rise/Fall contract and no active Part One execution. Part One also checks the Rise/Fall account lock immediately before its purchase. A new page stops Rise/Fall Auto; closing the page sends Stop and the lease is a fallback.

Purchase intent is journaled before sending BUY. Uncertain BUY outcomes are never retried. Known contract IDs can be reconciled after reconnect/restart; read-only periodic contract reconciliation backs up the subscription. Unknown purchases without a returned contract ID remain blocked for broker reconciliation. No arbitrary chart tick clears that lock. Results require matching Deriv contract ID, terminal status and finite profit. Entry/exit prices are independent broker fields.

Demo verification limits: stake ≤50 account-currency units, at most 100 orders/day and gross-loss-plus-next-stake budget 100/day. Real accounts cannot pass connection validation irrespective of the existing Part One real-trading environment setting.

## Testing and replay

18 Rise/Fall deterministic tests pass, covering mirrored trends, flat/choppy/stale markets, short-window-only movement, deceleration, repeated ticks/signals, supported durations, exact proposal matching/expiry, broker-only settlement, duplicate prevention, Stop during proposal, ambiguous BUY, expired authorization, cross-strategy lock, real-account rejection, clock offset, missing replay evidence, actual-format metadata, subscription recovery and causal replay.

Existing Part One barrier, execution, risk and parallel-strategy checks also passed (45 tests), plus three existing HTTP/UI/integration checks. One HTTP fixture needed the new route and lock dependencies injected; no trading assertion was removed. Total unique focused checks: 66.

Historical source: Deriv public `ticks_history`. Requests are paginated because count 5000 returned only 1000 ticks per response. Five recordings contain 5000 prices each (25,000 total). Each recording is split chronologically 60% training / 40% held-out validation (10,000 validation ticks total). Four fixed profiles × five symbols × three durations × two partitions = 120 runs. Profiles vary EMA periods, pressure windows, strength, chop, efficiency and confidence thresholds. No profile was selected after inspecting validation results.

All four profiles produced zero qualifying trades in this sample. Signals/trades/wins/losses are zero, win rate is unavailable, and maximum consecutive losses is zero due to no trades—not demonstrated risk control. The report includes separate rows by symbol and duration and group fields by side, market state and confidence band; empty groups mean no observations. These results do not validate profitability or justify lowering thresholds.

Replay assumes one observed tick of entry delay and equality as a loss. It is hypothetical and does not label local price comparisons as actual trades. Historical proposal payouts are unavailable, so no monetary profitability claim is made. The replay is sufficient to inspect gating and lack of signals, not to certify production trading.

Actual demo audit: `outputs/rise-fall-demo-audit.json` records zero purchases and PENDING_AUTHENTICATED_DEMO_SESSION. An authenticated demo session and qualifying live signal are still required to complete broker execution verification. This environment has no DERIV OAuth variables configured. Real-money execution remains disabled, regardless of replay result.

## Changed and new files

Changed: `server.mjs`, `public/index.html`, `.gitignore`, `work/part-one-execution-routes.test.mjs` (fixture dependencies only).

New implementation: `rise-fall-service.mjs`, `rise-fall-transport.mjs`, `public/rise-fall/index.html`, `public/rise-fall/style.css`, `public/rise-fall/app.js`, `public/rise-fall/engine.js`, `public/rise-fall/contracts.js`, `public/rise-fall/replay.js`.

New verification: `work/rise-fall.test.mjs`, `work/rise-fall-history.mjs`, `work/rise-fall-replay.mjs`, `work/rise-fall-probe.mjs`, `work/rise-fall-audit.mjs`, this report, `outputs/rise-fall/R_10.json`, `R_25.json`, `R_50.json`, `R_75.json`, `R_100.json`, `outputs/rise-fall-replay-report.json`, `outputs/rise-fall-demo-audit.json`.

Reproduce: `node --test --test-isolation=none work/rise-fall.test.mjs`; `node work/rise-fall-history.mjs`; `node work/rise-fall-replay.mjs`; `node work/rise-fall-audit.mjs`.

API references: https://developers.deriv.com/comparison/contracts-for/ and https://developers.deriv.com/docs/trading/proposal/ .
