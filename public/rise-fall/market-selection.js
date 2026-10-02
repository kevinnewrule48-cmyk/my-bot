// Market names come from Deriv's active-symbol discovery, never a static symbol list.
export function scanMarkets(symbols){
 return symbols.map(m=>({symbol:m.underlying_symbol??m.symbol,name:m.underlying_symbol_name??m.display_name??m.name??'',suspended:m.is_trading_suspended===1||m.is_trading_suspended===true}))
  .filter(m=>m.symbol&&!m.suspended&&/volatility|jump|step/i.test(m.name));
}
