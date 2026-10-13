// Read-only display measurements; no import from this module into authorization.
export function opportunityMetrics(state,candidate=state?.selected??state?.candidates.find(c=>c.direction===state.lean)){
 if(!candidate)return {pressure:null,stability:null,momentum:null,quality:null};
 const pressure=candidate.entryEdge.pressure;
 const stability=state.ticks.length>=50?state.fine.stability:null;
 // Signed percentage-point change: positive means favorable support improving.
 const momentum=candidate.momentum;
 // Equal-weight observational summary; neutral momentum maps to 50, +/-100pp to 100/0.
 const momentumIndex=Number.isFinite(momentum)?Math.max(0,Math.min(100,50+momentum/2)):null;
 const quality=stability===null||momentumIndex===null?null:((100-pressure)+stability+momentumIndex)/3;
 return {pressure,pressureTrend:candidate.entryEdge.trend,stability,momentum,momentumIndex,quality,candidate:candidate.label};
}
