// Move existing elements, never clone/rebind controls or call the trading engine.
export function mountProLayout(){
 const byId=id=>document.getElementById(id),terminal=document.querySelector('.terminal'),balance=byId('balanceInstrument'),gate=document.querySelector('.gate-card');
 if(!terminal||!balance||!gate||document.body.classList.contains('pro-terminal'))return;
 document.body.classList.add('pro-terminal');
 const summary=document.createElement('div');summary.className='pro-balance-summary';
 summary.append(...balance.childNodes);balance.append(summary);terminal.querySelector('.workspace-heading').after(balance);
 const gateBody=document.createElement('div');gateBody.className='pro-gate-body';gateBody.append(...gate.childNodes);gate.append(gateBody);balance.append(gate);
 gate.prepend(document.querySelector('.live-wheel-panel'));
 const manualGroup=byId('balanceManual').closest('.balance-controls');gateBody.append(manualGroup,byId('balancePermission'));
 byId('balanceManualExecute').textContent='EXECUTE MANUAL TRADE · DEMO';
 const orderInputs=document.createElement('div');orderInputs.className='pro-order-inputs';
 orderInputs.append(byId('stake').closest('label'),byId('duration').closest('label'));gateBody.append(orderInputs,byId('autoOrderPanel'),byId('manualOrderPanel'));
 const side=document.createElement('div');side.className='pro-sidebar';balance.append(side);
 side.append(document.querySelector('.modePanel'),document.querySelector('.controls'),byId('sessionStats').closest('section'));
 const engine=byId('executionEngineState').closest('section');side.append(engine);
 const drawerGroup=document.createElement('details');drawerGroup.className='pro-drawer-group';const drawerTitle=document.createElement('summary');drawerTitle.textContent='DIAGNOSTICS & HISTORY — expand';drawerGroup.append(drawerTitle);const drawers=document.createElement('div');drawers.className='pro-drawers';drawerGroup.append(drawers);balance.append(drawerGroup);
 const fold=(node,title)=>{if(!node)return;const d=document.createElement('details'),h=document.createElement('summary');d.className='panel pro-drawer';h.textContent=title;d.append(h,node);drawers.append(d);};
 // Balance renderers query inside balanceInstrument: keep moved diagnostics in that root.
 for(const d of [...summary.querySelectorAll(':scope > details')])drawers.append(d);
 const explanation=summary.querySelector(':scope > p:last-child');if(explanation?.classList.contains('balance-caption'))fold(explanation,'About the balance measurements');
 fold(byId('executionEngineDetails').closest('details'),'Execution diagnostics & WebSocket audit');
 fold(byId('marketMemoryPanel'),'Market regime memory · shadow audit');
 fold(byId('maxStake').closest('section'),'Risk & session settings');
 fold(byId('tradeFacts').closest('section'),'Proposal & contract details');
 fold(document.querySelector('.no-trade-panel'),'No-trade diagnostics');
 fold(document.querySelector('.orderPerformancePanel'),'Full performance & trade history');
 for(const node of [...balance.querySelectorAll('.pro-sidebar details,.pro-gate-body details')])if(!node.parentElement.closest('details'))drawers.append(node);
 for(const node of [...balance.querySelectorAll('#autoOrderPanel > p:not([id]),#parallelStrategies > p:not([id]),#manualOrderPanel > p:not([id])')])fold(node,'Execution guidance');
 if(byId('demoOrderStatus'))byId('manualOrderPanel').append(byId('demoOrderStatus'));
 // Collect remaining secondary panels without replacing any nodes or event listeners.
 for(const node of [...terminal.querySelectorAll('section.panel, details.panel, .movedMetrics, .cooldownPanel')]){
  if(balance.contains(node)||node.hidden||node.closest('[hidden]'))continue;
  const parent=node.parentElement;if(parent?.closest('.pro-drawers'))continue;
  if(node.closest('details')&&node.closest('details')!==node)continue;
  fold(node,node.querySelector('h2,summary,p')?.textContent?.trim()||'Additional diagnostics');
 }
 for(const node of [...terminal.querySelectorAll('.terminal-grid,.compact-workspace,.dashboard-stack,.entryDeck,.lower-panels')])if(!node.querySelector('section,details,input,button,select'))node.hidden=true;
}
