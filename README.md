# Deriv Over/Under Lab

Local, **demo-first** dashboard for monitoring digit distributions, generating test signals, and paper-trading an Over/Under strategy.

It supports a deliberately gated, **manual account order** after sign-in. Demo is selected first; the real-account path remains disabled unless a separate server setting and two explicit user confirmations are used. Digital-options outcomes can be random and this tool cannot identify a guaranteed or "best" market. Use it to test a defined strategy, not as financial advice.

## Run

1. Install Node.js 22 or later.
2. In this folder, run `npm start`.
3. Open `http://localhost:3000`.
4. Choose a symbol and press **Start live feed**. The dashboard uses Deriv's public read-only Options WebSocket; leave it running to collect a sample, then press **Backtest collected ticks**.

## What it does

- Uses a rolling tick window to measure each terminal-digit frequency.
- Uses only `OVER 1` (loses on 0/1) and `UNDER 8` (loses on 8/9). It selects the side whose two loss digits were less frequent in the selected rolling sample, then reduces the score when the two sides are too similar or the sample is small.
- Requires a user-set minimum confidence before an entry alert is emitted.
- Evaluates each signal against the configured number of later ticks and keeps an auditable win/loss record. This measures a test rule; it is not a Deriv contract settlement or account result.
- Backtests the chosen rule against collected tick history without looking at future ticks at entry time.
- Requests public price proposals for `OVER 1` and `UNDER 8`, calculates each quote's break-even win rate, and blocks the pricing gate unless the selected rule's observed sample rate exceeds it. A pass remains a research observation, not a trading recommendation.
- Can place exactly one `OVER 1` or `UNDER 8` **demo** contract only after the user ticks the arm box and accepts a second confirmation. It selects an active demo account from Deriv's account list, obtains a short-lived demo-only session, and does not expose the sign-in token to the browser.
- Includes a mode selector: **Manual bot** requires a deliberate order confirmation each time; **Auto demo bot** requires a separate start confirmation and can act only on qualifying signals in the selected Demo account. Auto mode never uses a Real account.

## Demo sign-in and manual demo orders

Demo-account sign-in uses server-side OAuth 2.0 with PKCE. Copy `.env.example` to your deployment's secure environment configuration, set `DERIV_CLIENT_ID` and the **exact** HTTPS `DERIV_REDIRECT_URI` that you registered with Deriv, then restart the server. The browser never receives the access token.

After the connection is shown as complete, the dashboard retrieves active Demo and Real Options accounts associated with your sign-in. It selects Demo first. Start the live feed, review the research signal yourself, choose an account and contract in **Manual order**, tick its acknowledgement box, and press the manual-order button. A second browser confirmation is required. Do not put a Deriv token into browser code or commit it to this project.

## Account selection and real-money safeguard

Demo and Real accounts can be displayed in the same selector after sign-in. The real account is connected for later, but real-money orders are disabled unless the hosting environment contains `ENABLE_REAL_TRADING=true`. Even then, selecting the real account requires a separate on-screen acknowledgement and final browser confirmation for each order. Leave this setting as `false` while testing.

Real-money execution is disabled by default. Keep the project on demo until its design, security controls, settlement tracking, and compliance review are materially expanded.

## Demo risk policy

The dashboard policy is a $500 maximum demo stake, $500 daily demo-risk ceiling, and 100 trades per day. These are ceilings, not a recommendation to trade at those levels. The server counts each submitted demo stake against the daily ceiling conservatively; it does not treat an unclosed contract as a known profit or loss. The starter remains disarmed and never sends real-money orders.

Deriv API references: [market data](https://developers.deriv.com/docs/data/), [price proposals](https://developers.deriv.com/docs/trading/proposal/), [buy contract](https://developers.deriv.com/docs/trading/buy/), and [OAuth 2.0](https://developers.deriv.com/docs/intro/oauth/).

## Deploy to Render

This project includes `render.yaml`. Push the folder to a private GitHub repository, then in Render choose **New → Blueprint** and select that repository. Render gives the app an HTTPS `onrender.com` address. Set `DERIV_CLIENT_ID` and `DERIV_REDIRECT_URI` as Render environment variables after registering the exact callback URL (`https://YOUR-SERVICE.onrender.com/auth/callback`) with Deriv.
