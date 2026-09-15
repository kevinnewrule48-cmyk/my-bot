# Deriv Over/Under Lab

Local, **demo-first** dashboard for monitoring digit distributions, generating test signals, and paper-trading an Over/Under strategy.

It is deliberately not connected to live execution. Digital-options outcomes can be random and this tool cannot identify a guaranteed or "best" market. Use it to test a defined strategy, not as financial advice.

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

## Before real execution

Demo-account sign-in uses server-side OAuth 2.0 with PKCE. Copy `.env.example` to your deployment's secure environment configuration, set `DERIV_CLIENT_ID` and the **exact** HTTPS `DERIV_REDIRECT_URI` that you registered with Deriv, then restart the server. The browser never receives the access token.

This starter deliberately stops after sign-in. Before real execution, add account selection, an OTP-backed demo WebSocket, a maximum-trade cap, daily-loss limit, cooldown, audit log, and a distinct user arm action. Do not put a Deriv token into browser code or commit it to this project.

Deriv API references: [market data](https://developers.deriv.com/docs/data/), [price proposals](https://developers.deriv.com/docs/trading/proposal/), [buy contract](https://developers.deriv.com/docs/trading/buy/), and [OAuth 2.0](https://developers.deriv.com/docs/intro/oauth/).

## Deploy to Render

This project includes `render.yaml`. Push the folder to a private GitHub repository, then in Render choose **New → Blueprint** and select that repository. Render gives the app an HTTPS `onrender.com` address. Set `DERIV_CLIENT_ID` and `DERIV_REDIRECT_URI` as Render environment variables after registering the exact callback URL (`https://YOUR-SERVICE.onrender.com/auth/callback`) with Deriv.
