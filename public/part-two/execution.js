import {AutoController} from './auto-controller.js';
import {mountEntryPanels} from './entry-panels.js';
export function setupExecution({parameters,readSignal}) {
  const $=id=>document.getElementById(id);
  const auto=new AutoController();
  const updateEntryPanels=mountEntryPanels();
  let accounts=[],orders=[],busy=false,uncertain=false,lastTick=-1,lastCompleted=null,autoValidated=false,polling=false;
  const account=()=>accounts.find(a=>a.accountId===$('tradeAccount').value);
  const selectedOrders=()=>orders.filter(o=>o.accountId===account()?.accountId);
  const stop=message=>{auto.stop();$('executionStatus').textContent=message??'Auto stopped. An already accepted contract will still settle.';render();};
  const pending=()=>selectedOrders().some(o=>['pending','entered','unknown'].includes(o.state));
  function render(){
    updateEntryPanels(readSignal()?.signal);
    $('cooldownState').textContent=auto.inFlight?'ORDER PENDING':auto.remaining?`${auto.remaining} TICKS REMAINING`:auto.armed?'READY — NO COOLDOWN':'AUTO OFF';
    $('cooldownDetail').textContent=$('tradeMode').value==='manual'?'Manual mode — cooldown does not block your orders.':`Configured cooldown: ${$('tradeCooldown').value} ticks. Starts after an Auto settlement.`;
    const selected=account(),mode=$('tradeMode').value;
    $('tradeBalance').textContent=selected?`${selected.accountType.toUpperCase()} · ${selected.balance??'Balance unavailable'} ${selected.currency}`:'Not connected';
    $('manualTrade').disabled=mode!=='manual'||selected?.accountType!=='demo'||busy||uncertain||pending();
    $('startTrading').disabled=!autoValidated||mode!=='auto'||selected?.accountType!=='demo'||auto.armed||busy||uncertain||pending();
    $('startTrading').textContent=autoValidated?'Start Auto':'Auto unavailable — validation unfinished';
    $('stopTrading').disabled=!auto.armed;
    $('autoState').textContent=auto.label;
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
      const data=await response.json();orders=data.orders??[];autoValidated=data.autoValidated===true;
      auto.inFlight=pending();
      $('orderHistory').replaceChildren();
      for(const o of [...selectedOrders()].reverse().slice(0,30)){
        const row=document.createElement('tr');for(const value of [new Date(o.createdAt).toLocaleTimeString(),`${o.type} ${o.barrier}`,o.symbol,o.state,o.buyPrice??o.stake,o.entryQuote??'—',o.exitQuote??'—',o.profit??'—']){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}$('orderHistory').append(row);
      }
      const latest=selectedOrders().at(-1);
      if(latest?.state==='unknown'){uncertain=true;stop(`Order result unresolved: ${latest.error??'Check Deriv contract history.'} No automatic retry.`);}
      if(latest?.state==='rejected')stop(`Order rejected: ${latest.error}`);
      if(latest?.state==='settled'&&latest.requestId!==lastCompleted){lastCompleted=latest.requestId;if(latest.mode==='auto')auto.settled($('tradeCooldown').value);$('executionStatus').textContent=`${latest.profit>0?'WIN':latest.profit<0?'LOSS':'SETTLED'} · ${latest.type} ${latest.barrier} · ${latest.profit} ${latest.currency}`;refreshAccounts();}
      render();
    }catch{stop('Cannot retrieve order status. Auto stopped; check Deriv before trying again.');}
    finally{polling=false;}
  }
  async function submit(mode){
    if(busy||uncertain||pending()||account()?.accountType!=='demo')return;
    const s=readSignal();
    if(mode==='auto'&&(!auto.ready({live:$('status').textContent==='LIVE',connected:account()?.accountType==='demo',checks:s?.signal?.checks,validated:autoValidated})||s.sequence===lastTick))return;
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
  $('tradeCooldown').onchange=render;
  $('manualTrade').onclick=()=>submit('manual');
  $('startTrading').onclick=()=>{if(!autoValidated)return;auto.start();$('executionStatus').textContent='Auto armed; waiting for calibrated confidence, payout validation and every other required check. No order has been sent.';render();};
  $('stopTrading').onclick=()=>stop();
  for(const id of ['market','side','barrier','quoteStake'])$(id).addEventListener('change',()=>stop('Contract settings changed. Auto is off.'));
  $('stop').addEventListener('click',()=>stop('Feed stopped. Auto is off.'));
  const timer=setInterval(refreshOrders,2000);
  const feedObserver=new MutationObserver(render);
  feedObserver.observe($('status'),{childList:true,characterData:true,subtree:true});
  window.addEventListener('pagehide',()=>{clearInterval(timer);feedObserver.disconnect();auto.stop();});
  refreshAccounts();refreshOrders();render();
  return {onSignal(){const s=readSignal();auto.tick(s?.sequence);render();if(auto.armed){$('executionStatus').textContent=auto.remaining?auto.label:s?.signal?.reason||'Waiting for a live signal.';submit('auto');}},stop};
}
