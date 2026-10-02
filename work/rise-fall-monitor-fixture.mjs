// Local-only deterministic browser fixture. No account, network feed or trade endpoint.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('public');
const script=`import {RiseFallEngine} from '/rise-fall/engine.js';import {DiagnosticLog} from '/rise-fall/diagnostics.js';import {renderMonitor} from '/rise-fall/monitor-ui.js';
const modes=['UP','DOWN','CHOPPY','FEED STALLED','ANALYZER STALLED','AUTH FAILED','EXECUTING','WON','LOST'];
function show(mode){const now=Date.now(),e=new RiseFallEngine('R_100').enableTrace();for(let i=0;i<600;i++)e.add({epoch:Math.floor(now/1000)-(599-i)*2,quote:mode==='DOWN'?1000-i*.1:mode==='CHOPPY'?1000+i%2:1000+i*.1});let time=mode==='FEED STALLED'?now+30000:now;const a=e.snapshot(time),log=new DiagnosticLog({source:'mock-browser'});log.observe(a,time);const health={state:'live',subscribed:true,lastAcceptedSequence:mode==='ANALYZER STALLED'?a.sequence+1:a.sequence};const orders=mode==='EXECUTING'?[{state:'OPEN'}]:['WON','LOST'].includes(mode)?[{state:'SETTLED',result:mode.toLowerCase(),settledAt:now,buyConfirmedAt:now-1000}]:[];renderMonitor(a,{server:{orders},execution:{blockers:mode==='AUTH FAILED'?['Authentication expired']:[],checks:[]},health,log,now:time,localNow:now,source:'public',warnings:['MOCK UI TEST — no broker or execution']});document.getElementById('fixtureMode').textContent=mode;}
const nav=document.createElement('section');nav.className='panel';nav.textContent='LOCAL DIAGNOSTIC TEST: ';for(const mode of modes){const b=document.createElement('button');b.textContent=mode+' test';b.onclick=()=>show(mode);nav.append(b);}const mark=document.createElement('strong');mark.id='fixtureMode';nav.append(mark);document.querySelector('main').prepend(nav);show('UP');`;
http.createServer(async(req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(script);}
 if(req.url?.startsWith('/api/')){res.statusCode=403;return res.end('No account or trading endpoints in fixture');}
 const url=new URL(req.url,'http://local'),file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 try{let content=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');if(file.endsWith('index.html'))content=content.toString().replace('/rise-fall/app.js','/fixture.js');res.end(content);}catch{res.statusCode=404;res.end();}
}).listen(3088,'127.0.0.1',()=>console.log('Mock-only monitor fixture on port 3088'));
