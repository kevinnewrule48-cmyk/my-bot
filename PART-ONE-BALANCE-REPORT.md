# Part One â€” Balance State and Authoritative Decision implementation report

Status: LOCAL REVIEW BUILD. Not pushed to GitHub or deployed to Render. Existing Part One was modified in place in an isolated worktree. No Part Two or Rise/Fall source changes. No authenticated broker trade was placed during this work.

Base: published commit `3cda5145df03aaa24aaf15cd03eb89821eaa9c71`; branch `research/part-one-balance`.

## Checkpoints and scope

Before the consolidated balance implementation: `../../outputs/before-part-one-balance-20261007T202344Z.zip`, SHA256 `baebc60cb4c66ce85c0471fa09df892aac9bf0e9f723fa9d9abbf08c777496c9`. This preserves the previous three working trees, dirty changes, recovery files and Git metadata.

Before the later authoritative-decision addition: `../../outputs/before-authoritative-decision-20261008T011126Z.zip`, SHA256 `51de462110297ed31b129cc56d852d19af646c1cf56dcaaf1cf21d39f33b7820`. This captures the in-progress balance implementation before that addition.

The initial consolidated request authorized replacing the old Part One analysis architecture. The subsequent authoritative-decision request freezes that newly implemented analyzer. The decision addition does not change the scale formula, qualification thresholds, or Digit Regime calculations. One subsequently discovered execution-continuation bug was corrected: compare a barrierâ€™s clearance with the SAME barrierâ€™s prior clearance, not with another barrierâ€™s different reference point.

## Findings and implementation (requested 35-point report)

