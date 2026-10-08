// Purchase-time ENTRY and official broker entry are distinct. Neither uses the render-time cursor.
import {extractLastDigit} from './digit-barrier-engine.js';
export function contractDigit(price,precision){
  if(price===null||price===undefined||price==='')return null;
  if(Number.isInteger(precision)){try{return extractLastDigit(price,precision).digit;}catch{return null;}}
  // Without broker precision, only an explicitly formatted decimal string is usable.
  if(typeof price!=='string'||!/^\d+\.\d+$/.test(price))return null;
  return Number(price.at(-1));
}
export function reduceContract(previous,receipt){
  const r=receipt.lifecycle?.schema===1?receipt.lifecycle:receipt;
  if(!r?.contractId)return previous??null;
  const contractId=String(r.contractId),strategy=r.strategy??previous?.strategy??(r.type==='DIGITDIFF'?'DIFFER':'OVER_UNDER');
  if(previous&&(previous.contractId!==contractId||previous.strategy!==strategy||previous.attemptId&&r.attemptId&&previous.attemptId!==r.attemptId))return previous;
  const precision=previous?.precision??r.precision??r.purchaseTick?.pipSize;
  const entryTick=previous?.entryTick??r.entryTick??null;
  const settled=previous?.state==='settled'||['won','lost','sold'].includes(r.status);
  const exitTick=previous?.exitTick??(settled?r.exitTick??null:null);
  const status=previous?.state==='settled'?previous.status:settled?r.status:'open';
  const validDigit=d=>Number.isInteger(d)&&d>=0&&d<=9?d:null;
  const purchase=r.purchaseTick;
  const purchaseDigit=purchase&&Number.isFinite(purchase.epoch)&&contractDigit(purchase.price,purchase.pipSize)===validDigit(purchase.digit)?validDigit(purchase.digit):null;
  const entrySource=previous?.entrySource??(previous?.schema===1?'broker-entry':null)??r.entrySource??(Object.hasOwn(r,'purchaseTick')?'purchase-time':'broker-entry');
  const entryDigit=previous?.entryDigit??(r.schema===1?validDigit(r.entryDigit):entrySource==='purchase-time'?purchaseDigit:contractDigit(entryTick,precision));
  const brokerEntryDigit=previous?.brokerEntryDigit??(r.schema===1?validDigit(r.brokerEntryDigit):contractDigit(entryTick,precision));
  const settlementDigit=previous?.settlementDigit??(r.schema===1?validDigit(r.settlementDigit):contractDigit(exitTick,precision));
  return Object.freeze({schema:1,contractId,strategy,decisionId:previous?.decisionId??r.decisionId??receipt.decisionId??null,type:previous?.type??r.type??receipt.type??null,barrier:previous?.barrier??r.barrier??receipt.barrier??null,attemptId:previous?.attemptId??r.attemptId??null,
    accountId:previous?.accountId??r.accountId??null,symbol:r.symbol??previous?.symbol??null,precision,
    entryTick,entryDigit,entrySource,brokerEntryDigit,entryTickTime:previous?.entryTickTime??r.entryTickTime??null,
    purchaseQuote:previous?.purchaseQuote??r.purchaseQuote??purchase?.price??null,
    purchaseTickTime:previous?.purchaseTickTime??r.purchaseTickTime??purchase?.epoch??null,
    exitTick,settlementDigit,exitTickTime:previous?.exitTickTime??r.exitTickTime??null,
    status,result:status==='won'?'WON':status==='lost'?'LOST':status==='sold'?'SOLD':'PENDING',state:settled?'settled':'entered'});
}
export class ContractLifecycleStore{
  constructor(){this.contracts=new Map();}
  clear(){this.contracts.clear();}
  accept(receipt){
    const id=receipt?.contractId;if(!id)return null;
    const previous=this.contracts.get(String(id)),incoming=receipt.lifecycle??receipt;
    if(previous&&incoming.decisionId&&previous.decisionId&&incoming.decisionId!==previous.decisionId)return null;
    if(previous&&((incoming.type&&previous.type&&incoming.type!==previous.type)||(incoming.barrier!==undefined&&previous.barrier!==null&&incoming.barrier!==previous.barrier)))return null;
    if(previous&&(incoming.strategy&&previous.strategy!==incoming.strategy||incoming.attemptId&&previous.attemptId&&incoming.attemptId!==previous.attemptId))return null;
    const record=reduceContract(previous,receipt);
    if(record)this.contracts.set(String(id),record);
    return record;
  }
}
