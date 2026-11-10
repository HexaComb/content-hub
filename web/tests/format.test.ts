import {test} from 'node:test';
import assert from 'node:assert/strict';
import {value,change,monthLabel} from '../src/scripts/render.ts';
import type {Metric} from '../src/scripts/types.ts';
test('numeric zero remains a reading, missing is explicit, percentages use percentage values',()=>{
 assert.equal(value({value:0,quality:'complete'},'count'),'0');assert.equal(value(null,'count'),'Not available');assert.equal(value({value:4.8,quality:'complete'},'percent'),'4.8%');
});
test('month labels use UTC and include year',()=>assert.equal(monthLabel('2026-01'),'January 2026'));
test('absolute and percentage-point changes are distinct from relative growth',()=>{
 const metric={delta:.7,percentagePoints:.7} as Metric;assert.equal(change(metric),'+0.7 pp');assert.equal(change({...metric,delta:120,percentagePoints:null,unit:'count'}),'+120');assert.equal(change({...metric,delta:null}),'No comparable data');
});
