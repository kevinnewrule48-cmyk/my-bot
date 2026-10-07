# Digit Regime Intelligence — Phase 1 shadow implementation

This is research instrumentation for the existing Part One bot. It does not authorize, block, select, delay deliberately, or change orders. No production strategy threshold was changed. Phase 3 execution control is not implemented. There are no measured profitability benefits yet: no actual contracts have been collected by this new observer in this implementation session.

## Checkpoint and scope

Before modifications, the complete `work/release` and `work/publish-part-one` working directories, including uncommitted files, recovery outputs, and Git metadata, were backed up to:

`../../outputs/before-digit-regime-20261007T031411Z.zip`

SHA-256: `bef3d449ba46c1cd088cf00f994e8d1ee9666701d783eb530e1f70f4372dc01a` (13,042,335 bytes).

Implementation branch: `research/digit-regime-shadow`, isolated in `work/digit-regime-shadow`, based on published commit `87b576e5b48b260660063d2aaddab28ff488c6d3`.

Files:

- `public/app.js`: one-way normalized-tick, feed-boundary, candidate, pre-request and broker-receipt observer calls. No observer return value is used in an execution condition or payload.
- `public/index.html`, `public/digit-regime.css`: compact standalone panel and stylesheet.
- `public/digit-regime-engine.js`: pure descriptive digit statistics and provisional research classifications.
- `public/digit-regime-research.js`: pre-entry snapshots, broker correlation, bounded evidence, payout-aware comparison, chronological validation and walk-forward reporting.
- `public/digit-regime-panel.js`: dashboard, IndexedDB persistence, shadow-only window settings, local evidence export.
- `work/digit-regime*.test.mjs`: deterministic statistics, actual dashboard isolation and parallel-strategy integration tests.
- `work/digit-regime-benchmark.mjs`: repeatable engine-cost benchmark.
- `work/digit-regime-evaluate.mjs`: offline evaluation of an exported evidence file.
- `work/fixtures/digit-regime-panel.html`: clearly labeled simulated browser test page, outside the production public directory, with no trading or WebSocket code.

The existing Digit Barrier, Differ, Entry Strength recovery, heat map, Live Digit Wheel, broker connection, proposal construction, settlement handling, server authorization, account locks, cooldown and stale-signal rules remain in their existing modules. No Rise/Fall source files are changed.

## Integration and authority boundary

`addTick()` already calls `extractLastDigit(price, pipSize)`. Immediately after it accepts that normalized digit, it emits a copy containing market, price, epoch, digit and the existing live tick index. This is the sole feed for the new engine. It does not subscribe to Deriv, create a WebSocket, request proposals, use an LLM, or send HTTP requests.

The original application already has market-scanner/tradability subscriptions. Those are not introduced or changed by this feature. The new observer consumes only the currently selected Part One stream, not a second stream or the other markets' scanner histories.

Repeated/out-of-order sequences, repeated/non-increasing broker timestamps, and invalid digits are rejected by the shadow analyzer only. Each market has separate state. A new feed subscription resets that market's shadow segment; a gap over 60 seconds also resets it. This avoids pretending that ticks separated by a feed interruption were adjacent. It does not reset the trading analyzer or its history.

Observer exceptions are caught. Startup events use a bounded 256-event queue until the independent module loads; dropped startup events are disclosed. If the module is missing or broken, the existing app still loads. The engine's exported metadata explicitly says `mode: SHADOW` and `executionAuthority: false`.

## Rolling structures and formulas

Default windows are 25, 50, 100 and 200 ticks. The shadow settings accept 2–8 distinct integer windows between 5 and 2,000. Applying settings resets only shadow history and starts a different parameter cohort. Settings do not alter Part One's own tick-window control. Every trade snapshot retains the configuration in effect at entry. Settings return to defaults on page reload; past snapshots retain their settings.

Each window keeps rolling digit counts and a complete 10×10 transition-count matrix. Adding a digit increments its count and the last→new cell. Removing the oldest digit decrements its count and the removed→next cell. There is no transition across the window boundary. Each matrix therefore sums to `sample − 1`.

Bounded history retains `max(200, 2 × largest configured window)` digits per market. Counts/matrices update incrementally; gap/run descriptions and comparisons scan these small bounded windows. The algorithm never scans the entire session on each tick. At most eight market states and 128 regime transitions are kept.

### Occupancy and zones

For digit d in n observed ticks: `count(d)` and `100 × count(d)/n`. Low extreme = {0,1}; high extreme = {8,9}; combined extreme = {0,1,8,9}; middle = {2,3,4,5,6,7}.

Each digit and zone also has a change against the immediately preceding, non-overlapping window of the same target size, using whatever prior observations are available. `previousSample` makes partial baselines explicit; absent baselines produce null measurements, not a fabricated zero change.

