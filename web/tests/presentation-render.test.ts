import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPresentation,filterPresentation,type PresentationDocument} from '../../src/presentationSchema.ts';
import {themePresets} from '../../src/themeSchema.ts';
import {comparisonContext,renderClientPresentation,renderClientPresentationChooser,resolvePresentationDocument} from '../src/scripts/client-presentation-render.ts';
import type {Metric,Report} from '../src/scripts/types.ts';
import {createTestDocument,TestElement} from './presentation-dom.fixture.ts';
const metric:Metric={id:'allowed',key:'visits',label:'Visits <img src=x onerror=alert(1)>',unit:'count',direction:'higher',current:{value:120,quality:'complete',provider:'Source <script>bad()</script>',collectedAt:'2026-11-01T01:00:00Z'},previous:{value:100,quality:'complete'},delta:20,relativePercent:20,percentagePoints:null,change:'improved',reason:null};
const report:Report={target:{clientId:'client',projectId:'project',name:'Private report',kind:'one_off_project',status:'active'},month:'2026-10',previousMonth:'2026-09',metrics:[metric,{...metric,id:'other',label:'Other permitted metric',unit:'percent',current:{value:0,quality:'partial'},previous:null,delta:null,relativePercent:null,percentagePoints:null,change:'not_comparable',reason:'missing_or_partial_period'}]};
function render(design:unknown,model:Report=report,options:{canonicalInstagramMetrics?:boolean}={}){const dom=createTestDocument(),canvas=new TestElement('div'),ledger=new TestElement('section');const before=globalThis.document;Object.assign(globalThis,{document:dom.document});try{renderClientPresentation(canvas as unknown as HTMLElement,ledger as unknown as HTMLElement,model,design,options);}finally{Object.assign(globalThis,{document:before});}return {canvas,ledger};}
test('all layout nodes render with trusted classes and hostile plain text stays text',()=>{
 const design:PresentationDocument={schemaVersion:1,name:'Test',theme:themePresets.editorial,width:'edge',sections:['band'],nodes:[{id:'band',type:'band',tone:'accent',space:'generous',children:['stack']},{id:'stack',type:'stack',gap:'normal',align:'left',children:['title','divider','grid']},{id:'title',type:'text',role:'title',text:'<svg onload=alert(1)>Plain copy</svg>'},{id:'divider',type:'divider',style:'checker'},{id:'grid',type:'grid',split:'wide-left',gap:'tight',children:['fact','comparison']},{id:'fact',type:'metric',metricId:'allowed',variant:'statement'},{id:'comparison',type:'comparison',metricIds:['allowed']}]};
 const {canvas,ledger}=render(design),all=canvas.walk();assert.equal(canvas.className,'cp-canvas cp-width-edge');assert.match(canvas.textContent,/<svg onload=alert\(1\)>/);assert.ok(all.every(node=>!['SVG','IMG','SCRIPT','IFRAME'].includes(node.tagName)));assert.ok(all.some(node=>node.className==='cp-grid cp-split-wide-left cp-gap-tight'));assert.match(canvas.textContent,/120/);assert.match(canvas.textContent,/Up 20 from September 2026/);assert.match(canvas.textContent,/October 2026/);assert.match(canvas.textContent,/Source <script>bad\(\)<\/script>/);assert.match(ledger.textContent,/Other permitted metric/);assert.ok(!canvas.textContent.includes('Other permitted metric'));assert.equal(ledger.walk().filter(node=>node.tagName==='TBODY')[0].children.length,2);
});
test('missing project references and recipient-pruned comparisons reveal no IDs',()=>{
 const design=defaultPresentation();design.nodes=[{id:'band',type:'band',tone:'page',space:'normal',children:['missing','empty']},{id:'missing',type:'metric',metricId:'private-forbidden-id',variant:'stat'},{id:'empty',type:'comparison',metricIds:[]}];design.sections=['band'];
 const {canvas,ledger}=render(design);assert.match(canvas.textContent,/This report block is unavailable/);assert.match(canvas.textContent,/No shared readings/);assert.doesNotMatch(canvas.textContent,/private-forbidden-id/);assert.doesNotMatch(ledger.textContent,/private-forbidden-id/);assert.match(ledger.textContent,/Partial|partial/);assert.match(ledger.textContent,/Missing reading/);
});
test('invalid trees and theme injection fall back without executing or fetching content',()=>{
 const invalid={...defaultPresentation(),script:'fetch("https://bad.invalid")'};const fallback=resolvePresentationDocument(invalid,report);assert.equal(fallback.name,'Client report');assert.doesNotMatch(render(invalid).canvas.textContent,/bad.invalid/);
 const badTheme={...report,appearance:{revision:1,updatedAt:null,theme:{...themePresets.night,colors:{...themePresets.night.colors,text:'url(javascript:evil)'}}}} as Report;
 assert.equal(resolvePresentationDocument(null,badTheme).theme.name,'In perspective');
});
test('design transitions clear prior copy, theme attributes and private data',()=>{
 const {document}=createTestDocument(),canvas=new TestElement('div'),ledger=new TestElement('section');const before=globalThis.document;Object.assign(globalThis,{document});
 try{renderClientPresentation(canvas as unknown as HTMLElement,ledger as unknown as HTMLElement,report,defaultPresentation(themePresets.night));const next={...report,metrics:[]};renderClientPresentation(canvas as unknown as HTMLElement,ledger as unknown as HTMLElement,next,defaultPresentation(themePresets.editorial));assert.doesNotMatch(canvas.textContent,/Visits/);assert.doesNotMatch(ledger.textContent,/Visits/);assert.equal(canvas.getAttribute('data-project-heading'),'editorial');assert.equal(canvas.properties.get('--project-background'),themePresets.editorial.colors.background);}finally{Object.assign(globalThis,{document:before});}
});
test('numeric comparison reasons and neutral direction are not invented improvements',()=>{
 assert.equal(comparisonContext({...metric,relativePercent:null,reason:'zero_baseline'}),'The previous value was 0, so a percentage change cannot be calculated.');assert.match(comparisonContext({...metric,relativePercent:null,reason:'relative_change_out_of_range'}),/numeric range/);
 const neutral={...report,metrics:[{...metric,change:'changed',direction:'neutral'}]};const before=globalThis.document,{document}=createTestDocument();Object.assign(globalThis,{document});try{const canvas=new TestElement('div');renderClientPresentation(canvas as unknown as HTMLElement,new TestElement('div') as unknown as HTMLElement,neutral,null);assert.match(canvas.textContent,/Changed/);assert.doesNotMatch(canvas.textContent,/Comparison unavailable/);}finally{Object.assign(globalThis,{document:before});}
});
test('one shared revision renders independent plugin content and both pages inherit each style update',()=>{
 const seoMetric={...metric,id:'seo-only',label:'Search clicks'},instagramMetric={...metric,id:'ig-only',label:'Instagram followers'};
 const design:PresentationDocument={...defaultPresentation(),sections:['intro','seo-copy','ig-copy','facts'],nodes:[...defaultPresentation().nodes,{id:'seo-copy',type:'text',role:'heading',page:'seo',text:'Search performance only'},{id:'ig-copy',type:'text',role:'heading',page:'instagram',text:'Instagram performance only'}]};
 for(const theme of [themePresets.editorial,themePresets.night]){
  design.theme=theme;
  const seo=render(filterPresentation(design,new Set(['seo-only']),'seo'),{...report,metrics:[seoMetric]}),instagram=render(filterPresentation(design,new Set(['ig-only']),'instagram'),{...report,metrics:[instagramMetric]});
  assert.match(seo.canvas.textContent,/Search performance only/);assert.doesNotMatch(seo.canvas.textContent,/Instagram performance only|Instagram followers/);
  assert.match(instagram.canvas.textContent,/Instagram performance only/);assert.doesNotMatch(instagram.canvas.textContent,/Search performance only|Search clicks/);
  assert.deepEqual([...seo.canvas.properties],[...instagram.canvas.properties]);assert.equal(seo.canvas.properties.get('--project-accent'),theme.colors.accent);
  assert.equal(seo.canvas.getAttribute('data-project-heading'),theme.typography.heading);assert.equal(instagram.canvas.getAttribute('data-project-heading'),theme.typography.heading);
  assert.doesNotMatch(seo.ledger.textContent,/Instagram followers/);assert.doesNotMatch(instagram.ledger.textContent,/Search clicks/);
 }
});
test('canonical Instagram suppresses automatic collections but preserves explicit authored monthly evidence and ledger',()=>{
 const design=defaultPresentation();design.sections.push('explicit');design.nodes.push({id:'explicit',type:'metric',metricId:'allowed',variant:'statement'});
 const result=render(design,report,{canonicalInstagramMetrics:true});assert.equal(result.canvas.walk().filter(node=>node.className.startsWith('cp-metric-collection')).length,0);assert.equal(result.canvas.walk().filter(node=>node.className==='cp-fact cp-fact-statement').length,1);assert.match(result.canvas.textContent,/October 2026/);assert.match(result.ledger.textContent,/Other permitted metric/);assert.match(result.ledger.textContent,/exact monthly periods/);
});
test('legacy service chooser uses shared style without rendering authored copy, values or a mixed ledger',()=>{
 const {document}=createTestDocument(),canvas=new TestElement('div'),ledger=new TestElement('section'),before=globalThis.document;Object.assign(globalThis,{document});
 try{renderClientPresentationChooser(canvas as unknown as HTMLElement,ledger as unknown as HTMLElement,report,defaultPresentation(themePresets.night));assert.match(canvas.textContent,/Choose a client page/);assert.doesNotMatch(canvas.textContent,/Visits|120|story in your numbers/);assert.equal(ledger.textContent,'');assert.equal(canvas.properties.get('--project-background'),themePresets.night.colors.background);}finally{Object.assign(globalThis,{document:before});}
});
