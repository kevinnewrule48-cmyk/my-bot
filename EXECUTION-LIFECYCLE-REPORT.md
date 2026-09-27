# Part One execution investigation — 27 September 2026

## Scope and evidence

Updated the existing Part One bot, not a new bot. Strategy thresholds, Momentum, Zone, Stability, Score, Persistence, Confidence, Quality, candidate selection and the 100% condition gate were not loosened or changed. The earlier removal of the opposite-side 10% Zone rule remains intact. The Digit Barrier engine and Part Two files match the pre-change checkpoint.

The defects below are reproduced against the checkpoint's actual server/browser source using mock WebSockets. They explain a possible freeze but do **not** establish which defect occurred in the user's live account: no affected live execution log or authenticated demo session was available. No actual purchase was made. Changes are local, not published to GitHub or Render. Real-money Auto remains disabled.

## 1. Where the lifecycle stopped

In the controlled reproduction, five contracts complete; contract six is purchased but its settlement update is withheld. The old server's overall 15-second watchdog rejects the settlement promise. The browser sees a failed receipt, stops polling, and leaves contract six in `autoContractIds`. Subsequent signals reach analysis but `maybeAutoOrder` returns before sending another order.

A second reproduced defect: a retained subscription for contract one can deliver a late terminal frame while contract seven is active. The old handler applies it to contract seven without comparing contract IDs.

## 2. Root causes

- One global active-stage handler routed unrelated asynchronous messages without request-ID matching or contract-ID validation.
- Terminal/error paths did not consistently release browser execution state or continue reconciliation.
- Old contract subscriptions were never explicitly forgotten.
- A settled contract without `entry_spot`/`entry_tick` could leave the entry promise unresolved after the watchdog was cleared. BUY confirmation should acknowledge the purchase independently of when the entry quote becomes available.
- Unrelated WebSocket API errors could reject the current trade.

## 3. Responsible files/functions

In the checkpoint: `server.mjs` — `openTradeChannel`, its message handler, and `accountOrder`; `public/app.js` — `loadRecentOrder`, `trackRecentOrder`, and `maybeAutoOrder`.

The replacement execution transport is `PartOneExecution` in `part-one-execution.mjs`. Signal calculation remains in the existing application and Digit Barrier module.

## 4. Why after several trades?

There is no demonstrated hard five-trade ceiling. The failure depends on delayed/missing responses and retained subscriptions, which accumulate across trades. The reproduction deliberately withholds the sixth settlement; it does not prove the live failure always occurs on trade six.

Existing independent blockers remain: one pending order per account, configured session limits, Auto cooldown, and optional momentum reset. Defaults include five cooldown ticks, not five maximum trades; maximum session trades defaults to 5,000. Existing risk limits are not reset or relaxed by this fix.

## 5. Did Deriv receive the failed requests?

Unknown for the user's incident. In the mock reproduction, the sixth BUY was sent and acknowledged. New logs distinguish request preparation, send, broker BUY confirmation, and settlement. A successful WebSocket `send` alone is not proof that Deriv accepted the purchase.

## 6. Were BUY requests rejected or never sent?

In the reproduced stuck-lock case, subsequent orders are never sent because `autoContractIds` remains populated. A separate test covers an explicit BUY rejection and verifies no automatic resubmission. Live account evidence is required to distinguish rejection, delivery failure and missing confirmation in the original incident.

## 7. Were contract IDs received?

Yes in the controlled missing-settlement reproduction; unknown for the user's original incident. The updated transport records the ID from the matching BUY response immediately, resolves the entry receipt at that point, and monitors only that contract. It does not invent an entry digit from the current screen price.

## 8. Were settlement updates lost?

The reproduction withholds one update to test loss/delay. The old handler can also misattribute late updates. This proves handling defects, not a broker outage. The new watchdog re-subscribes to the known contract, accepts a late valid settlement once, and forgets obsolete contract subscriptions. Missing entry/exit prices remain unavailable rather than fabricated.

## 9. Which lock prevented subsequent orders?