Across a recent and older **disjoint** sample, the pooled two-proportion contrast is:

`p = (k + j)/(n + m)`

`z = (k/n − j/m) / sqrt[p(1−p)(1/n + 1/m)]`

Difference is also reported in percentage points. The provisional evidence boundary is ±2.576: RISING, FALLING, otherwise STABLE. Degenerate identical proportions give z=0. Missing samples give INSUFFICIENT DATA. For nested 25-vs-200 comparisons, the baseline is the older 175 observations, so the recent 25 do not contaminate their own statistical reference.

These are descriptive reference bands, **not valid calibrated p-values under arbitrary digit serial dependence, overlapping rolling tests or multiple comparisons**. Nothing here proves that Deriv digits have a predictive dependency. No research boundary has been fitted to observed trade outcomes.

### Revisits, gaps and runs

For each digit and each extreme zone, record indices where it appears. Consecutive index differences are visit gaps. A gap of one is a repeat/run; it is not a revisit after leaving the digit/zone. Revisit gaps are differences greater than one.

- Average/median revisit gap, minimum among the last five completed revisit gaps.
- Revisit frequency = completed revisits / observed adjacent-tick opportunities (`n−1`).
- Rapid revisit = completed revisit gap ≤3 ticks, with its share of completed revisits.
- Revisit acceleration = mean older completed revisit gaps minus mean last five completed revisit gaps. Positive means gaps compressed. Insufficient older events give null.
- Ticks since last appearance = current index − last observed index. If absent in the entire retained window, this is unknown (null), not an invented wait duration.
- Average digit gap and last-five average gap are included; compression is older-gap mean minus recent-gap mean. Negative compression describes expansion.
- Separate run lists for individual digits, low/high/middle zones, and combined extreme/middle zones include lengths, current run, longest run, run count, runs per tick, and repeat count.

A stream that never leaves the extreme zone can have zero grouped revisits while having maximal extreme occupancy and transition pressure. That is intentional: continuous occupancy, revisiting after leaving, and repeating are different measurements. Gaps never imply that a digit is “due.”

### Transition matrix and Extreme Transition Pressure

Every row contains counts of next digits and row-conditional probabilities; rows without observations have null probabilities.

The primary Extreme Transition Pressure is the direct proportion:

`100 × number of adjacent extreme→extreme transitions / (n−1)`.

There is no arbitrary weighted score. Its explanatory components are kept separately: change against the previous disjoint window, short-versus-older transition contrast, alternating extreme A→B→A bounces with A≠B, bounce share, and rapid-revisit share. It includes all extreme pairings and same-extreme repeats; it is not the pre-existing “jump ≥7” filter.

The uniform independent-digit reference is 0.4×0.4 = 0.16. Wilson bands use the configured z boundary. The same caveat about overlapping transitions and serial dependence applies; bands are provisional descriptors, not certified inference.

### Entropy and distribution divergence

Normalized digit entropy: `−sum(p(d) log2 p(d)) / log2(10)`, in [0,1]. Effective number of occupied digits is `10^entropy`. Conditional transition entropy is the observed-row-weighted normalized next-digit entropy.

For display only: entropy below 0.65 = HIGHLY CONCENTRATED; 0.65–0.9 = CONCENTRATED; ≥0.9 = BROADLY DISTRIBUTED. Incomplete windows show WARMING UP. These provisional display boundaries do not mean good/bad, profitable/unprofitable, or inherently chaotic.

Each configured short/long pair reports per-digit percentage-point differences, total variation distance, Jensen–Shannon divergence in bits against the full long distribution, and JS divergence against the disjoint older distribution. JS uses `0.5 KL(P||M) + 0.5 KL(Q||M)`, M=(P+Q)/2, with zero-mass terms omitted. A separate JS calculation compares all 100 transition cells against the older transition matrix. Entropy changes, extreme occupancy changes, transition pressure changes, and low/high/combined revisit frequency changes are exposed together.

## Provisional state rules and agreement

No FAVORABLE or EXCELLENT profitability label is assigned without outcome evidence. States implemented are WARMING UP, NORMAL, WATCH, DETERIORATING, UNSTABLE, EXTREME and RECOVERING. A new overall state needs three successive unique accepted ticks supporting it. The displayed proposed state and confirmation progress explain pending changes.

Let H mean the short-window extreme-occupancy Wilson lower bound exceeds 0.4; T mean its extreme-transition lower bound exceeds 0.16. Let R/F and TR/TF mean short-versus-disjoint-older extreme occupancy and transition pressure are measurably rising/falling by the descriptive contrast above. Cross-window direction requires both windows to be full.

Rules in priority order:

