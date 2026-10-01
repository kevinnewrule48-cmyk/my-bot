// Local UI test only. No credentials, purchase endpoint or financial transactions.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('public');
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(url.pathname==='/api/accounts')return res.end(JSON.stringify({accounts:[{accountId:'FIXTURE_A',accountType:'demo',currency:'USD'},{accountId:'FIXTURE_B',accountType:'demo',currency:'USD'}]}));
  if(url.pathname==='/api/rise-fall/balance')return res.end(JSON.stringify({accountId:url.searchParams.get('accountId'),amount:url.searchParams.get('accountId')==='FIXTURE_B'?42:100,currency:'USD',updatedAt:Date.now()}));
  if(url.pathname==='/api/rise-fall/stop')return res.end('{}');
  res.statusCode=409;return res.end(JSON.stringify({error:'UI fixture: trading intentionally unavailable'}));
 }
 const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
}).listen(3003,'127.0.0.1',()=>console.log('UI test fixture http://localhost:3003/rise-fall/index.html'));
