import {TradabilityMarkets} from '../public/tradability-markets.js';
import {TradabilityEngine,tradabilityBlocks} from '../public/tradability-engine.js';
import {DifferEngine} from '../public/differ-engine.js';
import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {DigitBarrierEngine,extractLastDigit,proposalRequest} from '../public/digit-barrier-engine.js';
import {diagnoseSnapshot} from '../public/part-one-diagnostics.js';
import {DigitWheelState} from '../public/live-digit-wheel.js';
import {heatMap} from '../public/premium-model.js';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
test('Part One real app: independent READY leads to demo request, receipt and cooldown',async()=>{
 for(const type of ['OVER','UNDER']){
 const fields=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{value:'0',checked:false,textContent:'',classList:{toggle(){},add(){},remove(){}},addEventListener(){},setCustomValidity(){},querySelector(){return null;},replaceChildren(){},append(){}}]));
 for(const [k,v] of Object.entries({symbol:'R_100',window:200,minimum:65,barrierPersistence:1,stake:1,maxStake:5000,autoCooldownTicks:5,accountSelector:'demo1',duration:1}))fields[k].value=String(v);
 const requests=[];
 const context=vm.createContext({TradabilityMarkets:class extends TradabilityMarkets {start(){}},TradabilityEngine,tradabilityBlocks,DifferEngine,liveDigitWheel:new DigitWheelState(),heatMap,DigitBarrierEngine,extractLastDigit,proposalRequest,diagnoseSnapshot,console,document:{getElementById:id=>fields[id]},localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async(url,options)=>{
 if(url==='/api/order'){requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({contractId:'mock',entryTick:'100.03'})};}
 return {ok:true,json:async()=>({connected:false,configured:false})};
 }});
 vm.runInContext(source.replace(/^import[^\n]*\n/gm,''),context);
 await new Promise(r=>setImmediate(r));
 vm.runInContext("demoConnected=true;availableAccounts=[{accountId:'demo1',accountType:'demo'}];botMode='auto';autoEnabled=true;parallelAutoReady=true;quotes.over={ask:1,payout:1.1};quotes.under={ask:1,payout:1.1};",context);
 for(let i=0;i<200;i++){const d=[3,5,7,8,9][i%5];context.testPrice=100+(type==='OVER'?d:9-d)/100;vm.runInContext('addTick(testPrice,1000+liveTickNumber,2)',context);}
 await new Promise(r=>setImmediate(r));
 assert.equal(requests.length,1);assert.equal(requests[0].type,'DIGIT'+type);assert.equal(requests[0].accountType,'demo');assert.equal(requests[0].mode,'auto');
 assert.match(fields.cooldownMonitor.textContent,/COOLDOWN/);assert.match(fields.barrierDiagnostics.textContent,/READY/);
 const diagnostics=vm.runInContext('barrierAudit.filter(e=>e.stage==="candidate-evaluation")',context);
 assert.equal(diagnostics.filter(e=>e.lastDigit!==null).length,200);assert.equal(diagnostics.at(-1).candidates.length,2);
 assert.ok(diagnostics.at(-1).risk);assert.ok(diagnostics.at(-1).quote);
 const orderTrace=vm.runInContext('barrierAudit.find(e=>e.stage==="proposal-request")',context);
 assert.ok(orderTrace.decisionId);assert.ok(vm.runInContext('barrierAudit.some(e=>e.stage==="proposal-validation")',context));
 vm.runInContext('for(let i=0;i<2100;i++)auditStage("bound-test",{})',context);
 assert.equal(vm.runInContext('barrierAudit.length',context),2000);assert.ok(vm.runInContext('auditDropped',context)>0);
 }
});