1. Incomplete shortest window → WARMING UP.
2. F and TF, and not both H/T → RECOVERING.
3. H and T → EXTREME if extreme occupancy ≥80%, otherwise UNSTABLE.
4. R and TR → DETERIORATING.
5. Any H, T, R or TR → WATCH.
6. Otherwise → NORMAL, meaning no agreed extreme deterioration, **not a safe market**.

Window-local states use their own H/T flags without the cross-window recovery condition. Gap, entropy, revisit and transition-shape measurements provide inspectable context; they are not silently made mandatory execution gates, nor do they independently assert a profitable regime.

Agreement is matching flags / four flags ×100. Flags refer to elevated occupancy, elevated transitions, rising occupancy and rising transitions for adverse states; recovery uses falling occupancy, falling transitions and absence of the two elevated measures; NORMAL uses absence of adverse measures. Missing broader measurements do not count as agreement. The UI shows the measured count and matching count. These correlated flags are a transparent descriptive agreement score, not independent evidence or a probability of winning. During a pending transition, the score describes the proposed evidence.

History stores market, broker timestamp, existing tick index, previous/new states, reasons and agreement. Decisions are reproducible from the snapshot's rule version and parameters.

## Independent strategy support and shadow decisions

The losing sets are {0,1} for OVER 1, {8,9} for UNDER 8, and {d} for DIFFER d, for all ten digits. Each side uses its own recent losing-set occupancy and its own disjoint older comparison:

- UNKNOWN / OBSERVE if recent measurements are incomplete or unavailable.
- WEAK / hypothetical BLOCK if losing-set occupancy's lower Wilson band exceeds the uniform reference (0.2 for the two-digit sets, 0.1 for DIFFER) or that occupancy is rising against the full disjoint baseline.
- STRONG / hypothetical ALLOW if its upper band is below the uniform reference and the weak condition does not apply.
- MODERATE / hypothetical ALLOW otherwise, explicitly meaning “no supported warning; no proven edge.”

The broader regime state does not override these side-specific assessments. This is why OVER can be WEAK while UNDER is STRONG. The existing Differ recommendation is logged alongside the independent ten-digit support table. No next digit is predicted.

Every existing OVER/UNDER candidate evaluation and every Differ tick evaluation records the existing READY/NO TRADE result alongside the shadow assessment. READY is strategy qualification, not a claim that a purchase occurred. Actual requests and settlements have separate records.

## Pre-entry records, settlement and retention

Before the existing request is sent, `regimeAttempt()` captures attempt ID, market, side/barrier, mode, account type and account ID, currency if known, stake, available quote payout, broker tick time, local capture time, existing tick index, full regime snapshot and hypothetical decision. It includes retained last 25/50/100/200 digits and configured windows, all statistics, configuration, existing barrier candidates/checks (Momentum, Zone, Stability, Score, Persistence, Confidence, Quality), selected candidate, original minimum/persistence settings, Entry Strength snapshot, Differ state and existing risk/cooldown diagnostics.

This is a **browser pre-request snapshot**, not a claim to know the server's exact future BUY-time stream. Network/proposal latency can separate request time from purchase time. Actual purchase/entry and settlement information arrives later from existing broker receipts. Missing prehistory or payout at request time stays missing; it is not filled with future information. The pre-entry snapshot is cloned and never rewritten with a later regime.

Accepted/reconciled receipts attach by attempt ID or an already-linked contract ID. Mismatched account/contract receipts are rejected by the recorder. Settlement requires an explicit settled state, contract ID, WON/LOST and numeric P/L. Entry digit, official broker entry digit, settlement digit, entry/exit ticks, actual buy price, payout, currency and broker time are retained when present. Mock receipts are labeled and excluded from broker-outcome evaluation. Repeated polling does not duplicate trades or results. Missing snapshots, unknown outcomes and incomplete settlements are disclosed.

Trade records persist in a separate browser IndexedDB database, without changing existing order storage. It retains up to 200 attempts; settled/rejected records can roll out, while unresolved records are preserved. If all slots are unresolved, the observer warns and drops new research captures rather than blocking execution. The persistent store also enforces a 200-record bound across tabs. A storage error is visible and does not change execution. Export frequently for a longer research dataset.

In-memory retention: 500 candidate evaluations, 2,000 normalized ticks, 200 research events, 128 transitions, and at most eight market engines. Drop counts cover the current observer session. Refresh retains trade snapshots, but restarts raw-tick/candidate history and drop counters. Thus evaluation describes the retained cohort, not every historical account trade or an unlimited archive. Browser eviction, clearing site data or closing before an IndexedDB transaction completes can lose evidence; missing records are never reconstructed using future ticks.

## Counterfactual, payout and validation methodology

Only captured completed broker WON/LOST contracts with numeric profit participate. Pending, incomplete and mock records are excluded. Unknown shadow decisions are an explicit unevaluable bucket and are not silently treated as allowed.

