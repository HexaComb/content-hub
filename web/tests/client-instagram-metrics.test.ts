import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderClientInstagramMetrics,selectClientInstagramMetrics,restrictClientInstagramMetrics,type ClientInstagramMetrics} from '../src/scripts/client-instagram-metrics.ts';
import {createTestDocument,TestElement} from './presentation-dom.fixture.ts';
const model:ClientInstagramMetrics={target:{clientId:'client',projectId:'project'},month:'2026-10',asOfDate:'2026-10-31',timezone:'America/New_York',kpis:[{kind:'followers',metricId:'ig-followers',unit:'count',value:120,quality:'complete',asOf:'2026-10-31T12:00:00Z',periodStart:'2026-10-31',periodEnd:'2026-11-01',reason:null}],followers:{metricId:'ig-followers',ranges:[{key:'7d',start:'2026-10-25',end:'2026-11-01'},{key:'1m',start:'2026-10-01',end:'2026-11-01'}],points:[{date:'2026-10-25',value:100,quality:'complete',asOf:'2026-10-26T01:00:00Z'},{date:'2026-10-27',value:110,quality:'partial'},{date:'2026-10-28',value:112,quality:'complete'},{date:'2026-10-31',value:120,quality:'complete'}]}};
function withDom(run:(canvas:TestElement)=>void){const {document}=createTestDocument(),canvas=new TestElement('div'),before=globalThis.document;Object.assign(globalThis,{document});try{run(canvas);}finally{Object.assign(globalThis,{document:before});}}
test('canonical client Instagram projection drops all workflow data and unexpected nested fields',()=>{
 const raw={...model,ideas:[{title:'Private idea'}],pending:[{title:'Private production'}],answers:[{answer:'yes'}],workflowAvailable:true,kpis:model.kpis.map(kpi=>({...kpi,privateId:'secret'})),followers:{...model.followers,points:model.followers.points.map(point=>({...point,privateId:'secret'}))}};
 const selected=selectClientInstagramMetrics(raw);assert.deepEqual(Object.keys(selected).sort(),['asOfDate','followers','kpis','month','target','timezone']);assert.doesNotMatch(JSON.stringify(selected),/Private|secret|workflow|answers/);assert.equal(selected.kpis[0].value,120);
});
test('standalone renderer shows four canonical KPIs and only actual daily observations, with gaps and source detail',()=>withDom(canvas=>{
 renderClientInstagramMetrics(canvas as unknown as HTMLElement,model,()=>true);const all=canvas.walk();
 assert.equal(all.filter(node=>node.className==='cp-fact cp-fact-stat').length,4);assert.match(canvas.textContent,/Posts published/);assert.match(canvas.textContent,/4 of 7 days recorded/);assert.match(canvas.textContent,/Not recorded/);assert.match(canvas.textContent,/2026-10-26T01:00:00Z/);assert.match(canvas.textContent,/Monthly comparisons, when available/);
 assert.equal(all.filter(node=>node.tagName==='CIRCLE').length,4);assert.equal(all.filter(node=>node.tagName==='POLYLINE').length,1);assert.equal(all.filter(node=>node.tagName==='TBODY')[0].children.length,7);
 assert.doesNotMatch(canvas.textContent,/Content planning|Upcoming content|Answer history|Yes, queue|No, decline/);
}));
test('range changes remain read-only and stale controls cannot update detached private content',()=>withDom(canvas=>{
 let current=true;renderClientInstagramMetrics(canvas as unknown as HTMLElement,model,()=>current);const choices=canvas.walk().filter(node=>node.tagName==='BUTTON');
 choices.find(node=>node.textContent==='Past month')!.click();assert.match(canvas.textContent,/4 of 31 days recorded/);assert.equal(choices.find(node=>node.textContent==='Last 90 days')!.disabled,true);
 current=false;choices.find(node=>node.textContent==='Last 7 days')!.click();assert.match(canvas.textContent,/4 of 31 days recorded/);
}));
test('missing daily history stays empty rather than inventing a monthly curve',()=>withDom(canvas=>{
 renderClientInstagramMetrics(canvas as unknown as HTMLElement,{...model,followers:{...model.followers,points:[]}},()=>true);assert.match(canvas.textContent,/No daily follower observations/);assert.equal(canvas.walk().filter(node=>node.tagName==='SVG').length,0);
}));
test('trusted client metrics have no fetch, mutation, workflow imports or dark dashboard styling',()=>{
 const source=readFileSync(new URL('../src/scripts/client-instagram-metrics.ts',import.meta.url),'utf8'),css=readFileSync(new URL('../src/styles/client-presentation.css',import.meta.url),'utf8');assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|fetch\(|post\(|createModal|safeContentUrl/);assert.match(source,/import type \{InstagramKpi\}/);assert.match(css,/\.cp-ig-series\{stroke:var\(--project-accent\)/);assert.match(css,/\.cp-ig-ranges button\{background:var\(--project-surface\)/);
});
test('later presentation grants remove stale KPI identifiers, units, values, quality and follower source metadata',()=>withDom(canvas=>{
 const safe=restrictClientInstagramMetrics(model,new Set(['different-allowed-metric']));assert.deepEqual(safe.kpis[0],{kind:'followers',metricId:null,unit:null,value:null,quality:'missing',sourceQuality:null,asOf:null,periodStart:null,periodEnd:null,reason:'not_configured'});assert.equal(safe.followers.metricId,null);assert.deepEqual(safe.followers.points,[]);
 renderClientInstagramMetrics(canvas as unknown as HTMLElement,safe,()=>true);assert.doesNotMatch(canvas.textContent,/120|2026-10-26T01:00:00Z|Source updated|Unit: count/);assert.equal(canvas.walk().filter(node=>node.tagName==='SVG').length,0);
 const allowed=restrictClientInstagramMetrics(model,new Set(['ig-followers']));assert.equal(allowed.kpis[0].value,120);assert.equal(allowed.followers.points.length,4);
 const missingIds={...model,kpis:model.kpis.map(kpi=>({...kpi,metricId:null})),followers:{...model.followers,metricId:null}};assert.equal(restrictClientInstagramMetrics(missingIds,new Set(['ig-followers'])).kpis[0].value,null);
}));
