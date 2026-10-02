import {DEFAULTS,configuration} from './engine.js';
// Research presets, not estimates of profitability. Execution risk controls are separate.
export const PRESETS=Object.freeze({
 original:Object.freeze({...DEFAULTS}),
 exploration:Object.freeze({...DEFAULTS,pressure:55,confidence:60,minEfficiency:20,minStrength:20,minPersistence:60})
});
export function presetConfig(name,chopFilter=true){if(!Object.hasOwn(PRESETS,name))throw Error('Unknown analysis preset');return configuration({...PRESETS[name],chopFilter});}
export function presetName(config){return Object.keys(PRESETS).find(name=>Object.entries(PRESETS[name]).every(([k,v])=>k==='chopFilter'||config[k]===v))??'custom';}
