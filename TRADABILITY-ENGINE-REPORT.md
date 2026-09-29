# Part One — Market Tradability & Extreme-Bounce Engine

Implemented locally, September 29, 2026. Not published to GitHub or Render by this task. Default: **MONITOR ONLY**. No account trades were placed. Real-money Auto remains disabled.

## 1. Existing architecture and preservation

The existing public Deriv socket in `public/app.js` calls `addTick`. `extractLastDigit` in `public/digit-barrier-engine.js` formats the quote using verified `pip_size`, preserving trailing zeroes. Existing strategy history (`ticks`) is trimmed to its own selected window.

The existing Digit Barrier Engine generates OVER 1 and UNDER 8 independently. OVER wins on 2–9; UNDER wins on 0–7. Its Barrier requires at least 50 samples and 90% sample support. Momentum requires non-negative change in own sample support. Zone requires each own losing digit at or below 8%, without an opposite-side minimum. Stability requires five quiet transitions. Score is capped at 95 and calculated from sample advantage and sample size. Persistence counts consecutive qualifying unique ticks. Confidence uses that Score; Quality checks sample adequacy. All eight checks must pass; tied candidate selection does not invent a preferred side.

Existing manual and Auto routes go through account permission, risk reservation, `PartOneExecution`, proposal construction/validation, BUY, and contract tracking. These remain in place. DIFFER continues to analyze independently; the new optional gate applies to new purchases from both strategies and manual orders.

Checkpoint created before changes: `checkpoints/before-tradability-engine-20260929/`. Contains the original public dashboard/modules and server/execution/permission/risk/package files. SHA-256 comparisons confirmed these files are unchanged:

- `public/digit-barrier-engine.js`
- `public/differ-engine.js`
- `public/strategy-proposal.js`
- `part-one-execution.mjs`
- `part-one-risk.mjs`
- `public/contract-lifecycle.js`
- `public/live-digit-wheel.js`

## 2. Integration

Validated live quote → digit → independent rolling tradability history → all four window metrics/states → optional new-entry guard → existing strategy authorization and risk/proposal/execution flow.

The original strategy history is not enlarged or replaced. Both analyzers continue updating during a blocked period. UI drawing occurs in the dashboard's existing render loop, not as an awaited purchase step. No animation waits, sleeps, proposal changes, or additional order requests were added.

The browser gate checks before manual, OVER/UNDER Auto, and DIFFER Auto submissions. In AUTO BLOCK the server independently subscribes to verified ticks through the existing account channel; it does not trust client scores. Its gate is combined with the existing permission callback and therefore rechecked before BUY, including after a delayed proposal. Already purchased contracts retain their normal settlement/reconciliation path.

MONITOR ONLY never applies this additional market-state restriction. Selecting it does not require a new broker round trip. It does not bypass any existing strategy, account, or risk rule.

## 3. Exact formulas and initial testing parameters

These are descriptive, unvalidated parameters, not proven profitable settings. Configuration is exposed in `TRADABILITY_DEFAULTS` and accepted by `new TradabilityEngine(config)`; the panel displays the current configuration.

For N observed ticks in a selected window W, E = max(0,N−1) eligible adjacent transitions. A crossing occurs only between {0,1} and {8,9}, in either direction. Middle digits interrupt an extreme-bounce sequence. Jump = absolute difference between adjacent digits.

Let C be crossing count, J the sum of jumps, L the number of jumps ≥7, R the longest consecutive run of jumps ≥7, D the number of adjacent nonzero jump-direction reversals, and S the current consecutive crossing run. Equal-digit movement breaks the direction comparison. The first edge's comparison with an edge outside the selected window is excluded.

All normalized components use clamp(x) = min(100,max(0,x)). Empty denominators produce zero raw activity, but insufficient samples remain COLLECTING DATA.

| Component | Formula |
|---|---|
| Raw extreme bounce rate | 100 × C/E |
| Normalized crossing component B | clamp(100 × (C/E) / 0.30) |
| Average absolute jump | J/E |
| Normalized average jump A | clamp(100 × (J/E) / 7) |
| Large-jump component Ls | clamp(100 × (L/E) / 0.30) |
| Large-run component Rs | clamp(100 × R / 4) |
| Direction component Ds | clamp(100 × D / max(0,E−1)) |
| Range instability I | 0.35B + 0.20A + 0.25Ls + 0.10Rs + 0.10Ds |
| Recent pressure P | 0.50B25 + 0.30B50 + 0.20B100 |
| Bounce clustering K | clamp(100 × crossings in latest 20 ticks / eligible transitions in those ticks / 0.50) |
| Consecutive crossing component Sx | clamp(100 × S / 4) |
| Chaos | clamp(0.20B + 0.20I + 0.30P + 0.20K + 0.10Sx) |

Bt is the normalized crossing component calculated over the newest t ticks. Each recent subwindow is limited to the available primary-window history. The configuration supports non-unit weight sums by dividing weighted sums by the sum of weights. Cluster span defaults to 20 ticks and is configurable. The individual 7/8/9 jump counters remain separate from the combined large-jump component.

