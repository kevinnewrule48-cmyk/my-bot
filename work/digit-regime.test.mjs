import test from 'node:test';
import assert from 'node:assert/strict';
import {DigitRegimeEngine,divergence} from '../public/digit-regime-engine.js';
import {RegimeResearch,evaluateResearch} from '../public/digit-regime-research.js';
const repeated=(pattern,n)=>Array.from({length:n},(_,i)=>pattern[i%pattern.length]);
const extremes=[0,1,9,0,8,0,1,9],middle=[5,4,6,3,5,4,6,5],balanced=[0,5,1,4,2,8,3,9,6,7];
function feed(e,digits,{market='R_100',start=1}={}){let s;for(let i=0;i<digits.length;i++)s=e.observe({market,digit:digits[i],sequence:start+i,time:1000+start+i});return s;}
test('A/B: extreme bouncing raises transitions and revisits; middle activity lowers them',()=>{
 const a=feed(new DigitRegimeEngine(),repeated(extremes,220)),b=feed(new DigitRegimeEngine(),repeated(middle,220));
 assert.equal(a.windows[0].zones.extreme.percent,100);assert.equal(b.windows[0].zones.middle.percent,100);
 assert.ok(a.windows[0].pressure.percent>b.windows[0].pressure.percent);assert.ok(a.windows[0].revisits.extreme.visits>b.windows[0].revisits.extreme.visits);
 assert.ok(a.windows[0].digitGaps[0].rapidRevisits>0);assert.equal(a.executionAuthority,false);
});
test('C/F: sustained recovery is visible before old 200-tick history disappears',()=>{
 const e=new DigitRegimeEngine();feed(e,repeated(extremes,220));const states=[];
 for(let i=0;i<80;i++){const s=feed(e,[middle[i%middle.length]],{start:221+i});states.push(s.state);}
 assert.ok(states.includes('RECOVERING'));assert.equal(states.at(-1),'RECOVERING');
 assert.ok(e.snapshot('R_100').windows.at(-1).zones.extreme.percent>0);
 const s=feed(e,repeated(middle,220),{start:301});assert.equal(s.state,'NORMAL');
});
test('D: one middle digit cannot declare recovery',()=>{
 const e=new DigitRegimeEngine();feed(e,repeated(extremes,220));const s=feed(e,[5],{start:221});assert.notEqual(s.state,'RECOVERING');assert.ok(['EXTREME','UNSTABLE'].includes(s.state));
});
test('E: a recent 25-tick deterioration is detected against broader normal history',()=>{
 const e=new DigitRegimeEngine();feed(e,repeated(balanced,220));const s=feed(e,repeated(extremes,28),{start:221});
 const c=s.comparisons.find(x=>x.short===25&&x.long===200);assert.equal(c.extremeChange.direction,'RISING');assert.equal(c.transitionChange.direction,'RISING');assert.ok(c.jsBits>0);
 assert.ok(s.windows[0].zones.extreme.percent>s.windows.at(-1).zones.extreme.percent);
});
test('G: every prefix is deterministic and future suffixes cannot change saved snapshots',()=>{
 const prefix=repeated(balanced,210),a=new DigitRegimeEngine(),b=new DigitRegimeEngine();
 const saved=feed(a,prefix),before=JSON.stringify(saved);feed(b,[...prefix,...extremes]);assert.equal(JSON.stringify(saved),before);
 const c=new DigitRegimeEngine();assert.deepEqual(feed(c,prefix),saved);feed(a,middle,{start:211});assert.equal(JSON.stringify(saved),before);
 assert.equal(saved.sequence,210);assert.equal(saved.digitWindows[25].length,25);
});
test('rolling occupancy and matrix exactly match brute force after evictions',()=>{
 const e=new DigitRegimeEngine(),digits=repeated([0,9,5,1,8,2,6,3,7,4,4,9,0],800),s=feed(e,digits);
 for(const w of s.windows){const last=digits.slice(-w.size),counts=Array(10).fill(0),matrix=Array.from({length:10},()=>Array(10).fill(0));last.forEach((d,i)=>{counts[d]++;if(i)matrix[last[i-1]][d]++;});assert.deepEqual(w.occupancy.map(d=>d.count),counts);assert.deepEqual(w.transitionCounts,matrix);assert.equal(matrix.flat().reduce((a,b)=>a+b),w.size-1);}
});
test('revisits require leaving a digit or zone; repeats stay in run metrics',()=>{
 const s=feed(new DigitRegimeEngine({windows:[5,10]}),[0,0,5,0,4,6,3,7,0,1]);const w=s.windows[1];
 assert.equal(w.digitGaps[0].revisitCount,2);assert.equal(w.digitGaps[0].averageRevisitGap,3.5);assert.equal(w.digitGaps[0].minimumRecentGap,2);
 assert.equal(w.runs.digit.repeats,1);assert.equal(w.digitGaps[2].ticksSinceLast,null);assert.equal(w.digitGaps[2].absentEntireWindow,true);
});
test('entropy and divergence have exact interpretable bounds',()=>{
 const uniform=feed(new DigitRegimeEngine(),repeated(balanced,200)),concentrated=feed(new DigitRegimeEngine(),repeated([5],200));assert.ok(Math.abs(uniform.windows.at(-1).entropy-1)<1e-12);assert.equal(concentrated.windows[0].entropy,0);
 assert.equal(divergence([1,0,0,0,0,0,0,0,0,0],[0,1,0,0,0,0,0,0,0,0]).jsBits,1);
});
test('independent OVER, UNDER and all DIFFER supports are not copied',()=>{
 const s=feed(new DigitRegimeEngine(),repeated([0,1,0,1,2],220));assert.equal(s.supports.over.level,'WEAK');assert.equal(s.supports.under.decision,'ALLOW');assert.equal(s.supports.differ.length,10);assert.equal(s.supports.differ[0].decision,'BLOCK');assert.equal(s.supports.differ[9].decision,'ALLOW');
});
test('duplicates, invalid and out-of-order ticks do not advance state; markets are isolated',()=>{
 const e=new DigitRegimeEngine();const a=feed(e,repeated(extremes,50));assert.equal(e.observe({market:'R_100',digit:2,sequence:50,time:1050}),null);assert.equal(e.observe({market:'R_100',digit:NaN,sequence:51,time:1051}),null);assert.equal(e.snapshot('R_100'),a);
 const b=feed(e,repeated(middle,50),{market:'R_10'});assert.equal(b.windows[0].zones.extreme.count,0);assert.equal(a.windows[0].zones.extreme.count,25);
 for(let i=0;i<15;i++)feed(e,[5],{market:'M'+i});assert.equal(e.markets.size,8);
});
test('gapped feed resets only shadow measurements; custom windows validate',()=>{
 const e=new DigitRegimeEngine();feed(e,repeated(extremes,50));const s=e.observe({market:'R_100',digit:5,time:2000,sequence:51});assert.equal(s.windows[0].sample,1);assert.equal(e.resets,1);
 assert.throws(()=>new DigitRegimeEngine({windows:[1,100000]}));assert.deepEqual(new DigitRegimeEngine({windows:[10,30,60]}).config.windows,[10,30,60]);
});
function researchTrade(r,id,{profit=1,status='won',type='DIGITOVER',barrier=1,stamp=10000}={}){
 r.observe('attempt',{attemptId:id,market:'R_100',sequence:220,capturedAt:stamp,type,barrier,accountId:'demo',accountType:'demo',currency:'USD',stake:1,existing:{gate:100}});
 r.observe('receipt',{attemptId:id,receipt:{attemptId:id,contractId:id,state:'settled',status,profit,payout:profit+1,buyPrice:1,currency:'USD',lifecycle:{entryDigit:4,settlementDigit:status==='won'?4:0}}});
}
test('immutable pre-entry snapshot, durable callbacks, idempotent settlements and payout-aware accounting',()=>{
 const saved=[],r=new RegimeResearch({onRecord:x=>saved.push(x)});repeated([0,1,0,1,2],220).forEach((digit,i)=>r.observe('tick',{market:'R_100',digit,time:1000+i,sequence:i+1}));
 researchTrade(r,'a',{profit:-1,status:'lost'});researchTrade(r,'b',{profit:.1,status:'won'});
 const before=JSON.stringify(r.trades.get('a').preEntry);r.observe('tick',{market:'R_100',digit:5,time:1220,sequence:221});assert.equal(JSON.stringify(r.trades.get('a').preEntry),before);
 r.observe('receipt',{receipt:{attemptId:'a',contractId:'a',state:'settled',status:'lost',profit:-1}});
 const g=evaluateResearch([...r.trades.values()]).groups[0];assert.equal(g.all.baseline.trades,2);assert.equal(g.all.losingTradesCorrectlyBlocked,1);assert.equal(g.all.winningTradesIncorrectlyBlocked,1);assert.equal(g.all.baseline.netPL,-.9);assert.equal(g.all.baseline.winRate,50);assert.ok(saved.length>=4);
 const restored=new RegimeResearch();restored.restore([...r.trades.values()]);assert.equal(restored.trades.size,2);
});
test('pending, mismatched, missing and unverified settlements are excluded, not manufactured',()=>{
 const r=new RegimeResearch();r.observe('attempt',{attemptId:'p',market:'R_100',sequence:1,capturedAt:1,type:'DIGITOVER'});
 r.observe('receipt',{receipt:{attemptId:'p',contractId:'p',state:'settled',status:'won',profit:null}});assert.equal(evaluateResearch([...r.trades.values()]).groups.length,0);
 r.observe('receipt',{receipt:{contractId:'unknown',state:'settled',status:'won',profit:3}});assert.equal(r.events.at(-1).event,'MISSING_PRE_ENTRY');
 assert.equal(r.trades.get('p').preEntry.shadow.decision,'OBSERVE');
});
test('retention is bounded and never silently removes unresolved trade records',()=>{
 const r=new RegimeResearch();for(let i=0;i<205;i++)r.observe('attempt',{attemptId:String(i),market:'X',sequence:i,capturedAt:i,type:'DIGITOVER'});assert.equal(r.trades.size,200);assert.equal(r.dropped.trades,5);assert.match(r.warning,/capacity/);
 for(let i=0;i<800;i++)r.observe('candidate',{market:'X',sequence:i,candidates:[]});assert.equal(r.candidates.length,500);assert.equal(r.dropped.candidates,300);
});
test('chronological out-of-sample and walk-forward splits purge overlapping settlements',()=>{
 const rows=[];for(let i=0;i<100;i++)rows.push({state:'settled',contractId:String(i),preEntry:{capturedAt:i*10,type:'DIGITOVER',accountId:'demo',accountType:'demo',regime:{version:'v1',config:{},state:'NORMAL'},shadow:{decision:'ALLOW'}},settlement:{settledAt:i*10+2,status:'won',profit:.1,payout:1.1,buyPrice:1,currency:'USD',source:'broker receipt'}});
 rows[59].settlement.settledAt=650;const result=evaluateResearch(rows),g=result.groups[0];assert.equal(g.development.baseline.trades,59);assert.equal(g.validation.baseline.trades,40);assert.equal(g.purgedOverlaps,1);assert.ok(g.walkForward.length);assert.equal(result.sufficientEvidence,true);
 const changed=structuredClone(rows);changed[99].preEntry.accountType='real';assert.equal(evaluateResearch(changed).groups.length,2);
});

test('feed restart clears shadow history and mock receipts cannot become broker evidence',()=>{
 const r=new RegimeResearch();
 repeated(extremes,220).forEach((digit,i)=>r.observe('tick',{market:'R_100',digit,time:1000+i,sequence:i+1}));
 r.observe('attempt',{attemptId:'mock',market:'R_100',sequence:220,capturedAt:10000,type:'DIGITOVER',barrier:1});
 r.observe('receipt',{receipt:{attemptId:'mock',contractId:'mock',state:'settled',status:'won',profit:1,evidenceSource:'mock'}});
 assert.equal(r.trades.get('mock').state,'settled');assert.equal(evaluateResearch([...r.trades.values()]).groups.length,0);
 r.observe('feed-start',{market:'R_100'});assert.equal(r.latest,null);assert.equal(r.lastSeen,null);
 r.observe('tick',{market:'R_100',digit:5,time:2000,sequence:1});assert.equal(r.latest.windows[0].sample,1);assert.equal(r.trades.size,1);
});
