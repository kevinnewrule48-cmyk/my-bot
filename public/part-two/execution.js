import {AutoController} from './auto-controller.js';
import {mountEntryPanels} from './entry-panels.js';
import {mountPerformance} from './performance.js';
export function setupExecution({parameters,readSignal}) {
  const $=id=>document.getElementById(id);
  const auto=new AutoController();
  const updateEntryPanels=mountEntryPanels();
  const updatePerformance=mountPerformance();
  let renderedOrders=null,renderedAccount=null;
  let armedSettings=null,validation=null;
  let preparing=false,heartbeatPending=false;
  async function prepareQuick(){
    if(preparing||busy||pending()||account()?.accountType!=='demo'||!['manual','auto'].includes($('tradeMode').value))return;
    preparing=true;
    try{await fetch('/api/part-two/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...parameters(),accountId:account().accountId,requestId:crypto.randomUUID(),mode:$('tradeMode').value})});}catch{}finally{preparing=false;}
  }
  const control=async(action,body)=>{const r=await fetch(`/api/part-two/auto/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),keepalive:action==='stop'});const d=await r.json();if(!r.ok)throw Error(d.error??'Auto connection failed');return d;};
  let accounts=[],orders=[],busy=false,uncertain=false,lastTick=-1,lastCompleted=null,autoValidated=false,polling=false;
  const account=()=>accounts.find(a=>a.accountId===$('tradeAccount').value);
  const selectedOrders=()=>orders.filter(o=>o.accountId===account()?.accountId);
  const stop=message=>{const old=armedSettings;armedSettings=null;auto.stop(message??'Stopped by you. An already accepted contract will still settle.');if(old)control('stop',old).catch(()=>{});render();};
  const pending=()=>selectedOrders().some(o=>['pending','entered','unknown'].includes(o.state));
  function render(){
    const snapshot=readSignal();
    updateEntryPanels(snapshot?.signal,snapshot?.market,validation?.experimentalDemo===true);
    $('cooldownState').textContent=auto.inFlight?'ORDER PENDING':auto.remaining?`${auto.remaining} TICKS REMAINING`:auto.armed?'READY — NO COOLDOWN':'AUTO OFF';
    $('cooldownDetail').textContent=$('tradeMode').value==='manual'?'Manual mode — cooldown does not block your orders.':`Configured cooldown: ${$('tradeCooldown').value} ticks. Starts after an Auto settlement.`;
    const selected=account(),mode=$('tradeMode').value;
    if(renderedOrders!==orders||renderedAccount!==selected?.accountId){
      updatePerformance(selectedOrders(),selected);renderedOrders=orders;renderedAccount=selected?.accountId;
    }
    $('tradeBalance').textContent=selected?`${selected.accountType.toUpperCase()} · ${selected.balance??'Balance unavailable'} ${selected.currency}`:'Not connected';
    $('manualTrade').disabled=mode!=='manual'||selected?.accountType!=='demo'||busy||uncertain||pending();
    const p=parameters(),matched=validation?.experimentalDemo===true||(validation?.symbol===p.symbol&&validation?.type===p.type&&validation?.barrier===p.barrier);
    $('startTrading').disabled=!autoValidated||!matched||mode!=='auto'||selected?.accountType!=='demo'||auto.armed||busy||uncertain||pending();
    $('startTrading').title=validation?.reason??(!matched?'No reviewed model for this contract.':'Server validation available');
    $('startTrading').textContent=autoValidated?(validation?.experimentalDemo?'Start Auto · experimental demo':'Start Auto'):'Connect account to check Auto availability';
    $('stopTrading').disabled=!auto.armed;
    $('autoState').textContent=auto.label;
    if(!auto.armed&&auto.stopReason)$('executionStatus').textContent=`AUTO OFF · ${auto.stopReason}`;
    $('manualTrade').textContent=`Place ${parameters().type} ${parameters().barrier} order`;
  }
  async function refreshAccounts(){
    try{const response=await fetch('/api/accounts',{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error??'Connect your account.');accounts=data.accounts??[];
      const previous=$('tradeAccount').value;$('tradeAccount').replaceChildren();
      for(const a of accounts){const option=document.createElement('option');option.value=a.accountId;option.textContent=`${a.accountType.toUpperCase()} · ${a.accountId} · ${a.currency}${a.accountType==='real'?' (Part Two disabled)':''}`;option.disabled=a.accountType!=='demo';$('tradeAccount').append(option);}
      $('tradeAccount').value=accounts.find(a=>a.accountId===previous&&a.accountType==='demo')?.accountId??accounts.find(a=>a.accountType==='demo')?.accountId??'';
      $('tradeAccount').disabled=!accounts.some(a=>a.accountType==='demo');render();
    }catch(error){accounts=[];stop(error.message);$('tradeAccount').disabled=true;}
  }
  async function refreshOrders(){
    if(polling)return;
    polling=true;
    try{const response=await fetch('/api/part-two/orders',{cache:'no-store'});if(!response.ok){if(response.status===401){accounts=[];stop('Account disconnected. Reconnect before trading.');}else stop('Order status unavailable. Auto stopped.');return;}
      const data=await response.json();orders=data.orders??[];autoValidated=data.autoAvailable===true||data.autoValidated===true;validation=data.autoValidation;
      auto.inFlight=pending();
      $('orderHistory').replaceChildren();
      for(const o of [...selectedOrders()].reverse().slice(0,30)){
        const row=document.createElement('tr');for(const value of [new Date(o.createdAt).toLocaleTimeString(),`${o.type} ${o.barrier}`,o.symbol,o.error?`${o.state} · ${o.error}`:o.state,o.buyPrice??o.stake,o.entryQuote??'—',o.exitQuote??'—',o.profit??'—']){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}$('orderHistory').append(row);
      }
      const latest=selectedOrders().at(-1);
      if(latest?.state==='unknown'){uncertain=true;stop(`Order result unresolved: ${latest.error??'Check Deriv contract history.'} No automatic retry.`);}
      if(latest?.state==='rejected'&&latest.requestId!==lastCompleted){lastCompleted=latest.requestId;stop(`Order rejected: ${latest.error}`);}
      if(latest?.state==='skipped'&&auto.armed)$('executionStatus').textContent=`No order placed · ${latest.error} Auto remains ON and waits for the next qualifying tick.`;
      if(latest?.state==='settled'&&latest.requestId!==lastCompleted){lastCompleted=latest.requestId;if(latest.mode==='auto')auto.settled($('tradeCooldown').value);$('executionStatus').textContent=`${latest.profit>0?'WIN':latest.profit<0?'LOSS':'SETTLED'} · ${latest.type} ${latest.barrier} · ${latest.profit} ${latest.currency}`;refreshAccounts();}
      render();
    }catch{stop('Cannot retrieve order status. Auto stopped; check Deriv before trying again.');}
    finally{polling=false;}
  }
  async function submit(mode){
    if(busy||uncertain||pending()||account()?.accountType!=='demo')return;
    const s=readSignal();
    const researchChecks=s?.signal?.checks?.filter(c=>!['Calibrated confidence','Payout / EV','Execution validation'].includes(c.name));
    if(mode==='auto'&&(!auto.ready({live:$('status').textContent==='LIVE',connected:account()?.accountType==='demo',checks:researchChecks,validated:autoValidated})||s.sequence===lastTick))return;
    busy=true;render();const requestId=crypto.randomUUID();
    try{
      const response=await fetch('/api/part-two/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...parameters(),accountId:account().accountId,requestId,mode})});
      const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error??'Order rejected'),{confirmedRejection:response.status>=400&&response.status<500});
      orders.push(data.order);auto.accepted();lastTick=s?.sequence??-1;$('executionStatus').textContent='ORDER REQUEST ACCEPTED · Waiting for Deriv receipt and settlement.';await refreshOrders();
    }catch(error){if(!error.confirmedRejection)uncertain=true;stop(`${error.message}${uncertain?' Result uncertain. Do not repeat; check Deriv.':''}`);}
    finally{busy=false;render();}
  }
  $('connectTrading').onclick=()=>{stop();location.href='/api/auth/start?returnTo=part-two';};
  $('refreshTrading').onclick=async()=>{await refreshAccounts();await refreshOrders();};
  $('tradeAccount').onchange=()=>{stop('Account changed. Auto is off.');$('orderHistory').replaceChildren();refreshOrders();};
  $('tradeMode').onchange=()=>stop('Mode selected. Auto requires an explicit Start.');
  $('tradeCooldown').onchange=()=>stop('Cooldown changed. Press Start to apply it.');
  $('manualTrade').onclick=()=>submit('manual');
  $('startTrading').onclick=async()=>{if(!autoValidated||busy)return;busy=true;const settings={...parameters(),accountId:account()?.accountId,mode:'auto',requestId:crypto.randomUUID(),cooldown:Number($('tradeCooldown').value)};armedSettings=settings;render();try{await control('start',settings);if(armedSettings!==settings){await control('stop',settings);return;}auto.start();$('executionStatus').textContent='Auto armed. Server checks live history and actual payout. Experimental demo mode does not use validated confidence.';}catch(e){stop(e.message);}finally{busy=false;render();}};
  $('stopTrading').onclick=()=>stop();
  for(const id of ['market','side','barrier','quoteStake'])$(id).addEventListener('change',()=>stop('Contract settings changed. Auto is off.'));
  $('stop').addEventListener('click',()=>stop('Feed stopped. Auto is off.'));
  const timer=setInterval(refreshOrders,2000);
  const quickTimer=setInterval(prepareQuick,2000);
  const heartbeat=setInterval(async()=>{
    if(!armedSettings||!auto.armed||heartbeatPending)return;
    const settings=armedSettings;heartbeatPending=true;
    try{await control('heartbeat',settings);}catch(e){if(armedSettings===settings&&auto.armed)stop(`Auto connection check failed: ${e.message}`);}finally{heartbeatPending=false;}
  },5000);
  const feedObserver=new MutationObserver(render);
  feedObserver.observe($('status'),{childList:true,characterData:true,subtree:true});
  window.addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(quickTimer);clearInterval(heartbeat);feedObserver.disconnect();stop();});
  refreshAccounts();refreshOrders();render();
  return {onSignal(){const s=readSignal();auto.tick(s?.sequence);render();if(auto.armed){$('executionStatus').textContent=auto.remaining?auto.label:s?.signal?.reason||'Waiting for a live signal.';submit('auto');}},stop};
}
