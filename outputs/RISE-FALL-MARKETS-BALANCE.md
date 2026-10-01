# Rise/Fall market and demo-balance correction

Checked: 2026-10-01T15:45:24.474Z

## Root causes

- Balance UI read the accounts list instead of the authenticated WebSocket balance response. It now requests balance:1 on a connection scoped to the verified selected demo options account. No MT5/wallet balance or local profit estimate is substituted.
- Only five regular volatility symbols were included in replay approval. The history/replay pipeline now covers all supported markets returned by this audit, with duration-specific evidence. Unsupported or untested durations still cannot start Auto.
- Market-selection buttons were incorrectly tied to current signal readiness. Supported markets are now selectable without a READY signal; executing still requires the unchanged strategy conditions.
- Repeated whole-market history downloads caused rate limits and stale recommendations. The scanner now caches metadata and retains live tick subscriptions, and distinguishes unconfirmed availability from broker-confirmed unavailability.

## Verification

29 automated tests passed. Isolated browser fixture proved account B shows its balance, switching to A replaces both ID and balance; no trade endpoint exists in that fixture. Live public browser analysis verified 1HZ100V feed and contract durations. Actual user balance remains unverified: accessible browser is signed out of Deriv.
Replayed 71 symbols, 142000 held-out ticks, 1768 profile/duration/partition runs. Baseline validation trades across duration simulations: 0. These are hypothetical overlapping simulations, not actual orders or proof of profitability.

No strategy thresholds, proposal validation, account ownership checks or execution permissions were removed. Rise/Fall real-money execution remains disabled. No trades were placed. Backup: checkpoints/before-rise-fall-balance-markets-20261001.

## Public contract availability

Availability is from the public API, not a guarantee of account-specific eligibility or current proposal acceptance. The authenticated connection and proposal still decide that. Tick durations and time durations are separate.

