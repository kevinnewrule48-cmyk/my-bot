export function performance(orders){
  const settled=orders.filter(o=>o.state==='settled'&&Number.isFinite(o.profit)).sort((a,b)=>(a.completedAt??a.createdAt)-(b.completedAt??b.createdAt));
  let grossProfit=0,grossLoss=0,netProfit=0,peak=0,maxDrawdown=0,consecutiveWins=0,consecutiveLosses=0,winningOrders=0,losingOrders=0;
  for(const o of settled){
    netProfit+=o.profit;peak=Math.max(peak,netProfit);maxDrawdown=Math.max(maxDrawdown,peak-netProfit);
    if(o.profit>0){grossProfit+=o.profit;winningOrders++;consecutiveWins++;consecutiveLosses=0;}
    else if(o.profit<0){grossLoss-=o.profit;losingOrders++;consecutiveLosses++;consecutiveWins=0;}
    else{consecutiveWins=0;consecutiveLosses=0;}
  }
  return {grossProfit,grossLoss,netProfit,recoveryNeeded:Math.max(0,-netProfit),winningOrders,losingOrders,completeOrders:settled.length,
    winRate:settled.length?winningOrders/settled.length*100:null,consecutiveWins,consecutiveLosses,drawdown:peak-netProfit,maxDrawdown};
}
export function mountPerformance(){
  const panel=document.createElement('section');panel.id='globalPerformance';
  panel.innerHTML='<h2>Global Risk and Performance · Part Two</h2><p class="hint" id="performanceAccount"></p><div class="performance-grid" id="performanceMetrics"></div><p class="hint">Recovery needed = amount required to return recorded net profit to zero. Drawdown = drop from the recorded profit peak. Results use settled Deriv contracts only; unresolved orders are not wins or losses. History depends on retained server storage.</p><h3>Contract amount and payout history</h3><div class="scroll"><table><thead><tr><th>Time</th><th>Contract ID</th><th>Market / contract</th><th>Entry digit</th><th>Settlement digit</th><th>Order result</th><th>Contract amount</th><th>Quoted total payout</th><th>Amount returned</th><th>Net P/L</th></tr></thead><tbody id="payoutHistory"></tbody></table></div>';
  document.querySelector('main footer').before(panel);
  return (orders,account)=>{
    const currency=account?.currency??'',format=v=>`${v.toFixed(2)} ${currency}`,stats=performance(orders),latest=orders.at(-1);
    document.getElementById('performanceAccount').textContent=account?`Selected account: ${account.accountId} · ${currency} · Separate from Part One`:'Connect and select an account to see its results.';
    const metrics=[['Entry number',latest?.entryDigit??'—'],['Settlement number',latest?.exitDigit??'—'],['Order result',latest?.state==='settled'?(latest.profit>0?'WIN':latest.profit<0?'LOSS':'BREAK EVEN'):latest?.state??'NO ORDER'],['Net profit',format(stats.netProfit)],['Gross profit',format(stats.grossProfit)],['Gross loss',format(stats.grossLoss)],['Recovery needed',format(stats.recoveryNeeded)],['Winning orders',stats.winningOrders],['Losing orders',stats.losingOrders],['Complete orders',stats.completeOrders],['Win rate',stats.winRate===null?'—':`${stats.winRate.toFixed(1)}%`],['Consecutive wins',stats.consecutiveWins],['Consecutive losses',stats.consecutiveLosses],['Drawdown',format(stats.drawdown)],['Maximum drawdown',format(stats.maxDrawdown)]];
    const grid=document.getElementById('performanceMetrics');grid.replaceChildren();
    for(const [label,value] of metrics){const card=document.createElement('div'),name=document.createElement('small'),number=document.createElement('strong');card.className='performance-stat';name.textContent=label;number.textContent=String(value);if(['Gross profit','Winning orders','Win rate','Consecutive wins'].includes(label))number.className='positive';if(['Gross loss','Losing orders','Consecutive losses'].includes(label))number.className='negative';card.append(name,number);grid.append(card);}
    const rows=document.getElementById('payoutHistory');rows.replaceChildren();
    for(const o of [...orders].reverse()){
      const row=document.createElement('tr'),completed=o.state==='settled';
      const values=[new Date(o.createdAt).toLocaleString(),o.contractId??'—',`${o.symbol} · ${o.type} ${o.barrier}`,o.entryDigit??'—',o.exitDigit??'—',completed?(o.profit>0?'WIN':o.profit<0?'LOSS':'BREAK EVEN'):o.state,o.buyPrice??o.stake,o.payout??'—',completed?o.returnAmount??'—':'—',completed?o.profit:'—'];
      for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}rows.append(row);
    }
  };
}