For the retained cohort, the report gives baseline and hypothetical allowed/blocked trades, wins, losses, win rate, net P/L, actual returned payout, stake, return on stake, maximum consecutive losses, incorrectly blocked wins, correctly blocked losses and the blocked contract IDs with reasons/P&L. It also groups results by strategy, DIFFER digit and pre-entry regime. Account types, account IDs, currencies, rule versions and parameter configurations are never pooled together.

Win rate = wins / completed trades. Net P/L = sum of broker-reported profit. Net return % = 100 × net P/L / sum of actual buy prices. Unknown buy prices disable return-on-stake rather than fabricating a denominator. Actual payouts and missing payout counts remain separately visible. Selecting only allowed outcomes never relabels a blocked win as a loss or invents hypothetical wins.

This is a filtered cohort comparison, not a causal simulation: blocking a trade can change later cooldowns, available balance, stake sizing or opportunities. The evaluator does not claim to recreate those alternative future paths.

Chronological development/validation split: first 60% / later 40% within each consistent cohort. Training records whose settlement was not available before validation entry are purged. Walk-forward reports use an expanding earlier segment and the next chronological quarter-sized block, with the same purge rule and frozen original decisions. Parameters are not automatically fitted or promoted. A 30-validation-trade display floor is only an explicit small-sample guard, **not proof of statistical sufficiency, generalization or profitability**. Report development and validation separately before drawing conclusions.

Run an exported file offline with:

`node work/digit-regime-evaluate.mjs path/to/export.json path/to/report.json`

No outcomes exist yet for an evidence-based “best/worst regime” conclusion. Phase 2 can populate those comparisons only after collecting broker-settled trades under this frozen observer. Any later calibration must use earlier data only, save a new rule version, and reserve untouched later data. Walk-forward accounting is supported; automatic threshold searching is intentionally absent.

## Validation and practical limits

Deterministic tests cover user scenarios A–G, exact rolling counts/matrices after eviction, extreme run/revisit distinctions, entropy/divergence bounds, independent strategy support, market separation, duplicate/invalid ticks, stale-segment reset, bounds, immutable snapshots, receipt correlation, payout economics, retention, chronological splits and settlement-overlap purging.

Prefix tests run the same tick-N history with unrelated future suffixes and assert that the tick-N object and stored trade snapshot never change. The production observer receives normalized ticks sequentially; it has no future-history input or historical look-ahead lookup.

Actual app VM tests exercise existing OVER/UNDER order dispatch with no observer, an active observer and an intentionally throwing observer. Existing order counts, contract types, cooldown and gate diagnostics match. Parallel strategy tests also verify DIFFER requests, barriers and shadow snapshot timing while preserving arm/stop controls. Existing Part One execution tests retain proposal/BUY/contract/settlement/reconnect/duplicate coverage.

An older `work/parallel-dashboard.test.mjs` suite has seven failures on the unchanged base because its VM omits `TradabilityMarkets`. These failures reproduce before this feature. They are not reported as passes. The new shadow parallel tests use the required dependency without modifying production trading behavior; the existing engine-level parallel tests pass.

Browser checks use an unauthenticated local app and a separate clearly labeled simulated fixture. The local app received 155 public R_100 ticks; at tick 90 its 25T window showed 40% extreme occupancy, 60% middle occupancy and 8.33% extreme-transition pressure while the existing strategy still said NO TRADE. No account was connected; no authenticated demo or real BUY was made. This demonstrates feed reuse and live measurement, not profitable trading.

Performance measurements and final test receipts are in `../../outputs/digit-regime-performance.json` and `../../outputs/digit-regime-regression-final.log`. Measurements cover bounded pure-engine computation after warmup on the local Node runtime, not a universal browser latency guarantee. UI painting is throttled to at most twice per second; snapshots/persistence occur on trade events. There is no deliberate wait for regime improvement on the execution path.

This implementation is local research work. Publication and any Phase 3 use require a separate user instruction; no execution-control switch exists in this engine.

Final verification: 76/76 focused regression tests passed (2026-10-07). Syntax checking and the repository diff whitespace check passed with CRLF line endings recognized. Collapsed details do not serialize large metrics or run retrospective comparisons; opening a section refreshes it.

Browser fixture evidence: 220 simulated extreme digits produced EXTREME with 100% short-window extreme occupancy/transition pressure. After 80 middle digits, the state was RECOVERING, short-window extreme occupancy/pressure were 0%, and the 200-tick window remained UNSTABLE at 60% extreme occupancy. One mock settled record survived a full page reload in IndexedDB. The report retained it but produced zero broker evidence groups and sufficientEvidence=false. No browser console errors were reported in that fixture. This is a storage and observer test, not authenticated settlement verification.

