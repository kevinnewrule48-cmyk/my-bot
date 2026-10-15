import test from 'node:test';
import assert from 'node:assert/strict';
import {digitBoundary,DigitWheelState,mountDigitWheel} from '../public/live-digit-wheel.js';
test('linear tracker shades strict UNDER/OVER sets with equality losing',()=>{for(const barrier of [1,2,7,8])for(const direction of ['OVER','UNDER']){const slots=digitBoundary({direction,barrier});assert.equal(slots.length,10);assert.equal(slots[barrier].winning,false);assert.equal(slots[barrier].boundary,true);assert.deepEqual(slots.filter(s=>s.winning).map(s=>s.digit),Array.from({length:10},(_,i)=>i).filter(d=>direction==='OVER'?d>barrier:d<barrier));}});
test('linear tracker clears shading with no valid candidate',()=>{for(const c of [null,{}, {direction:'DIFFER',barrier:3},{direction:'OVER',barrier:NaN}])assert.equal(digitBoundary(c),null);});
test('tracker observer does not mutate candidate qualification',()=>{const c=Object.freeze({direction:'UNDER',barrier:8,ready:false});digitBoundary(c);assert.equal(c.ready,false);});
