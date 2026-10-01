export function selectedBalance(accounts,accountId){
 const account=accounts.find(a=>a.accountId===accountId&&a.accountType==='demo');
 const raw=account?.balance;
 if(raw===null||raw===undefined||raw===''||!Number.isFinite(Number(raw)))return null;
 return {amount:Number(raw),currency:account.currency??'',accountId};
}
export function formatBalance(value){
 if(!value)return 'Balance unavailable';
 return `${value.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8})} ${value.currency}`.trim();
}
