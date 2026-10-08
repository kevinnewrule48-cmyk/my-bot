import {validateTradeDecision} from './public/trade-decision.js';
import {validateBalanceRequest} from './balance-authorization.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {RiseFallService,riseFallRoutes} from './rise-fall-service.mjs';
import {DemoRiskLedger,guardedDemoOrder,RiskRejection} from './part-one-risk.mjs';
import {PartOneExecution} from './part-one-execution.mjs';
import {strategyForType} from './public/strategy-proposal.js';
import {qualifiesDifferFrequency} from './public/differ-engine.js';
import {resetExecution,purchasePermission,suspendExecution,autoAuthorization,authEvent} from './execution-permission.mjs';
import {TradabilityAuthority} from './part-one-tradability.mjs';
const tradability=new TradabilityAuthority({log:event=>console.log(JSON.stringify(event))});

const root = path.dirname(fileURLToPath(import.meta.url));
const demoRisk = new DemoRiskLedger({file:process.env.PART_ONE_RISK_PATH||path.join(root,'work','part-one-demo-risk.json')});
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const oauthStates = new Map();
const sessions = new Map();
const recentOrders = new Map();
const clientId = process.env.DERIV_CLIENT_ID;
const redirectUri = process.env.DERIV_REDIRECT_URI;
const realTradingEnabled = process.env.ENABLE_REAL_TRADING === 'true';
const oauthReady = Boolean(clientId && redirectUri && redirectUri.startsWith('https://'));
const base64url = (value) => Buffer.from(value).toString('base64url');
const cookieValue = (req, name) => (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
const readJson = async (req,limit=16_384) => {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > limit) throw new Error('Request too large'); }
  return JSON.parse(raw || '{}');
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const getSession = (req) => {
  const session = sessions.get(cookieValue(req, 'deriv_session'));
  return session && session.expiresAt > Date.now() ? session : null;
};
const deriv = async (path, token, options = {}) => fetch(`https://api.derivws.com${path}`, { ...options, headers: { ...(options.headers ?? {}), authorization: `Bearer ${token}` } });
const connectExecution=async({token,accountId,accountType})=>{
  const otp=await deriv(`/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,token,{method:'POST',signal:AbortSignal.timeout(10000)});
  if(!otp.ok)throw Error(`Trading connection authorization failed (${otp.status})`);
  const url=(await otp.json())?.data?.url;if(!url||!new RegExp(`/ws/${accountType}\\?otp=`).test(url))throw Error('Invalid authenticated trading URL');
  const ws=new WebSocket(url);
  await new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);ws.removeEventListener('open',opened);ws.removeEventListener('error',failed);ws.removeEventListener('close',failed);};const opened=()=>{cleanup();resolve();};const failed=()=>{cleanup();reject(Error('Trading socket connection failed'));};const timer=setTimeout(()=>{cleanup();ws.close();reject(Error('Trading socket connection timeout'));},10000);ws.addEventListener('open',opened);ws.addEventListener('error',failed);ws.addEventListener('close',failed);});return ws;
};
const execution=new PartOneExecution({connect:connectExecution,file:process.env.PART_ONE_EXECUTION_PATH||path.join(root,'work','part-one-execution.json'),
  onDisconnect:id=>{tradability.disconnect(id);for(const session of sessions.values())if(session.autoControl?.accountId===id||session.manualIntent?.accountId===id){const event=suspendExecution(session),view=execution.snapshot(id);console.log(JSON.stringify({component:'auto-authorization',stage:'AUTO AUTH LOST',...event,tradeNumber:view.last?.number,contractId:view.last?.contractId,lastSettlement:view.last?.result?.status,executionLock:view.blocking,derivAuthorized:false}));}},
  authorizationState:id=>{const session=[...sessions.values()].find(s=>s.autoControl?.accountId===id);return session?autoAuthorization(session):{state:'AUTO_OFF'};},
  onTick:(id,tick)=>{demoRisk.tick(id,tick);tradability.tick(id,tick);},
  onSettled:(id,attempt,result)=>{const pending=demoRisk.status(id).pending;if(pending?.attemptId===attempt.attemptId)demoRisk.settle(id,pending.id,result);},
  onRejected:(id,attempt)=>{const pending=demoRisk.status(id).pending;if(pending?.attemptId===attempt.attemptId)demoRisk.rejected(id,pending.id,{orderNotSubmitted:true});},
  log:event=>console.log(JSON.stringify({component:'part-one-execution',...event}))});

async function exchangeCode(code, verifier) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });
  const response = await fetch('https://auth.deriv.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
  return response.json();
}

const riseFall=new RiseFallService({connect:connectExecution,accounts:async session=>{const r=await deriv('/trading/v1/options/accounts',session.accessToken,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Account verification failed');return (await r.json()).data??[];},file:path.join(root,'work','rise-fall-orders.json'),validationFile:path.join(root,'outputs','rise-fall-replay-report.json'),otherBusy:id=>!!execution.current(id)});
const riseFallRoute=riseFallRoutes(riseFall,{getSession,cookieValue,json,readJson});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if(await riseFallRoute(req,res,url))return;
  if(url.pathname.startsWith('/api/part-two/'))return json(res,410,{error:'Part Two has been replaced by Rise/Fall.'});
  if(url.pathname.startsWith('/part-two/')){res.writeHead(302,{location:'/rise-fall/index.html'});return res.end();}
  if(url.pathname==='/api/tradability/status'&&req.method==='GET'){
    const session=getSession(req);if(!session)return json(res,401,{error:'Connect account first'});const c=session.tradabilityControl;
    return json(res,200,tradability.status(session,c?.accountId,c?.symbol));
  }
  if(url.pathname==='/api/tradability/control'&&req.method==='POST'){
    const session=getSession(req);if(!session)return json(res,401,{error:'Connect account first'});
    let operation;
    try{const c=await readJson(req);if(!session.executionPageId||c.pageId!==session.executionPageId)throw Error('Stale page');
      if(!['monitor','auto-block'].includes(c.mode)||!['R_10','R_25','R_50','R_75','R_100'].includes(c.symbol)||!['demo','real'].includes(c.accountType)||!Number.isSafeInteger(c.revision)||c.revision<=(session.tradabilityRevision??-1))throw Error('Invalid or superseded tradability control');
      operation=c.revision;session.tradabilityRevision=operation;session.tradabilityPending=true;
      if(c.mode==='monitor'){tradability.configure(session,c);session.tradabilityPending=false;return json(res,200,tradability.status(session,c.accountId,c.symbol));}
      const response=await deriv('/trading/v1/options/accounts',session.accessToken,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Account verification failed');
      const account=((await response.json())?.data??[]).find(a=>a.account_id===c.accountId&&a.account_type===c.accountType&&a.status==='active');if(!account)throw Error('Selected account unavailable');
      if(c.pageId!==session.executionPageId||session.tradabilityRevision!==operation)throw Error('Superseded tradability control');
      if(c.mode==='auto-block'&&c.live!==true)throw Error('Explicitly start the live feed first');
      tradability.configure(session,c);
      if(c.mode==='auto-block'){const ch=await execution.channel({accountId:c.accountId,accountType:c.accountType,token:session.accessToken});if(c.pageId!==session.executionPageId||session.tradabilityRevision!==operation)throw Error('Session changed');for(const symbol of ['R_10','R_25','R_50','R_75','R_100']){tradability.watch(c.accountId,symbol);execution.ticks(c.accountId,ch,symbol);}}
      if(session.tradabilityRevision===operation)session.tradabilityPending=false;
      return json(res,200,tradability.status(session,c.accountId,c.symbol,c.mode));
    }catch(error){return json(res,409,{error:error.message});}
    // Failed configuration stays fail-closed until a successful fresh configuration.
  }
  if(url.pathname==='/api/execution/reset'&&req.method==='POST'){
    const session=getSession(req);if(session)resetExecution(session);
    return json(res,200,{stopped:true,pageId:session?.executionPageId??null});
  }
  if(url.pathname==='/api/execution/manual-intent'&&req.method==='POST'){
    const session=getSession(req);if(!session)return json(res,401,{error:'Connect account first'});
    try{const body=await readJson(req);if(!session.executionPageId||body.pageId!==session.executionPageId||body.intent!=='manual-click'||!body.attemptId||!body.accountId||!['DIGITOVER','DIGITUNDER'].includes(body.type))throw Error('Explicit current-page manual intent required');
      const id=crypto.randomUUID();session.manualIntent={id,attemptId:body.attemptId,accountId:body.accountId,type:body.type,expiresAt:Date.now()+5000};return json(res,200,{executionSessionId:id});
    }catch(error){return json(res,400,{error:error.message});}
  }
  if(url.pathname==='/api/auto/status'&&req.method==='GET'){
    const session=getSession(req);if(!session)return json(res,401,{error:'Account session expired; reconnect your account.'});
    return json(res,200,{authorization:autoAuthorization(session)});
  }
  if(url.pathname==='/api/auto/control'&&req.method==='POST'){
    const session=getSession(req);if(!session)return json(res,401,{error:'Connect your account first'});
    try{
      const c=await readJson(req);
      if(!session.executionPageId||c.pageId!==session.executionPageId)return json(res,403,{error:'Stale page. Reload and explicitly start a new session.',authorization:autoAuthorization(session)});
      if(!Number.isSafeInteger(c.revision)||typeof c.running!=='boolean'||typeof c.overUnder!=='boolean'||typeof c.differ!=='boolean'||typeof c.runId!=='string')return json(res,400,{error:'Invalid Auto control'});
      if(c.revision<=Math.max(session.autoControl?.revision??-1,session.autoControlRevision??-1))return json(res,409,{error:'Superseded Auto control',authorization:autoAuthorization(session)});
      if(c.running&&(!c.accountId||c.live!==true))return json(res,403,{error:'A live, intentionally started session is required'});
      if(c.recover&&(!session.autoControl?.running||session.autoControl.runId!==c.runId||session.autoControl.accountId!==c.accountId))return json(res,403,{error:'Prior Auto intent no longer exists; explicitly start Auto.',authorization:autoAuthorization(session)});
      session.executionGeneration=(session.executionGeneration??0)+1;
      if(session.autoControl)session.autoControl={...session.autoControl,suspended:true};
      authEvent(session,'auto-control request','Purchases paused while control update is verified');
      const generation=session.executionGeneration;
      session.autoControlRevision=c.revision;
      if(c.running){
        const response=await deriv('/trading/v1/options/accounts',session.accessToken,{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error('Deriv account verification failed ('+response.status+')');
        const account=((await response.json())?.data??[]).find(a=>a.account_id===c.accountId&&a.status==='active'&&a.account_type==='demo');
        if(!account)throw Error('Active demo account required for Auto');
        const ch=await execution.channel({accountId:c.accountId,accountType:account.account_type,token:session.accessToken});
        if(ch.ws.readyState!==1)throw Error('Trading connection is not open');
      }
      if(c.pageId!==session.executionPageId||generation!==session.executionGeneration||session.autoControlRevision!==c.revision)return json(res,409,{error:'Auto control superseded during connection; acknowledgment rejected',authorization:autoAuthorization(session)});
      session.autoControl={...c,suspended:false,startedAt:Date.now()};authEvent(session,c.recover?'auto-control recovery acknowledged':'auto-control acknowledged',c.running?'Verified trading connection and current page intent':'Auto stopped');console.log(JSON.stringify({component:'auto-authorization',stage:'AUTO_ACKNOWLEDGED',...autoAuthorization(session)}));
      return json(res,200,{ok:true,runId:c.runId,serverTime:Date.now(),authorization:autoAuthorization(session)});
    }catch(error){return json(res,502,{error:error.message||'Invalid Auto control',authorization:autoAuthorization(session)});}
  }
  if (url.pathname === '/api/auth/status') {
    const session = getSession(req);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ configured: oauthReady, connected: Boolean(session), mode: session ? 'demo connection pending account selection' : 'not connected' }));
  }
  if (url.pathname === '/api/accounts' && req.method === 'GET') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error:'Connect your Deriv account first.' });
    try {
      const response = await deriv('/trading/v1/options/accounts', session.accessToken,{signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Deriv could not retrieve your accounts.');
      const accounts = ((await response.json())?.data ?? []).filter((account) => account.status === 'active' && ['demo','real'].includes(account.account_type)).map((account) => ({ accountId:account.account_id, accountType:account.account_type, currency:account.currency, balance:account.balance }));
      return json(res, 200, { accounts, realTradingEnabled });
    } catch (error) { return json(res, 502, { error:error.message || 'Accounts could not be retrieved.' }); }
  }
  if (url.pathname === '/api/orders/recent' && req.method === 'GET') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error:'Connect your Deriv account first.' });
    if(!url.searchParams.get('accountId'))return json(res,200,{order:recentOrders.get(cookieValue(req,'deriv_session'))??null});
    try{
      if(!session.executionAccounts||session.executionAccountsAt<Date.now()-30000){const response=await deriv('/trading/v1/options/accounts',session.accessToken,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Account verification failed');session.executionAccounts=(await response.json())?.data??[];session.executionAccountsAt=Date.now();}
      const account=session.executionAccounts.find(a=>a.account_id===url.searchParams.get('accountId')&&a.account_type===url.searchParams.get('accountType')&&a.status==='active');if(!account)return json(res,403,{error:'Selected account is not available'});
      await execution.resume({accountId:account.account_id,accountType:account.account_type,token:session.accessToken},url.searchParams.get('reconcile')==='1');
      const snapshot=execution.snapshot(account.account_id),risk=account.account_type==='demo'?demoRisk.status(account.account_id):null;
      if(risk?.pending&&!snapshot.blocking){snapshot.state='RECONCILIATION_REQUIRED';snapshot.blocking=true;snapshot.externalRiskPending=true;snapshot.errorSummary='A prior server risk reservation is unresolved. Account reconciliation required; no replacement BUY permitted.';}
      return json(res,200,{order:execution.receipt(account.account_id),execution:{...snapshot,risk}});
    }catch(error){return json(res,502,{error:error.message});}
  }
  if (url.pathname === '/api/order/prepare' && req.method === 'POST') {
    return json(res,200,{ready:false,warmed:false,passive:true});
  }
  if ((url.pathname === '/api/order' || url.pathname === '/api/demo/order') && req.method === 'POST') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error:'Connect your Deriv demo account first.' });
    try {
      const { browserAutoState, armed, type, barrier, runId, executionSessionId, signalAt, gatePassed, tradabilityMode='monitor',symbol, stake, accountId, accountType, realConfirmed,mode='manual',riskLimits,attemptId:clientAttemptId,decisionId,strategyEvidence,decision } = await readJson(req,32_768);
      const candidate=decision?.candidate,balanceState=decision?.balanceState;
      const strategy=strategyForType(type);
      if(strategy==='OVER_UNDER')validateTradeDecision(decision,{type,barrier,symbol,mode,decisionId});
      if(strategy==='OVER_UNDER')validateBalanceRequest({candidate,balanceState,type,barrier,symbol,mode,decisionId});
      const requiredChecks=['Barrier','Momentum','Zone','Stability','Score','Persistence','Confidence','Quality'];
      const verifiedGate=gatePassed===true&&(type==='DIGITDIFF'||candidate?.ready===true||(strategyEvidence?.selected===(type==='DIGITOVER'?'OVER':'UNDER')&&requiredChecks.every(name=>strategyEvidence?.checks?.some(c=>c.name===name&&c.pass===true))));
      const permission=purchasePermission(session,{mode,executionSessionId,attemptId:clientAttemptId,accountId,type,strategy,decisionId,signalAt,gatePassed:verifiedGate});
      const gate=()=>tradability.status(session,accountId,symbol,tradabilityMode);
      const authorizePurchase=()=>permission()&&gate().allowed&&!riseFall.busy(accountId);
      authorizePurchase.snapshot=()=>({...permission.snapshot(),tradability:gate()});
      if(!gate().allowed){const status=gate();console.warn(JSON.stringify({stage:'TRADABILITY BLOCKED',timestamp:Date.now(),signalId:decisionId,executionSessionId,...status}));return json(res,409,{error:status.reason,riskCode:'TRADABILITY_BLOCKED'});}
      if(!authorizePurchase()){const reason=permission.failureReason();console.warn(JSON.stringify({stage:'PURCHASE BLOCKED',reason,...permission.snapshot(),timestamp:Date.now()}));return json(res,403,{error:'PURCHASE BLOCKED: '+reason,executionCode:'PURCHASE_BLOCKED'});}
      const attemptId=clientAttemptId||crypto.randomUUID();
      if(!/^[A-Za-z0-9_-]{8,100}$/.test(attemptId))return json(res,400,{error:'Invalid attempt ID'});
      if(!['manual','auto'].includes(mode))return json(res,400,{error:'Invalid execution mode.'});
      if(mode==='auto'&&accountType!=='demo')return json(res,403,{error:'Real-money Auto is disabled during barrier development.'});
      const amount = Number(stake), maxStake = 5000;
      if (armed !== true) return json(res, 403, { error:'Demo trading is not armed.' });
      if (!['DIGITOVER', 'DIGITUNDER','DIGITDIFF'].includes(type) || !/^[A-Za-z0-9_]{2,30}$/.test(symbol ?? '') || !['demo','real'].includes(accountType)) return json(res, 400, { error:'Invalid account or contract request.' });
      if(type==='DIGITDIFF'&&(mode!=='auto'||accountType!=='demo'||!Number.isInteger(barrier)||barrier<0||barrier>9||!qualifiesDifferFrequency(strategyEvidence?.count,strategyEvidence?.sample)||strategyEvidence?.jumpDigit===barrier||!Number.isInteger(strategyEvidence?.jumpDigit)||strategyEvidence.jumpDigit<0||strategyEvidence.jumpDigit>9))return json(res,400,{error:'Invalid DIFFER jump-off evidence: landing digit must be at 6% or below'});
      if (!Number.isFinite(amount) || amount <= 0 || amount > maxStake) return json(res, 400, { error:`Stake must be between $0.01 and $${maxStake}.` });
      const accountResponse = await deriv('/trading/v1/options/accounts', session.accessToken,{signal:AbortSignal.timeout(10000)});
      const accounts = (await accountResponse.json())?.data ?? [];
      const selectedAccount = accounts.find((account) => account.account_id === accountId && account.account_type === accountType && account.status === 'active');
      if (!selectedAccount) return json(res, 403, { error:'The selected Deriv account is not available.' });
      if (accountType === 'real' && !realTradingEnabled) return json(res, 403, { error:'Your real account is connected, but real-money orders are disabled by the server setting.' });
      if (accountType === 'real' && realConfirmed !== true) return json(res, 403, { error:'A separate real-money confirmation is required.' });
      const sessionKey = cookieValue(req, 'deriv_session');
      const credentials={accountId:selectedAccount.account_id,accountType,token:session.accessToken};
      const request={attemptId,decisionId,executionSessionId,strategyEvidence,decision,candidate,balanceState,browserAutoState:['AUTO_AUTHORIZED','AUTO_EXECUTING'].includes(browserAutoState)?browserAutoState:'UNREPORTED',type,strategy,barrier,symbol,stake:amount,currency:selectedAccount.currency,mode,riskLimits,authorizePurchase};
      const existing=execution.find(accountId,attemptId);
      if(existing&&['type','symbol','stake','mode','currency'].some(k=>existing.request[k]!==request[k]))return json(res,409,{error:'Attempt ID already belongs to a different order'});
      if(existing&&strategy==='OVER_UNDER'&&existing.request.decisionId!==decisionId)return json(res,409,{error:'TRADE BLOCKED — AUTHORITATIVE DECISION MISMATCH: attempt belongs to another decision'});
      if(existing&&existing.request.barrier!==barrier)return json(res,409,{error:'Attempt barrier mismatch'});
      const place=()=>execution.execute(credentials,request);
      const orderFlow = existing?execution.flow(accountId,existing):accountType==='demo'?await guardedDemoOrder(demoRisk,accountId,request,place):place();
      const entry = await orderFlow.entry;
      const receipt = { type, symbol, accountType, accountId:selectedAccount.account_id, currency:selectedAccount.currency, ...entry, state:'entered', enteredAt:Date.now() };
      recentOrders.set(sessionKey, receipt);
      orderFlow.settlement.then((result) => {
        const settledReceipt = { ...receipt, ...result, state:'settled', completedAt:Date.now() };
        recentOrders.set(sessionKey, settledReceipt);
      }).catch((error) => {
        recentOrders.set(sessionKey, { ...receipt, state:'failed', completedAt:Date.now(), error:error.message || 'Deriv did not return a settlement result.' });
      });
      return json(res, 200, { ok:true, attemptId, account:`${accountType === 'real' ? 'Real' : 'Demo'} ${selectedAccount.account_id}`, currency:selectedAccount.currency, ...receipt });
    } catch (error) { return json(res, error instanceof RiskRejection||/^(BALANCE_|AUTHORITATIVE_DECISION_|DECISION_)/.test(error.code??'')?409:502, { error:error.message || 'Order could not be completed.',riskCode:error instanceof RiskRejection?error.code:undefined,executionCode:error.code,attemptId:error.attemptId,uncertain:!!error.uncertain }); }
  }
  if (url.pathname === '/api/auth/start') {
    const previousSession=getSession(req);if(previousSession)resetExecution(previousSession);
    if (!oauthReady) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'OAuth is not configured. Set DERIV_CLIENT_ID and an HTTPS DERIV_REDIRECT_URI first.' })); }
    const state = base64url(crypto.randomBytes(32));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    oauthStates.set(state, { verifier, expires: Date.now() + 10 * 60 * 1000, returnTo:['part-two','rise-fall'].includes(url.searchParams.get('returnTo'))?'/rise-fall/index.html':'/' });
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
      res.writeHead(302, { location: record.returnTo??'/', 'set-cookie': `deriv_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token.expires_in ?? 3600}`, 'cache-control': 'no-store' }); return res.end();
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