1. **Historical OVER 1 dominance:** the exact historical cause remains unproved. No account audit covering those weeks was supplied. Code inspection establishes defects below, not that a broker converted past UNDER purchases into OVER.
2. **Responsible old paths:** `public/digit-barrier-engine.js:barrierCandidates/proposalRequest`, `public/app.js:beginOrderAudit/executionRequest/executeOrder`, `public/premium-dashboard.js:render`, `part-one-execution.mjs:execute`, and the Part One order route in `server.mjs`.
3. **UNDER was analyzed:** the old engine generated UNDER 8 independently alongside OVER 1. Mirrored regression fixtures confirm symmetric qualification. Exact score/support ties chose neither.
4. **Where UNDER could be lost:** Manual Explore was presentation-only while Auto read a different selected candidate. This explains a possible display/execution disagreement. Manual UNDER execution buttons themselves mapped to UNDER; historical broker mutation is not established.
5. **OVER 2 previously reachable:** no. Candidate generation produced only barriers 1/8 and proposal construction silently reconstructed those barriers.
6. **UNDER 7 previously reachable:** no, for the same reason.
7. **Selection defects:** no selected candidate could still render a default OVER 1 preview. Price-trend market ranking was independent of digit qualification and could select a consolidation fallback. Four-candidate comparison now uses the canonical state, with no quota or directional alternation.
8. **Manual-selection defects:** old Manual Explore did not control manual execution but looked like a selected trade. New Manual Exploration is explicitly separate, retains the user's choice, and cannot change Autoâ€™s immutable decision. A separate explicit demo manual-execution button only accepts a currently qualified explored candidate.
9. **Proposal/execution defects:** supplied barriers were ignored or reconstructed. Proposals now receive the locked decisionâ€™s exact market, contract type and barrier. OVER 1/2 and UNDER 8/7 are validated mappings; unsupported combinations reject rather than substitute. The server recomputes the supplied balance evidence and checks identity before proposal and purchase.
10. **Restrictions replaced:** fixed OVER/UNDER tick cooldown and confidence-drop rearming were strategy pacing, not duplicate-order controls. Canonical authorization consumption and fresh post-settlement evidence replace them. The existing quiet-transition/persistence gate is retained in the legacy baseline analyzer, not secretly combined with the new balance rules. DIFFER retains its own cooldown. The 10,000 journal-entry ceiling no longer acts as a balance trade-count cap; bounded identities, freshness and the settlement watermark protect reuse. Existing user/server risk ceilings remain unchanged.
11. **Safeguards preserved:** account/session authorization, demo-only Auto, stake ceilings, configured loss/trade/streak limits, atomic account reservation, pending-contract mutex, idempotent attempt IDs, real-account controls, fresh feed checks, proposal price/payout validation, stop/disarm checks, no BUY retry after uncertainty, reconnect/reconciliation, broker settlement and idempotent accounting. A failed research observer cannot authorize or prevent execution. Pre-proposal rejection releases the risk reservation instead of falsely leaving an uncertain-purchase lock.
12. **Canonical architecture:** normalized independent market ticks â†’ `BalanceBook` â†’ immutable `analyzeBalance` state â†’ four independent candidates â†’ qualified ranking â†’ `createTradeDecision` â†’ immutable locked candidate/state/regime snapshot â†’ display, proposal, BUY association, receipt and settlement. The decision ID travels through all those records.
13. **Exact scale measurement:** retain up to 200 validated digits. Let L=P(dâ‰¤1), H=P(dâ‰¥8), D=P(dâ‰¥7)âˆ’P(dâ‰¤2). Signed position is `âˆ’100 Ã— (Hâˆ’L+D)/2`, bounded to âˆ’100â€¦100. Negative is visually OVER; positive UNDER. No five fixed trading buckets. The labels are directional landmarks, not independent entry thresholds.
14. **Broad balance:** expose low/high boundary occupancy, middle occupancy P(2â‰¤dâ‰¤7), broad displacement Hâˆ’L and deeper displacement D. CENTER or symmetric middle activity does not default to OVER.
15. **Barrier clearance:** OVER b uses mean(dâˆ’b); UNDER b uses mean(bâˆ’d). Require clearance above the corresponding uniform-digit reference, 4.5âˆ’b or bâˆ’4.5. Support is observed winning-set frequency; each candidate evaluates its own losing digits. Ranking uses excess support above its own baseline (80% for 1/8, 70% for 2/7), then clearance. This ranking is a descriptive rule, not an estimated expected profit.
16. **Fine/current balance:** compare latest 25 digits against the preceding 25. Expose current support, support change, dangerous-boundary change, circulation changes/distinct digits and stability `100Ã—(1âˆ’total variation distance)` between the two distributions. Strength is `clamp(50+max(0,signed broad advantage)Ã—300Ã—min(1,n/200),0,95)`; it is not a win probability.
17. **Deterioration:** falling recent support or a latest digit in the candidateâ€™s losing set vetoes that candidate. Before BUY, observed new server ticks must retain qualification, direction, strength and clearance. Continuation after settlement also rejects lower strength, reduced same-barrier clearance, increased dangerous pressure or reduced displacement relative to the prior entry. A new direction can independently qualify. This conservative continuation rule is unvalidated for predictive benefit.
18. **Stale authorization:** IDs include version, market, last tick and history hash, plus direction/barrier. A state can be consumed once. Decisions expire five seconds after the analyzed tick; waiting for a connection, pair change or mutex never refreshes their timestamp. Fresh current server observations are mandatory. The server requires continuous observations from the analyzed tick when advancing pre-BUY analysis; it rejects missing, inconsistent or deteriorating evidence.
19. **Consecutive opportunities:** settlement releases the technical account lock. A subsequent signal must be a new state after the settlement watermark and still satisfy qualification/continuation. No arbitrary count of additional ticks or direction rotation is required. Four successive full mock lifecycles for EACH barrier demonstrate this, including wins and losses. This is not proof of unlimited real account trading or a profitability edge.
20. **Five independent markets:** existing `TradabilityMarkets` subscriptions for R10/R25/R50/R75/R100 feed separate bounded histories. Precision comes from Deriv pip_size; duplicate/out-of-order ticks are rejected. Execution pair switching does not reset those histories or the Digit Regime classifier. Existing regime formulas are unchanged.
21. **Auto Pair Selection:** consumes fresh, qualified, available candidates from those five histories. Ranks by strength and excess support. Exact market ties retain the current execution market if tied, otherwise select none. No price-trend fallback and no invented winner. Existing user-enabled tradability protection remains separate and intact.
22. **Inspected vs execution market:** separate fields. Browser inspection of R25 left execution R100 unchanged. The instrument labels both.
23. **Manual vs Auto:** `manualSelection` belongs to exploration. `authoritativeAutoDecision` is created only by the Auto execution path from the analyzer selection. Browser verification showed Manual OVER 1 alongside locked Auto UNDER 7 without changing that decision.
24. **Visual mapping:** the weight uses `left=50+position/2%`, with only a 160 ms CSS transition and reduced-motion support. It is not smoothed history or an invented animation. Live analysis and the locked execution decision are separately labelled. Up to six contract-position markers are displayed; details stay in bounded history.
25. **OVER 1 proof:** deterministic [2,3,7,8,9] fixture selects OVER 1; exact proposal barrier 1; four complete mocked lifecycles.
26. **OVER 2 proof:** [3,5,7,8,9] selects OVER 2; exact proposal barrier 2; four complete mocked lifecycles. Continuation from OVER 1 now compares OVER 2â€™s prior clearance, fixing the cross-barrier unit mismatch discovered by replay.
27. **UNDER 8 proof:** mirrored [7,6,2,1,0] selects UNDER 8; exact proposal barrier 8; four complete mocked lifecycles.
28. **UNDER 7 proof:** mirrored [6,4,2,1,0] selects UNDER 7; exact proposal barrier 7; four complete mocked lifecycles. The same continuation correction applies symmetrically.
29. **NO TRADE proof:** balanced 0â€¦9 sequences yield CENTER/no selected candidate. Dangerous returning digits, insufficient samples, stale data and failed required checks remain blocked. Real captured replay also produced no qualified signals; see below.
30. **UNDER identity proof:** tests preserve UNDER 7/8 through analyzer, immutable decision, proposal, BUY proposal-ID association, contract ID, entry and settlement. Attempts to substitute OVER 1, alter the active decision ID or use another proposal ID send zero BUY messages. Diagnostics include `TRADE BLOCKED â€” AUTHORITATIVE DECISION MISMATCH` with expected/received fields. Broker identity inconsistencies, if reported after purchase, are logged while settlement remains tracked; mismatched records are excluded from balance accuracy summaries.
31. **Replay statistics:** tables below distinguish qualified snapshots, hypothetical next-digit replay entries, and injected mock broker lifecycles. They are not interchangeable.
32. **Win/loss by candidate:** the four-path executor tests each use two injected wins and two injected losses. Those exercise result handling and continuation only. Actual authenticated demo or real broker trades during this implementation: ZERO.
33. **Accuracy by scale region:** actual broker-derived records are grouped by account, account type, currency, analyzer version, barrier and descriptive displacement region. Mock receipts are excluded. There is insufficient actual trade evidence to conclude that deeper displacement improves accuracy, or that any region is profitable. No optimization or automatic tuning was performed.
34. **Preview:** live local dashboard http://localhost:8791/ ; controlled instrument preview http://localhost:8792/work/balance-preview.html . The latter has explicit fixture buttons and NO execution. Desktop and phone-width layouts were visually checked; phone document width equalled scroll width (375 CSS px), with no horizontal overflow. Screenshots were shown in the task. No reference image was attached in the supplied files, so the instrument follows the written physical-scale description.
35. **Remaining limits:** historical account root cause and predictive accuracy are unproved. No authenticated demo validation. The browser supplies the bounded historical digit evidence; the server recomputes its mathematics and independently checks current ticks, but does not independently attest every old browser history tick. The conservative v1 qualification and continuation rules need real demo evidence before drawing performance conclusions. Old paper backtest tools remain labelled/treated as legacy descriptive baseline, not balance authorization. UI risk limits remain deliberate account controls. Local previews require their running servers. No publication was performed.