The old browser's `autoContractIds` is the demonstrated stale lock. Other inspected state includes `autoInFlight`, `manualOrderPending`, `recentOrderPoll`, `autoAwaitingReset`, `lastAutoSignalTick`, the server's old `channel.active`, and the demo risk ledger's `pending` reservation.

The server execution journal is now authoritative for active attempts. Continuous account-scoped polling reconstructs browser locks, including after refresh. Stop Auto prevents new Auto orders but does not cancel settlement monitoring. Manual HTTP requests also have a separate in-flight guard to prevent repeated clicks while acknowledgement is pending.

## 10. Code changed

Modified existing files:

- `server.mjs`: replace the faulty Part One transport with the execution manager; authenticate account-scoped status/recheck; return correlated execution/error details; connect risk accounting to reconciliation; retain existing real-money controls.
- `part-one-risk.mjs`: add the attempt ID to the pending reservation so recovered settlement can release the correct reservation; limits unchanged.
- `public/app.js`: attempt IDs and audit evidence; continuous polling; explicit unresolved status; browser lock recovery; HTTP pending guard; storage-error reporting without blocking settlement; duplicate-result/display-clear protection.
- `public/premium-dashboard.js`: small Execution engine section, independent strategy/execution status, recent attempts, event log, read-only recheck.
- `public/premium-model.js`: execution waiting/error status takes precedence over strategy READY in the overall status.
- `.gitignore`: exclude runtime execution journals from publishing.
- `work/part-one-risk.test.mjs`: update the transport wiring assertion, preserving risk-before-proposal verification.
- `work/premium-dashboard.test.mjs`: test execution-state precedence.

New files:

- `part-one-execution.mjs` — durable execution state machine and correlated transport.
- `work/reproduce-old-execution.mjs` — reproduction using checkpoint source.
- `work/part-one-execution.test.mjs` — lifecycle and failure-injection tests.
- `work/part-one-execution-routes.test.mjs` — actual HTTP handler with mocked broker transport.
- `work/part-one-execution-ui.test.mjs` — actual browser application code in a controlled DOM harness.
- `EXECUTION-LIFECYCLE-REPORT.md` — this report.
- `checkpoints/before-execution-lifecycle-20260927/` — 63 preserved project files plus SHA256 manifest; credentials/runtime account data excluded.

## 11. Safeguards and recovery

The lifecycle is:

`SIGNAL_READY → PROPOSAL_PENDING → PROPOSAL_READY → BUY_PENDING → CONTRACT_OPEN → CONTRACT_PENDING → SETTLEMENT_PENDING → SETTLED → IDLE`

A valid, still-fresh warmed proposal can skip the new proposal wait; an already-settled first contract response can skip the running state. Neither is a missing lifecycle event. `REJECTED`, `RECONCILING` and `RECONCILIATION_REQUIRED` are explicit outcomes.

- Unique attempt ID, per-account sequence, persisted request IDs, proposal ID and contract ID.
- Client signal/gate evidence is joined to server events by attempt/decision ID; client strategy evidence is explicitly labelled, not represented as server-verified strategy authorization.
- Structured errors include broker code/message, sanitized echo request and request ID when available, plus attempt, contract, symbol, side, stake and timestamp. No authorization tokens are intentionally journaled.
- BUY intent is persisted before sending. Repeating an attempt ID does not send another BUY. Reusing it with different order details is rejected by the route.
- Stage watchdogs: proposal 8 seconds, BUY 10 seconds, first contract response 15 seconds, settlement 15 seconds. Reconnect/authorization transport waits are bounded separately.
- After a known-contract timeout/disconnect, recovery only queries/subscribes to the original contract. Maximum three automatic reconciliation attempts; the dashboard offers a further read-only recheck.
- Unknown BUY outcome: request portfolio/statement evidence and retain an explicit unresolved lock. Absence from an open-contract portfolio cannot prove that no purchase occurred. An unrelated matching-looking transaction is not assigned by guesswork. A delayed correlated BUY reply can restore normal monitoring.
- **An unknown BUY with no recoverable contract ID cannot safely be reset automatically.** It requires broker/account reconciliation. The bot displays this blocker instead of freezing silently or risking a duplicate purchase. “Never permanently freeze” cannot honestly mean automatically buying again when the original outcome remains unprovable.
- Settlement and accounting are separate. A ledger failure preserves the confirmed result, displays `ACCOUNTING_FAILED`, and retains the lock until a read-only recheck successfully records it.
- One listener set per channel; request and contract routing; generation checks reject stale-socket messages; old contract subscriptions are specifically forgotten without removing tick subscriptions.
- Retains 50 attempts, 1,000 events per account and 10,000 idempotency IDs. Capacity exhaustion is explicit, not silent ID reuse. Dashboard returns the latest 20 attempts/150 events and displays 80 events; export includes the returned execution snapshot.
- Journals are single-process local files. Restart recovery assumes the same files remain available. Before deployment, ensure `PART_ONE_EXECUTION_PATH` and `PART_ONE_RISK_PATH` reside on retained storage. This change does not provision a Render disk or a multi-instance transactional database. Do not scale this file-backed implementation across independent processes.
- An unresolved reservation predating this journal has no reliable attempt mapping; it is surfaced for reconciliation, not automatically cleared.

