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
// The authenticated socket is scoped to this verified options account, not a wallet/MT5 account.
export function brokerBalance(response,account){
 const raw=response?.balance?.balance;
 if(account?.account_type!=='demo'||raw==null||raw===''||!Number.isFinite(Number(raw)))throw Error('Deriv did not return a valid demo balance');
 return {accountId:account.account_id,accountType:'demo',amount:Number(raw),currency:response.balance.currency??account.currency,loginId:response.balance.loginid??null};
}