| Market | Symbol | Rise/Fall durations reported |
|---|---|---|
| Volatility 100 (1s) Index | 1HZ100V | 1d–365d, 15s–1d, 1t–10t |
| Volatility 10 (1s) Index | 1HZ10V | 1d–365d, 15s–1d, 1t–10t |
| Volatility 15 (1s) Index | 1HZ15V | 1d–365d, 15s–1d, 1t–10t |
| Volatility 25 (1s) Index | 1HZ25V | 1d–365d, 15s–1d, 1t–10t |
| Volatility 30 (1s) Index | 1HZ30V | 1d–365d, 15s–1d, 1t–10t |
| Volatility 50 (1s) Index | 1HZ50V | 1d–365d, 15s–1d, 1t–10t |
| Volatility 75 (1s) Index | 1HZ75V | 1d–365d, 15s–1d, 1t–10t |
| Volatility 90 (1s) Index | 1HZ90V | 1d–365d, 15s–1d, 1t–10t |
| Boom 1000 Index | BOOM1000 | Not returned |
| Boom 150 Index | BOOM150N | Not returned |
| Boom 300 Index | BOOM300N | Not returned |
| Boom 50 Index | BOOM50 | Not returned |
| Boom 500 Index | BOOM500 | Not returned |
| Boom 600 Index | BOOM600 | Not returned |
| Boom 900 Index | BOOM900 | Not returned |
| Crash 1000 Index | CRASH1000 | Not returned |
| Crash 150 Index | CRASH150N | Not returned |
| Crash 300 Index | CRASH300N | Not returned |
| Crash 50 Index | CRASH50 | Not returned |
| Crash 500 Index | CRASH500 | Not returned |
| Crash 600 Index | CRASH600 | Not returned |
| Crash 900 Index | CRASH900 | Not returned |
| Jump 10 Index | JD10 | 1d–365d, 15s–1d, 1t–10t |
| Jump 100 Index | JD100 | 1d–365d, 15s–1d, 1t–10t |
| Jump 25 Index | JD25 | 1d–365d, 15s–1d, 1t–10t |
| Jump 50 Index | JD50 | 1d–365d, 15s–1d, 1t–10t |
| Jump 75 Index | JD75 | 1d–365d, 15s–1d, 1t–10t |
| Netherlands 25 | OTC_AEX | 1d–365d, 15m–1h |
| Australia 200 | OTC_AS51 | 1d–365d, 15m–1h |
| Wall Street 30 | OTC_DJI | 1d–365d, 15m–1h |
| France 40 | OTC_FCHI | 1d–365d, 15m–1h |
| UK 100 | OTC_FTSE | 1d–365d, 15m–1h |
| Germany 40 | OTC_GDAXI | 1d–365d, 15m–1h |
| Hong Kong 50 | OTC_HSI | 1d–365d, 15m–1h |
| Japan 225 | OTC_N225 | 1d–365d, 15m–1h |
| US Tech 100 | OTC_NDX | 1d–365d, 15m–1h |
| US 500 | OTC_SPC | 1d–365d, 15m–1h |
| Swiss 20 | OTC_SSMI | 1d–365d, 15m–1h |
| Euro 50 | OTC_SX5E | 1d–365d, 15m–1h |
| Range Break 100 Index | RB100 | Not returned |
| Range Break 200 Index | RB200 | Not returned |
| Bear Market Index | RDBEAR | 15s–1d, 1t–10t |
| Bull Market Index | RDBULL | 15s–1d, 1t–10t |
| Volatility 10 Index | R_10 | 1d–365d, 15s–1d, 1t–10t |
| Volatility 100 Index | R_100 | 1d–365d, 15s–1d, 1t–10t |
| Volatility 25 Index | R_25 | 1d–365d, 15s–1d, 1t–10t |
| Volatility 50 Index | R_50 | 1d–365d, 15s–1d, 1t–10t |
| Volatility 75 Index | R_75 | 1d–365d, 15s–1d, 1t–10t |
| AUD Basket | WLDAUD | 15m–10h |
| EUR Basket | WLDEUR | 15m–10h |
| GBP Basket | WLDGBP | 15m–10h |
| USD Basket | WLDUSD | 15m–10h |
| Gold Basket | WLDXAU | 15m–10h |
| BTC/USD | cryBTCUSD | Not returned |
| ETH/USD | cryETHUSD | Not returned |
| AUD/CAD | frxAUDCAD | 1d–365d, 15m–1d |
| AUD/CHF | frxAUDCHF | 1d–365d, 15m–1d |
| AUD/JPY | frxAUDJPY | 1d–365d, 15m–1d |
| AUD/NZD | frxAUDNZD | 1d–365d, 15m–1d |
| AUD/USD | frxAUDUSD | 1d–365d, 15m–1d |
| EUR/AUD | frxEURAUD | 1d–365d, 15m–1d |
| EUR/CAD | frxEURCAD | 1d–365d, 15m–1d |
| EUR/CHF | frxEURCHF | 1d–365d, 15m–1d |
| EUR/GBP | frxEURGBP | 1d–365d, 15m–1d |
| EUR/JPY | frxEURJPY | 1d–365d, 15m–1d |
| EUR/NZD | frxEURNZD | 1d–365d, 15m–1d |
| EUR/USD | frxEURUSD | 1d–365d, 15m–1d |
| GBP/AUD | frxGBPAUD | 1d–365d, 15m–1d |
| GBP/CAD | frxGBPCAD | 1d–365d, 15m–1d |
| GBP/CHF | frxGBPCHF | 1d–365d, 15m–1d |
| GBP/JPY | frxGBPJPY | 1d–365d, 15m–1d |
| GBP/NZD | frxGBPNZD | 1d–365d, 15m–1d |
| GBP/USD | frxGBPUSD | 1d–365d, 15m–1d |
| NZD/JPY | frxNZDJPY | 1d–365d, 15m–1d |
| NZD/USD | frxNZDUSD | 1d–365d, 15m–1d |
| USD/CAD | frxUSDCAD | 1d–365d, 15m–1d |
| USD/CHF | frxUSDCHF | 1d–365d, 15m–1d |
| USD/JPY | frxUSDJPY | 1d–365d, 15m–1d |
| USD/MXN | frxUSDMXN | 1d–365d, 15m–1d |
| USD/PLN | frxUSDPLN | 1d–365d, 15m–1d |
| Silver/USD | frxXAGUSD | 1d–365d, 5m–1d |
| Gold/USD | frxXAUUSD | 1d–365d, 5m–1d |
| Palladium/USD | frxXPDUSD | 1d–365d |
| Platinum/USD | frxXPTUSD | 1d–365d |
| Step Index 100 | stpRNG | 1d–365d, 15s–1d, 1t–10t |
| Step Index 200 | stpRNG2 | 1d–365d, 15s–1d, 1t–10t |
| Step Index 300 | stpRNG3 | 1d–365d, 15s–1d, 1t–10t |
| Step Index 400 | stpRNG4 | 1d–365d, 15s–1d, 1t–10t |
| Step Index 500 | stpRNG5 | 1d–365d, 15s–1d, 1t–10t |

## Files changed

rise-fall-service.mjs; public/rise-fall/app.js, balance.js, contracts.js, scanner.js; work/rise-fall-history.mjs, rise-fall-replay.mjs, rise-fall-balance.test.mjs, rise-fall-scanner.test.mjs; outputs/rise-fall-replay-report.json.

New audit/verification files: work/rise-fall-market-audit.mjs, rise-fall-finalize-market-audit.mjs, rise-fall-ui-fixture.mjs; outputs/rise-fall-market-audit.json, rise-fall-replay-supplement.json, RISE-FALL-MARKETS-BALANCE.md; additional public tick recordings in outputs/rise-fall. No credentials or user balances are included.

Deriv balance documentation: https://developers.deriv.com/docs/account/balance/