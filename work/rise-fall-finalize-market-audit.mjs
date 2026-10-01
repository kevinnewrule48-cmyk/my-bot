import {readFileSync,writeFileSync} from 'node:fs';
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const a=load('outputs/rise-fall-replay-report.json'),b=load('outputs/rise-fall-replay-supplement.json'),audit=load('outputs/rise-fall-market-audit.json');
if(JSON.stringify(a.configFingerprints)!==JSON.stringify(b.configFingerprints))throw Error('Replay profile mismatch');
if(a.symbols.some(s=>b.symbols.includes(s)))throw Error('Replay partitions overlap; do not double count');
const report={...a,generatedAt:new Date().toISOString(),realData:a.realData&&b.realData,replayCompleted:a.replayCompleted&&b.replayCompleted,symbols:[...a.symbols,...b.symbols].sort(),validationTicks:a.validationTicks+b.validationTicks,results:[...a.results,...b.results]};
if(audit.rows.filter(r=>r.contracts.length).some(r=>!report.symbols.includes(r.symbol)))throw Error('Missing market replay');
writeFileSync('outputs/rise-fall-replay-report.json',JSON.stringify(report,null,2));
const baseline=report.results.filter(r=>r.profile==='baseline'&&r.partition==='validation');
const lines=['# Rise/Fall market and demo-balance correction', '',`Checked: ${audit.checkedAt}`, '',
'## Root causes','',
'- Balance UI read the accounts list instead of the authenticated WebSocket balance response. It now requests balance:1 on a connection scoped to the verified selected demo options account. No MT5/wallet balance or local profit estimate is substituted.',
'- Only five regular volatility symbols were included in replay approval. The history/replay pipeline now covers all supported markets returned by this audit, with duration-specific evidence. Unsupported or untested durations still cannot start Auto.',
'- Market-selection buttons were incorrectly tied to current signal readiness. Supported markets are now selectable without a READY signal; executing still requires the unchanged strategy conditions.',
'- Repeated whole-market history downloads caused rate limits and stale recommendations. The scanner now caches metadata and retains live tick subscriptions, and distinguishes unconfirmed availability from broker-confirmed unavailability.', '',
'## Verification','',
'29 automated tests passed. Isolated browser fixture proved account B shows its balance, switching to A replaces both ID and balance; no trade endpoint exists in that fixture. Live public browser analysis verified 1HZ100V feed and contract durations. Actual user balance remains unverified: accessible browser is signed out of Deriv.',
`Replayed ${report.symbols.length} symbols, ${report.validationTicks} held-out ticks, ${report.results.length} profile/duration/partition runs. Baseline validation trades across duration simulations: ${baseline.reduce((n,r)=>n+r.trades,0)}. These are hypothetical overlapping simulations, not actual orders or proof of profitability.`,
'', 'No strategy thresholds, proposal validation, account ownership checks or execution permissions were removed. Rise/Fall real-money execution remains disabled. No trades were placed. Backup: checkpoints/before-rise-fall-balance-markets-20261001.', '',
'## Public contract availability','',
'Availability is from the public API, not a guarantee of account-specific eligibility or current proposal acceptance. The authenticated connection and proposal still decide that. Tick durations and time durations are separate.', '',
'| Market | Symbol | Rise/Fall durations reported |','|---|---|---|',
...audit.rows.map(r=>`| ${r.name} | ${r.symbol} | ${r.contracts.filter(c=>c.type==='CALL').map(c=>c.min+'–'+c.max).join(', ')||'Not returned'} |`), '',
'## Files changed','',
'rise-fall-service.mjs; public/rise-fall/app.js, balance.js, contracts.js, scanner.js; work/rise-fall-history.mjs, rise-fall-replay.mjs, rise-fall-balance.test.mjs, rise-fall-scanner.test.mjs; outputs/rise-fall-replay-report.json.', '',
'New audit/verification files: work/rise-fall-market-audit.mjs, rise-fall-finalize-market-audit.mjs, rise-fall-ui-fixture.mjs; outputs/rise-fall-market-audit.json, rise-fall-replay-supplement.json, RISE-FALL-MARKETS-BALANCE.md; additional public tick recordings in outputs/rise-fall. No credentials or user balances are included.', '',
'Deriv balance documentation: https://developers.deriv.com/docs/account/balance/'];
writeFileSync('outputs/RISE-FALL-MARKETS-BALANCE.md',lines.join('\n'));
console.log(JSON.stringify({symbols:report.symbols.length,validationTicks:report.validationTicks,runs:report.results.length,baselineTrades:baseline.reduce((n,r)=>n+r.trades,0)}));