## Latest authoritative-decision request: where each requirement is satisfied

- Creation and locking: `public/trade-decision.js:createTradeDecision`; called once by `public/app.js:beginOrderAudit`. Deep freeze locks decision, candidate, balance evidence and audit context. The server freezes its retained request too.
- Proposal/purchase validation: `validateTradeDecision`, `validateBalanceRequest`, `validateBalancePurchase`, `assertProposalBinding`, and `PartOneExecution.begin/proposal/send`. Checks exact decision ID, active ID, market, type, barrier, mode, freshness, analyzed evidence and proposal ID. Decision rejection does not silently change a direction or turn Auto off.
- Routing: `proposalRequest` accepts validated explicit 1/2/8/7. `strategyProposal` preserves DIFFERâ€™s separate routing. The production order endpoint requires the authoritative object for OVER/UNDER and derives candidate/state aliases from it.
- UI and history: compact AUTO DECISION field shows identity, market, side, barrier, observed support and lifecycle state. Manual Exploration remains distinct. Expired decisions are labelled as unavailable for a new purchase. Receipts, the contract lifecycle, wheel/history and evidence records carry the decision ID.
- Audit: locked timestamp and ID; all four considered barriers and support; selected support/reason; balance and available regime snapshot; proposal type/barrier/ID; BUY/contract association; purchase-time digit vs broker entry; settlement digit/result; rejected mismatch details. Missing regime evidence is explicitly null, never invented. Retention: 2,000 browser diagnostic events; 1,000 account execution events; 50 journal attempts plus bounded used identities; 250 balance result snapshots; six visible markers.
- Preservation: the decision layer changes routing/identity validation, not qualification numbers or Digit Regime mathematics. The initial consolidated balance redesign and the single continuation comparison bug fix are explicitly distinguished above.

## Tests and actual replay evidence

Full regression run: **237 passed, 0 failed**, before the final additional BUY-binding negative test. Final targeted decision, execution, risk and route run: **51 passed, 0 failed**, including two added regressions for wrong BUY binding and expired pre-proposal reservation release. Across the full suite and additions, 239 distinct cases pass. Suites cover existing risk, execution, auth/stop/disarm, reconciliation/restart, tradability, DIFFER, wheel/settlement, shadow isolation, all four balance paths and mismatches. Tests run with Node test isolation disabled because this environment rejects child-process spawning; no tests were skipped.