State targets: Chaos <40 → TRADABLE; 40–<70 → CAUTION; ≥70 → NOT TRADABLE. Three consecutive new-tick evaluations must confirm a state change. NOT TRADABLE is retained until Chaos <62; CAUTION is retained against an improvement to TRADABLE until Chaos <32. These are 8-point hysteresis margins. Repainting or changing the selected window does not count as a new confirmation.

Trend uses up to 20 full-window Chaos evaluations. Compare the newer half's mean with the older half's mean, requiring at least six evaluations: difference >3 = WORSENING, <−3 = IMPROVING, otherwise STABLE. A sustained high plateau can correctly show STABLE while still NOT TRADABLE.

## 4. Dashboard metrics

- **Analysis window:** 100, 200, 500, or 1000. Changes immediately using retained history. Additional sizes can be added to configuration; the server accepted-window list uses the same defaults.
- **Sample:** actual retained ticks / selected requirement; never padded with invented ticks.
- **Extreme crossings:** C and E, plus separate bidirectional 0↔9, 0↔8, 1↔9, 1↔8 counters and LOW→HIGH/HIGH→LOW totals.
- **Extreme bounce rate:** raw percentage, distinct from the normalized crossing score used in Chaos.
- **Range instability/recent pressure/clustering:** the normalized components defined above.
- **Current/largest cluster:** crossings within the latest configured cluster span / largest count within any such contiguous span inside the selected window.
- **Consecutive crossings:** current uninterrupted crossing run.
- **Longest bounce:** largest crossing run; ticks in that run = crossings +1, or zero if no crossing exists.
- **Average crossing interval:** (last crossing sequence index − first crossing index)/(C−1); unknown when fewer than two crossings exist.
- **Average jump; jumps 7/8/9:** raw average absolute difference and separate exact-size counts.
- **Crossings last 20/50/100:** raw counts, clipped to primary history during warmup.
- **Chaos/state/trend/reasons:** combined score, hysteretic classification, history-based direction and explanatory counts.
- **Multi-window cards:** independently evaluated 100/200/500/1000 states and scores; incomplete cards show sample/requirement instead of a completed score.
- **Debug:** current/previous digit and zone, jump, crossing flag, raw sums, normalized components, recency subwindows, continuity reason, and score.
- **State log:** bounded change history with symbol, timestamp, window, previous/new state, score and supporting counts. Full component details are also included in the existing diagnostic audit and server change log.

The new glossy panel sits below the market scanner; phone ordering preserves the existing suggested-entry and execution panels. At a 390px viewport it measured about 367px wide with no internal horizontal overflow.

## 5. Data integrity, warmup, recovery and assumptions

- Fixed-capacity transition ring plus aggregate tree; at most 1000 retained ticks under defaults. Append/range operations are logarithmic in capacity, with four bounded window evaluations rather than rescanning 1000 digits each tick.
- Duplicate/non-increasing epochs are ignored. Invalid digit/precision/quote, symbol change, reconnect, and gaps over the configurable 10 seconds reset continuity. New public tick messages must match the subscribed symbol.
- A >10-second gap is a conservative heuristic, not proof that every missing tick can be detected. No absent quotes are fabricated or interpolated. Intended markets are the current R10/R25/R50/R75/R100 feeds with seconds-based timestamps.
- One active history is maintained per browser; symbol changes reset it. Server histories are per account/current symbol. Concurrent different-symbol AUTO BLOCK sessions on the same account can fail closed due to a mismatch; simultaneous multi-market account trading is not introduced here.
- Default warmup policy is `block`; the isolated engine also supports `allow` for controlled replay/configuration. The shipped server uses conservative `block`. CAUTION permits new entries subject to all old requirements; NOT TRADABLE blocks them.
- Server collection starts when AUTO BLOCK is enabled, so its sample can lag the browser. The panel shows server progress explicitly. No history download/hydration is added. At one tick per two seconds, 500 fresh ticks take roughly 17 minutes; 1000 roughly 33 minutes.
- Server tick freshness limit: 5 seconds since last accepted verified tick. Configuration changes remain blocked until acknowledged; failed AUTO BLOCK configuration remains blocked until successfully retried or the user selects MONITOR ONLY.
- Refresh/Stop/session reset revokes the gate configuration along with the old execution permissions; requesting AUTO BLOCK without matching server configuration cannot buy. Default monitor mode is restored on a new page.
- Recovery uses new ticks and normal hysteresis, not a timer or refresh. Blocked signals are not queued for later purchases.

## 6. Tests and synthetic replay

Full targeted regression: **118 tests passed, 0 failed**, approximately 4.4 seconds in the recorded run. Includes the original strategy, mirrored candidates, gates, permissions, risk, parallel strategies, HTTP order handlers, execution lifecycle, wheel markers and new tradability tests.

