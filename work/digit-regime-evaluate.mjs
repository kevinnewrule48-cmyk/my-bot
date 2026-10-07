// Offline only. Consumes a local research export; cannot trade or contact Deriv.
import {readFile,writeFile} from 'node:fs/promises';
import {evaluateResearch} from '../public/digit-regime-research.js';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node work/digit-regime-evaluate.mjs exported-research.json report.json');
const dataset=JSON.parse(await readFile(input,'utf8'));
if(dataset.schema!=='digit-regime-research-v1'||!Array.isArray(dataset.trades))throw Error('Expected a digit regime research export');
const result={generatedAt:new Date().toISOString(),input,retention:dataset.retention,mode:'OFFLINE RESEARCH',...evaluateResearch(dataset.trades)};
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(`${dataset.trades.length} retained attempts evaluated. Report: ${output}. Execution untouched.`);