The actual HTTP handler + execution manager + risk ledger test runs 25 purchases/settlements with repeated POST idempotency, arm/disarm matrix tests and 150 further endurance purchases with recovery checks. All use mock transport; no live BUY.

Captured public data: 1,000 broker ticks for each of five markets (5,000 total), with actual broker precision. All 5,000 evaluated snapshots rejected; **zero selected candidates and zero hypothetical replay entries**. This sample does not explain the user's earlier weeks of activity. It shows that the current requirements remain selective on this particular capture.

Final captured window support (not future-win probability):

| Market | OVER 1 | OVER 2 | UNDER 8 | UNDER 7 | Position |
|---|---:|---:|---:|---:|---:|
| R_10 | 79.0% | 69.5% | 82.0% | 71.0% | 2.25 |
| R_75 | 76.5% | 69.5% | 81.0% | 73.5% | 4.25 |
| R_25 | 74.5% | 67.5% | 78.0% | 68.5% | 2.25 |
| R_100 | 85.0% | 75.5% | 80.0% | 68.5% | -6.00 |
| R_50 | 74.0% | 67.5% | 78.5% | 70.5% | 3.75 |

Every one of these final-window supports is below the required 90%. Full per-condition values, thresholds and rejection reasons are in `../../outputs/balance-recorded-gate-evidence.json`.

Synthetic replay: two predetermined seeds, each 4,800 ticks, with neutral, boundary-avoiding, directional and extreme-alternating segments. Rules were not tuned on these runs. The second seed is unseen synthetic data, **not an out-of-sample broker performance study**.

| Dataset | OVER 1 selected | OVER 2 selected | UNDER 8 selected | UNDER 7 selected | NO TRADE |
|---|---:|---:|---:|---:|---:|
| architectureStress | 620 | 492 | 656 | 470 | 2562 |
| unseenSeed | 623 | 493 | 588 | 518 | 2578 |

Hypothetical one-tick outcomes after consumption and fresh-state checks:

| Dataset | Candidate | Entries | Wins | Losses |
|---|---|---:|---:|---:|
| architectureStress | OVER 1 | 67 | 67 | 0 |
| architectureStress | OVER 2 | 11 | 11 | 0 |
| architectureStress | UNDER 8 | 25 | 25 | 0 |
| architectureStress | UNDER 7 | 20 | 20 | 0 |
| unseenSeed | OVER 1 | 57 | 57 | 0 |
| unseenSeed | OVER 2 | 26 | 26 | 0 |
| unseenSeed | UNDER 8 | 58 | 58 | 0 |
| unseenSeed | UNDER 7 | 29 | 29 | 0 |

These synthetic regimes deliberately contain boundary-avoiding segments to exercise reachability. Their all-win eligible outcomes are a property of these test sequences, **not measured market performance**. Loss handling is exercised independently by actual executor mock responses, two wins/two losses per barrier. No broker payout, latency or profitability is modeled by the replay. No performance claim should be inferred.

Reproducible commands:

```
node --test --experimental-test-isolation=none work/*.test.mjs
node work/balance-replay.mjs
node work/balance-recorded-audit.mjs
```

Artifacts: `work/fixtures/balance-public-digits.json`, `../../outputs/part-one-balance-replay.json`, `../../outputs/balance-recorded-gate-evidence.json`, `../../outputs/balance-all-tests.log`, `../../outputs/balance-final-targeted-tests.log`.

## Changed source files

New: `public/balance-engine.js`, `public/trade-decision.js`, `balance-authorization.mjs`, `public/balance-scale.js`, `public/balance-scale.css`.

Modified: `public/app.js` (canonical integration, independent analysis, consumed authorization), `public/premium-dashboard.js` (decision display and obsolete previews), `public/index.html` (stylesheet), `public/digit-barrier-engine.js` / `public/strategy-proposal.js` (explicit barrier routing), `public/tradability-markets.js` (existing feed callback and browser-safe reconnect timers), `public/digit-regime-research.js` / `public/digit-regime-panel.js` (independent inspection and read-only audit snapshot), `public/contract-lifecycle.js` (decision/type/barrier integrity), `part-one-execution.mjs` (validation and durable decision lifecycle), `part-one-risk.mjs` (canonical OU uses consumed authorization instead of fixed cooldown), `server.mjs` (required decision, mismatch rejection and bounded 32 KiB Part One order body).

Existing regression harnesses were updated to feed the independent market stream and expect four candidates/new authorization semantics. The old barrier analyzer remains available for regression comparisons; its scoring formulas are unchanged. No Rise/Fall/Part Two source file was modified.