New coverage includes A–F requested synthetic cases, raw pair counters, ring-wrap comparisons against brute force, duplicate/out-of-order/gap/symbol handling, immediate window changes, confirmation/hysteresis, server freshness and configuration matching, HTTP rejection in AUTO BLOCK, recovery, a late proposal being blocked before BUY, and an already-purchased contract settling while new entries are blocked. Real app VM tests prove both analyzers advance while submissions are blocked and a later qualifying tick can submit after recovery.

| Synthetic case | Window/sample | Final Chaos | Raw bounce rate | Recent pressure | State |
|---|---|---:|---:|---:|---|
| Stable middle | 100/100 | 2.094 | 0% | 0 | TRADABLE |
| Heavy bounce | 100/100 | 100 | 100% | 100 | NOT TRADABLE |
| Isolated crossing | 100/100 | 5.220 | 1.010% | 2.714 | TRADABLE |
| Calm older history + 50 bouncing ticks | 500/500 | 75.444 | 9.820% | 100 | NOT TRADABLE |
| Heavy bounce followed by calm history | 100/100 | 2.571 | 0% | 0 | TRADABLE |
| Incomplete window | 83/500 | 100 partial/debug only | 100% partial | 100 partial | COLLECTING DATA |

Benchmark (`node work/tradability-replay.mjs`), local 10,000-tick synthetic run: mean 0.097ms per engine push; p95 0.157ms; maximum 4.867ms; retained ticks 1000. This is engine computation only, not network latency, browser rendering time, or a production throughput guarantee.

Browser smoke test: real public R100 stream reached 31/200 ticks, with no browser error logs. No account was connected and no trade was submitted. Feed was stopped after verification. Full-window live trading effectiveness has NOT been validated.

Run the new tests using `node --test --test-isolation=none work/tradability-engine.test.mjs work/tradability-authority.test.mjs`. Existing regression tests remain in `work/`; the modified VM fixtures inject the real new engine rather than mocking its behavior.

## 7. Screenshot: Auto ON / PURCHASE BLOCKED

The screenshot proves the server rejected execution permission; it does not establish which check failed. Existing possibilities include a stopped/replaced session, account/run mismatch, disarmed strategy, stale timestamp/device clock, failed condition gate, or expired account/request. We did not access the affected authenticated session or reproduce that exact live failure.

The old UI misleadingly used “Auto Bot is still ON” for every rejection. It now distinguishes the local switch setting from server execution status. Permission diagnostics now return the specific failed check instead of the generic restart message. The existing allow/deny predicate, five-second freshness checks, and explicit-start requirement are unchanged. This improves diagnosis; it is not a claim that the reported live rejection has been conclusively fixed.

## 8. Files

Created:

- `public/tradability-engine.js` — isolated calculations, bounded history, configuration, replay API.
- `public/tradability-panel.js` — panel controls, metrics, explanations/debug/log.
- `public/tradability.css` — scoped glass styling and responsive layout.
- `part-one-tradability.mjs` — server authority and freshness/configuration gate.
- `work/tradability-engine.test.mjs` — metric/replay/data-integrity tests.
- `work/tradability-authority.test.mjs` — server guard and contract lifecycle tests.
- `work/tradability-replay.mjs` — reproducible synthetic summary and computation benchmark.
- `TRADABILITY-ENGINE-REPORT.md` — this report.
- Backup/checkpoint copies in the directory listed above.

Modified:

- `public/app.js` — live feed integration, independent history, gate synchronization, pre-entry checks, status wording.
- `public/index.html` — new scoped stylesheet link.
- `public/premium-dashboard.js` — panel mount/render, without replacing existing panels.
- `server.mjs` — settings/status routes, verified tick hook and additional permission composition.
- `execution-permission.mjs` — clear gate state on reset; explanatory permission diagnostics only.
- `work/canonical-contract.test.mjs`
- `work/parallel-dashboard.test.mjs`
- `work/part-one-integration.test.mjs`
- `work/part-one-execution-ui.test.mjs`
- `work/part-one-execution-routes.test.mjs`
- `work/purchase-interlock.test.mjs`

Existing behavior changes are limited to the requested optional pre-entry gate, stricter rejection of duplicate/out-of-order/mismatched public ticks, resetting new gate state with execution state, and clearer permission rejection information. No Part Two feature changes were made.

## 9. Next validation

Keep MONITOR ONLY during initial collection. Replay timestamped, precision-verified real historical ticks through `TradabilityEngine.push` using exactly the same formulas. Record both existing candidates and gate decisions at each eligible entry; compare separately for OVER 1 and UNDER 8, with and without the filter, using actual payout/stake assumptions and chronological train/validation/holdout splits. Avoid tuning thresholds on the evaluation set. Measure opportunity counts, net return, drawdown, uncertainty and sample size—not only win rate. Then forward-test on demo before considering live use.

No evidence of improved profitability is claimed. TRADABLE means only that these configured digit-behavior rules passed.
