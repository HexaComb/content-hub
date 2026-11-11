import test from 'node:test';
import assert from 'node:assert/strict';
import {compareReadings,type Direction} from '../../src/domain.ts';
import {metricInsight,comparisonContext,value} from '../src/scripts/metric-copy.ts';
import {appendMetricReading} from '../src/scripts/metric-reading.ts';
import {appendInstagramKpi,kpiPeriod} from '../src/scripts/instagram-kpi-reading.ts';
import {createTestDocument,TestElement} from './presentation-dom.fixture.ts';
import type {Metric,Report} from '../src/scripts/types.ts';
const metric=(current:number,previous:number,direction:Direction='higher',unit='count'):Metric=>({id:'m',key:'test',label:'Test metric',semantics:'period_total',unit,direction,...compareReadings({value:current,quality:'complete'},{value:previous,quality:'complete'},direction,unit)});
const report=(m:Metric):Report=>({target:{clientId:'c',projectId:'p',name:'Test',kind:'project',status:'active'},month:'2026-01',previousMonth:'2025-12',metrics:[m]});
function withDom(run:(parent:TestElement)=>void){const {document}=createTestDocument(),parent=new TestElement('article'),before=globalThis.document;Object.assign(globalThis,{document});try{run(parent);}finally{Object.assign(globalThis,{document:before});}}
test('a falling rank is described as improved and says why; a higher count can decline',()=>{
 const rank=metricInsight(metric(3,8,'lower','position'),'2025-12');assert.equal(rank.status,'Improved');assert.equal(rank.headline,'Down 5 positions from December 2025');assert.match(rank.explanation,/Lower is better/);
 const count=metricInsight(metric(100,120),'2025-12');assert.equal(count.status,'Declined');assert.equal(count.headline,'Down 20 from December 2025');
});
test('percentage-point changes are spelled out and relative growth stays separate',()=>{
 const m=metric(6,4,'higher','percent'),insight=metricInsight(m,'2025-12');assert.equal(insight.headline,'Up 2 percentage points from December 2025');assert.match(comparisonContext(m),/^\+50% relative/);assert.doesNotMatch(insight.headline,/%|pp\b/);
});
test('zero, signed and neutral baselines never invent growth or an improvement',()=>{
 const zero=metric(10,0);assert.equal(metricInsight(zero,'2025-12').headline,'Up 10 from December 2025');assert.match(comparisonContext(zero),/previous value was 0/);
 assert.equal(metricInsight(metric(0,0),'2025-12').status,'No change');
 const signed=metric(-5,-10,'neutral');assert.equal(metricInsight(signed,'2025-12').status,'Changed');assert.match(comparisonContext(signed),/absolute size/);assert.equal(value(signed.current,'count'),'-5');
});
test('missing, partial and out-of-range comparisons explain the actual limitation',()=>{
 const m=metric(3,2),partial={...m,...compareReadings({value:3,quality:'complete'},{value:2,quality:'partial'},'higher','count')};
 assert.equal(metricInsight(partial,'2025-12').tone,'neutral');assert.match(metricInsight(partial,'2025-12').explanation,/incomplete/);
 const missing={...m,...compareReadings(m.current as {value:number;quality:'complete'},null,'higher','count')};assert.match(metricInsight(missing,'2025-12').explanation,/December 2025/);
 assert.match(metricInsight({...m,delta:null,reason:'numeric_change_out_of_range',change:'not_comparable'},'2025-12').explanation,/numeric range/);
});
test('nonzero small values and changes never round into misleading zeros',()=>{
 const m=metric(.0004,.0002,'higher','percent');assert.equal(value(m.current,'percent'),'0.0004%');assert.match(metricInsight(m,'2025-12').headline,/0.0002 percentage points/);
});
test('shared card has two explicit dated readings, partial coverage and collapsed source detail',()=>withDom(parent=>{
 const m={...metric(3,2),label:'Metric <script>text only</script>',previous:{value:2,quality:'partial'},delta:null,relativePercent:null,percentagePoints:null,change:'not_comparable',reason:'missing_or_partial_period'};
 appendMetricReading(parent as unknown as HTMLElement,m,report(m));const all=parent.walk();
 assert.deepEqual(all.filter(node=>node.tagName==='DT').map(node=>node.textContent),['January 2026','December 2025']);assert.equal(all.filter(node=>node.tagName==='DD').length,2);
 assert.match(parent.textContent,/Partial period/);assert.match(parent.textContent,/Metric <script>text only/);assert.equal(all.filter(node=>node.tagName==='SCRIPT').length,0);
 const details=all.find(node=>node.tagName==='DETAILS')!;assert.equal(details.getAttribute('open'),null);assert.match(details.textContent,/Complete period/);assert.doesNotMatch(parent.textContent,/Improved|Declined|↗/);
}));
test('Instagram periods respect exclusive end dates and incomplete readings stay explicit',()=>withDom(parent=>{
 const kpi={kind:'posts' as const,value:7,quality:'partial',periodStart:'2026-01-01',periodEnd:'2026-01-12',asOf:'2026-01-12T08:00:00Z',reason:null};
 assert.equal(kpiPeriod(kpi),'Jan 1, 2026 – Jan 11, 2026');appendInstagramKpi(parent as unknown as HTMLElement,'posts',kpi);assert.match(parent.textContent,/Posts published/);assert.match(parent.textContent,/Partial period/);assert.match(parent.textContent,/not a comparison/);assert.doesNotMatch(parent.textContent,/Improved|% growth/);
}));
