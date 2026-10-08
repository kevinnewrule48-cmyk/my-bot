# Part One investigation before replacement

Base: 3cda514. Full checkpoint: ../../outputs/before-part-one-balance-20261007T202344Z.zip; SHA256 baebc60cb4c66ce85c0471fa09df892aac9bf0e9f723fa9d9abbf08c777496c9 (17,164,161 bytes).

## Proven findings
- public/digit-barrier-engine.js barrierCandidates generates only OVER1/UNDER8. OVER2/UNDER7 are unreachable. selectCandidate uses symmetric score/support comparisons and rejects exact ties; there is no demonstrated first-match OVER bias here.
- public/premium-dashboard.js render defaults to OVER/1 when selected is null. Manual Explore direction/barrier are presentation-only; its own help says it never changes execution. Auto still uses barrierSnapshot.selected. Thus a manually explored UNDER and an Auto OVER can coexist on screen. This is an architecture/UI conflict, not proof the broker converted an UNDER order.
- public/app.js executeOrder receives the specific button type. The OVER and UNDER buttons are wired independently. Manual Explore is never read by this path. beginOrderAudit and executionRequest reconstruct direction and barrier separately from mutable global analysis.
- public/digit-barrier-engine.js proposalRequest ignores a supplied barrier and reconstructs 1/8 from type. part-one-execution.mjs execute reconstructs the same barriers again. server.mjs /api/order only checks explicit barrier consistency for DIFFER. These prevent four-barrier support and omit end-to-end candidate identity validation.
- public/app.js calculateSignal, DigitBarrierEngine, updateEntryStrength and price-based classifyMarket/scanner all derive independent views. Scanner historyToTicks reads the final character without broker precision, unlike extractLastDigit. Auto switches based on price efficiency, including a consolidation fallback, rather than the actual digit candidate.
- public/digit-regime-research.js feed-start clears selected-market history. app emits only selected-feed ticks to shadow research although TradabilityMarkets already owns independent subscriptions to five markets. This couples regime history to execution selection.
- Continuation uses fixed tick cooldown plus autoAwaitingReset requiring a score drop. Those are strategy pacing rules, separate from account locks, BUY idempotency, permission freshness, settlement/recovery and duplicate attempts. A single boolean READY has no consumed version identity.

## Evidence limits
No historical user account audit was supplied establishing the exact cause of weeks of OVER-only executions or an actual UNDER-to-OVER broker mutation. Static code proves the above defects; mirrored deterministic replays will test direction symmetry and payload identity. Do not invent a historical root cause or claim measured predictive accuracy.

## Preservation/replacement plan
Preserve OAuth/account/session validation, demo-only Auto, stake/user risk ceilings, pending-order mutex, duplicate attempt journal, five-second permission freshness, proposal price/payout validation, server tradability option, Differ engine, reconciliation and authoritative settlement. Replace OVER/UNDER direction reconstruction, price-based pair ranking, selected-feed regime reset, fixed momentum-reset pacing and stale READY reuse with a canonical four-barrier balance state and consumed version authorization. Keep user risk settings distinct from market qualification. No Part Two/Rise-Fall source edits.
