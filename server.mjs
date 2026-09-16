import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const oauthStates = new Map();
const sessions = new Map();
const recentOrders = new Map();
const dailyDemoRisk = new Map();
const tradeChannels = new Map();
const clientId = process.env.DERIV_CLIENT_ID;
const redirectUri = process.env.DERIV_REDIRECT_URI;
const realTradingEnabled = process.env.ENABLE_REAL_TRADING === 'true';
const oauthReady = Boolean(clientId && redirectUri && redirectUri.startsWith('https://'));
const base64url = (value) => Buffer.from(value).toString('base64url');
const contractEntrySpot = (contract) => contract.entry_tick ?? contract.entry_spot ?? contract.current_spot ?? null;
const contractExitSpot = (contract) => contract.exit_tick ?? contract.exit_spot ?? contract.sell_spot ?? contract.current_spot ?? null;
const proposalKey = ({ type, symbol, stake, currency }) => `${type}:${symbol}:${stake}:${currency}`;
const cookieValue = (req, name) => (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
const readJson = async (req) => {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 16_384) throw new Error('Request too large'); }
  return JSON.parse(raw || '{}');
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const getSession = (req) => {
  const session = sessions.get(cookieValue(req, 'deriv_session'));
  return session && session.expiresAt > Date.now() ? session : null;
};
const deriv = async (path, token, options = {}) => fetch(`https://api.derivws.com${path}`, { ...options, headers: { ...(options.headers ?? {}), authorization: `Bearer ${token}` } });
const openTradeChannel = async ({ key, token, accountId, accountType }) => {
  const existing = tradeChannels.get(key);
  if (existing?.ws?.readyState === WebSocket.OPEN) return existing;
  if (existing?.ready) return existing.ready;
  const otp = await deriv(`/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, token, { method:'POST' });
  if (!otp.ok) throw new Error('Deriv could not prepare the trading connection.');
  const otpBody = await otp.json(), url = otpBody?.data?.url;
  if (!url || !new RegExp(`/ws/${accountType}\\?otp=`).test(url)) throw new Error(`Deriv did not return a valid ${accountType} trading session.`);
  const channel = { ws:new WebSocket(url), active:null, ready:null, warm:new Map(), warmRequests:new Map(), warmSequence:1000, warmConfig:null };
  tradeChannels.set(key, channel);
  channel.ready = new Promise((resolve, reject) => {
    const failReady = (message) => { tradeChannels.delete(key); reject(new Error(message)); };
    channel.ws.addEventListener('open', () => resolve(channel), { once:true });
    channel.ws.addEventListener('error', () => { if (channel.active) channel.active.fail(new Error('Trading connection failed.')); else failReady('Trading connection failed.'); });
    channel.ws.addEventListener('close', () => { tradeChannels.delete(key); if (channel.active) channel.active.fail(new Error('Trading connection closed.')); });
    channel.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      const warmRequest = channel.warmRequests.get(data.req_id);
      if (warmRequest && data.proposal?.id) {
        channel.warm.set(warmRequest.key, { id:data.proposal.id, askPrice:data.proposal.ask_price, updatedAt:Date.now() });
        return;
      }
      const active = channel.active; if (!active) return;
      if (data.error) return active.fail(new Error(data.error.message ?? 'Deriv rejected the order.'));
      if (data.proposal?.id && active.stage === 'proposal') { active.stage = 'buy'; return channel.ws.send(JSON.stringify({ buy:data.proposal.id, price:data.proposal.ask_price })); }
      if (data.buy && active.stage === 'buy') {
        active.stage = 'settlement';
        active.buy = data.buy;
        return channel.ws.send(JSON.stringify({ proposal_open_contract:1, contract_id:data.buy.contract_id, subscribe:1 }));
      }
      if (data.proposal_open_contract && active.stage === 'settlement') {
        const contract = data.proposal_open_contract;
        const entryTick = contractEntrySpot(contract);
        const exitTick = contractExitSpot(contract);
        if (!active.entrySent && entryTick !== null) {
          active.entrySent = true;
          active.entryTick = entryTick;
          active.entry({ contractId:active.buy.contract_id, buyPrice:active.buy.buy_price, transactionId:active.buy.transaction_id, entryTick });
        }
        if (!contract.is_sold) return;
        return active.finish({ contractId:active.buy.contract_id, buyPrice:active.buy.buy_price, transactionId:active.buy.transaction_id, entryTick:active.entryTick ?? entryTick, exitTick, status:contract.status, profit:contract.profit, payout:contract.payout });
      }
    });
  });
  return channel.ready;
};
const warmTradeProposals = (channel, { symbol, stake, currency }) => {
  const config = `${symbol}:${stake}:${currency}`;
  if (channel.warmConfig === config) return;
  channel.warmConfig = config;
  for (const [type, barrier] of [['DIGITOVER', '1'], ['DIGITUNDER', '8']]) {
    const key = proposalKey({ type, symbol, stake, currency });
    const reqId = ++channel.warmSequence;
    channel.warmRequests.set(reqId, { key });
    channel.ws.send(JSON.stringify({ proposal:1, amount:stake, basis:'stake', contract_type:type, currency, duration:1, duration_unit:'t', barrier, underlying_symbol:symbol, subscribe:1, req_id:reqId }));
  }
};
const accountOrder = async ({ key, token, accountId, accountType, currency, type, symbol, stake }) => {
  const channel = await openTradeChannel({ key, token, accountId, accountType });
  if (channel.active) throw new Error('An order is already being processed for this account.');
  let acceptEntry, rejectEntry, acceptSettlement, rejectSettlement;
  const entry = new Promise((resolve, reject) => { acceptEntry = resolve; rejectEntry = reject; });
  const settlement = new Promise((resolve, reject) => { acceptSettlement = resolve; rejectSettlement = reject; });
  const fail = (error) => { clearTimeout(timeout); channel.active = null; rejectEntry(error); rejectSettlement(error); };
  const finish = (result) => { clearTimeout(timeout); channel.active = null; acceptSettlement(result); };
  const timeout = setTimeout(() => fail(new Error('Order result timed out.')), 15_000);
  const warm = channel.warm.get(proposalKey({ type, symbol, stake, currency }));
  const useWarmProposal = warm && Date.now() - warm.updatedAt <= 5_000;
  channel.active = { stage:useWarmProposal ? 'buy' : 'proposal', entry:acceptEntry, finish, fail, entrySent:false };
  if (useWarmProposal) channel.ws.send(JSON.stringify({ buy:warm.id, price:warm.askPrice }));
  else channel.ws.send(JSON.stringify({ proposal:1, amount:stake, basis:'stake', contract_type:type, currency, duration:1, duration_unit:'t', barrier:type === 'DIGITOVER' ? '1' : '8', underlying_symbol:symbol }));
  return { entry, settlement };
};

async function exchangeCode(code, verifier) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });
  const response = await fetch('https://auth.deriv.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
  return response.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/auth/status') {
    const session = getSession(req);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ configured: oauthReady, connected: Boolean(session), mode: session ? 'demo connection pending account selection' : 'not connected' }));
  }
  if (url.pathname === '/api/accounts' && req.method === 'GET') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error:'Connect your Deriv account first.' });
    try {
      const response = await deriv('/trading/v1/options/accounts', session.accessToken);
      if (!response.ok) throw new Error('Deriv could not retrieve your accounts.');
      const accounts = ((await response.json())?.data ?? []).filter((account) => account.status === 'active' && ['demo','real'].includes(account.account_type)).map((account) => ({ accountId:account.account_id, accountType:account.account_type, currency:account.currency, balance:account.balance }));
      return json(res, 200, { accounts, realTradingEnabled });
    } catch (error) { return json(res, 502, { error:error.message || 'Accounts could not be retrieved.' }); }
  }
  if (url.pathname === '/api/orders/recent' && req.method === 'GET') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error:'Connect your Deriv account first.' });
    return json(res, 200, { order:recentOrders.get(cookieValue(req, 'deriv_session')) ?? null });
  }
  if (url.pathname === '/api/order/prepare' && req.method === 'POST') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error:'Connect your Deriv account first.' });
    try {
      const { accountId, accountType, symbol, stake } = await readJson(req);
      if (!['demo','real'].includes(accountType)) return json(res, 400, { error:'Choose a valid account type.' });
      if (accountType === 'real' && !realTradingEnabled) return json(res, 403, { error:'Real-money orders are disabled by the server setting.' });
      const response = await deriv('/trading/v1/options/accounts', session.accessToken), accounts = (await response.json())?.data ?? [];
      const selected = accounts.find((account) => account.account_id === accountId && account.account_type === accountType && account.status === 'active');
      if (!selected) return json(res, 403, { error:'The selected account is not available.' });
      const channel = await openTradeChannel({ key:`${cookieValue(req, 'deriv_session')}:${accountId}`, token:session.accessToken, accountId, accountType });
      const amount = Number(stake);
      if (/^[A-Za-z0-9_]{2,30}$/.test(symbol ?? '') && Number.isFinite(amount) && amount > 0) warmTradeProposals(channel, { symbol, stake:amount, currency:selected.currency });
      return json(res, 200, { ready:true, accountType, warmed:Boolean(channel.warmConfig) });
    } catch (error) { return json(res, 502, { error:error.message || 'Fast execution connection could not be prepared.' }); }
  }
  if ((url.pathname === '/api/order' || url.pathname === '/api/demo/order') && req.method === 'POST') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error:'Connect your Deriv demo account first.' });
    try {
      const { armed, type, symbol, stake, accountId, accountType, realConfirmed } = await readJson(req);
      const amount = Number(stake), maxStake = 500, dailyLimit = 500, tradeLimit = 100;
      if (armed !== true) return json(res, 403, { error:'Demo trading is not armed.' });
      if (!['DIGITOVER', 'DIGITUNDER'].includes(type) || !/^[A-Za-z0-9_]{2,30}$/.test(symbol ?? '') || !['demo','real'].includes(accountType)) return json(res, 400, { error:'Invalid account or contract request.' });
      if (!Number.isFinite(amount) || amount <= 0 || amount > maxStake) return json(res, 400, { error:`Stake must be between $0.01 and $${maxStake}.` });
      const accountResponse = await deriv('/trading/v1/options/accounts', session.accessToken);
      const accounts = (await accountResponse.json())?.data ?? [];
      const selectedAccount = accounts.find((account) => account.account_id === accountId && account.account_type === accountType && account.status === 'active');
      if (!selectedAccount) return json(res, 403, { error:'The selected Deriv account is not available.' });
      if (accountType === 'real' && !realTradingEnabled) return json(res, 403, { error:'Your real account is connected, but real-money orders are disabled by the server setting.' });
      if (accountType === 'real' && realConfirmed !== true) return json(res, 403, { error:'A separate real-money confirmation is required.' });
      const day = new Date().toISOString().slice(0, 10), key = `${cookieValue(req, 'deriv_session')}:${day}`;
      const budget = dailyDemoRisk.get(key) ?? { trades:0, exposure:0 };
      if (budget.trades >= tradeLimit) return json(res, 403, { error:`Daily trade limit (${tradeLimit}) reached.` });
      if (budget.exposure + amount > dailyLimit) return json(res, 403, { error:`Daily demo risk ceiling ($${dailyLimit}) would be exceeded.` });
      const sessionKey = cookieValue(req, 'deriv_session');
      const orderFlow = await accountOrder({ key:`${sessionKey}:${accountId}`, token:session.accessToken, accountId:selectedAccount.account_id, accountType, currency:selectedAccount.currency, type, symbol, stake:amount });
      const entry = await orderFlow.entry;
      dailyDemoRisk.set(key, { trades:budget.trades + 1, exposure:budget.exposure + amount });
      const receipt = { type, symbol, accountType, accountId:selectedAccount.account_id, currency:selectedAccount.currency, ...entry, state:'entered', enteredAt:Date.now() };
      recentOrders.set(sessionKey, receipt);
      orderFlow.settlement.then((result) => {
        const settledReceipt = { ...receipt, ...result, state:'settled', completedAt:Date.now() };
        recentOrders.set(sessionKey, settledReceipt);
      }).catch(() => {});
      return json(res, 200, { ok:true, account:`${accountType === 'real' ? 'Real' : 'Demo'} ${selectedAccount.account_id}`, currency:selectedAccount.currency, ...receipt, remainingTrades:tradeLimit-budget.trades-1, remainingRisk:dailyLimit-budget.exposure-amount });
    } catch (error) { return json(res, 502, { error:error.message || 'Demo order could not be completed.' }); }
  }
  if (url.pathname === '/api/auth/start') {
    if (!oauthReady) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'OAuth is not configured. Set DERIV_CLIENT_ID and an HTTPS DERIV_REDIRECT_URI first.' })); }
    const state = base64url(crypto.randomBytes(32));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    oauthStates.set(state, { verifier, expires: Date.now() + 10 * 60 * 1000 });
    const authorize = new URL('https://auth.deriv.com/oauth2/auth');
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'trade', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    res.writeHead(302, { location: authorize.toString(), 'cache-control': 'no-store' }); return res.end();
  }
  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state'), code = url.searchParams.get('code'), record = state && oauthStates.get(state);
    oauthStates.delete(state);
    if (!record || record.expires < Date.now() || !code) { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('Invalid or expired sign-in response. Return to the dashboard and try again.'); }
    try {
      const token = await exchangeCode(code, record.verifier);
      const sessionId = base64url(crypto.randomBytes(32));
      sessions.set(sessionId, { accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 });
      res.writeHead(302, { location: '/', 'set-cookie': `deriv_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token.expires_in ?? 3600}`, 'cache-control': 'no-store' }); return res.end();
    } catch { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end('Deriv sign-in could not be completed. Check the registered callback URL and try again.'); }
  }
  const requested = req.url === '/' ? '/public/index.html' : `/public${req.url.split('?')[0]}`;
  const target = path.normalize(path.join(root, requested));
  if (!target.startsWith(path.join(root, 'public'))) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': mime[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Deriv Over/Under Lab: http://localhost:${port}`));