The broker contract/request correlation follows the official [open-contract documentation](https://developers.deriv.com/docs/trading/proposal-open-contract/) and [trading examples](https://developers.deriv.com/docs/examples/). Unknown-purchase reconciliation distinguishes [open portfolio](https://developers.deriv.com/docs/account/portfolio/) from [transaction statement](https://developers.deriv.com/docs/account/statement/); neither is treated as proof of a matching purchase without reliable identity.

## 12. Continuous testing results

Command:

```powershell
node --test --test-isolation=none work/part-one-*.test.mjs work/premium-dashboard.test.mjs work/part-two*.test.mjs
```

**96 tests passed; zero failed, skipped or cancelled.** Includes existing Part Two regression tests. The environment denied spawning isolated child test processes, so the supported no-isolation runner was used.

- Execution-manager run: **25 consecutive complete mocked trades**, 25 BUYs, 25 settlements/P&L callbacks, 25 subscription cleanups, unique request IDs, one message listener and an unlocked IDLE state after each.
- Actual server-handler run: **25 further sequential mocked trades**, through HTTP handler logic plus execution manager plus demo risk ledger. Each POST repeated with the same attempt ID still produced only 25 purchases total. Alternating win/loss receipts and released risk reservations verified.
- Failure cases: proposal and BUY rejection; BUY timeout; disconnect before BUY, after BUY with/without confirmation; reconnect with open contract; missing/late/duplicate settlement; stale/invalid proposal; duplicate signal/BUY/proposal; wrong contract; unrelated API error; missing entry quote; process restart with known/unknown purchase; stop/restart without repurchase; accounting failure/recheck.
- Browser-code harness: unresolved trade continues polling; Stop does not abandon it; late settlement releases locks; full browser storage does not prevent the result; repeated polling does not duplicate it or repopulate a cleared display.
- Dashboard status model: an execution wait or status-connection error overrides strategy READY.
- Existing digit-filter and strength-change scripts passed separately; syntax checks passed for the changed runtime scripts.
- Browser smoke test at `http://localhost:3003/`: Execution engine, strategy status, read-only recheck, history and log controls present; disconnected account correctly disables manual order buttons; no captured browser error logs. No account connected and no order submitted.
- Checkpoint verification: all **63** backed-up files match their saved SHA256 hashes. Digit Barrier engine and Part Two source remain unchanged from that checkpoint.

### Remaining validation before claiming the live incident resolved

An authenticated demo run is still required to validate the real OTP/WebSocket/API payloads and observe at least 20 complete broker-confirmed lifecycles. Local sign-in is not configured; the smoke test therefore cannot validate an account connection. Review the deployed storage paths before publishing. After deployment, export the joined diagnostics if an attempt stalls; its final stage will distinguish proposal, BUY, contract monitoring, accounting and strategy/risk waits. Do not enable real-money Auto for this validation.
