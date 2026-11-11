import {defaultPresentation,presentationDocumentSchema,type PresentationDocument} from '../../../src/presentationSchema.ts';
import {themePresentation} from './theme.ts';
import {monthLabel,value,metricInsight,comparisonContext,readingQuality} from './metric-copy.ts';
import {appendMetricReading} from './metric-reading.ts';
export {comparisonContext,readingQuality} from './metric-copy.ts';
import type {Metric,Report} from './types';

function el<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string):HTMLElementTagNameMap[K]{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
export function clearClientPresentation(canvas:HTMLElement,ledger:HTMLElement){
 canvas.replaceChildren();ledger.replaceChildren();canvas.className='';
 for(let index=canvas.style.length-1;index>=0;index--){const key=canvas.style.item(index);if(key.startsWith('--project-'))canvas.style.removeProperty(key);}
 for(const key of canvas.getAttributeNames())if(key.startsWith('data-project-'))canvas.removeAttribute(key);
}
export function resolvePresentationDocument(raw:unknown,report:Report):PresentationDocument {
 const parsed=presentationDocumentSchema.safeParse(raw);return parsed.success?parsed.data:defaultPresentation(themePresentation(report.appearance?.theme)?.theme);
}
function missingBlock(message='This report block is unavailable.') {return el('p',message,'cp-unavailable');}
function metricBlock(metric:Metric,variant:'statement'|'stat'|'inline',report:Report){
 const block=el('article',undefined,`cp-fact cp-fact-${variant}`);appendMetricReading(block,metric,report);return block;
}
function comparisonBlock(metrics:Metric[],report:Report){
 const group=el('div',undefined,'cp-comparisons');
 if(!metrics.length){group.append(missingBlock('No shared readings in this section.'));return group;}
 for(const metric of metrics){const section=el('article',undefined,'cp-comparison');appendMetricReading(section,metric,report);group.append(section);}
 return group;
}
function applyPresentationTheme(canvas:HTMLElement,design:PresentationDocument){
 const compiled=themePresentation(design.theme)!;canvas.className=`cp-canvas cp-width-${design.width}`;
 for(const [name,token] of Object.entries(compiled.variables))canvas.style.setProperty(name,token);
 for(const [name,token] of Object.entries(compiled.attributes))canvas.setAttribute(name,token);
}
/** Old bookmarks lead to separate service pages without displaying a mixed report. */
export function renderClientPresentationChooser(canvas:HTMLElement,ledger:HTMLElement,report:Report,raw:unknown){
 clearClientPresentation(canvas,ledger);applyPresentationTheme(canvas,resolvePresentationDocument(raw,report));
 const band=el('section',undefined,'cp-band cp-space-normal'),inner=el('div',undefined,'cp-band-inner');
 inner.append(el('h2','Choose a client page','cp-copy cp-copy-heading'),el('p','Open an available page above to view its own metrics. SEO and Instagram share one design, while their reports stay separate.','cp-copy cp-copy-body'));band.append(inner);canvas.append(band);
}
/** The only DOM vocabulary available to a design. All authored copy stays plain text. */
export function renderClientPresentation(canvas:HTMLElement,ledger:HTMLElement,report:Report,raw:unknown,options:{canonicalInstagramMetrics?:boolean}={}){
 clearClientPresentation(canvas,ledger);
 const design=resolvePresentationDocument(raw,report);applyPresentationTheme(canvas,design);
 const nodes=new Map(design.nodes.map(node=>[node.id,node])),metrics=new Map(report.metrics.map(metric=>[metric.id,metric]));
 const renderNode=(id:string):HTMLElement|null=>{
  const node=nodes.get(id)!;
  // Canonical Instagram KPIs replace automatic collections only. Explicit metric and comparison blocks remain authored monthly evidence.
  if(options.canonicalInstagramMetrics&&node.type==='metric_collection')return null;
  const children='children'in node?node.children.map(renderNode).filter((child):child is HTMLElement=>child!==null):[];
  if('children'in node&&!children.length)return null;
  switch(node.type){
   case 'band': {const band=el('section',undefined,`cp-band cp-tone-${node.tone} cp-space-${node.space}`);const inner=el('div',undefined,'cp-band-inner');children.forEach(child=>inner.append(child));band.append(inner);return band;}
   case 'stack': {const stack=el('div',undefined,`cp-stack cp-gap-${node.gap} cp-align-${node.align}`);children.forEach(child=>stack.append(child));return stack;}
   case 'grid': {const grid=el('div',undefined,`cp-grid cp-split-${node.split} cp-gap-${node.gap}`);children.forEach(child=>grid.append(child));return grid;}
   case 'text': {const tags:Record<typeof node.role,'p'|'h2'|'h3'>={eyebrow:'p',title:'h2',heading:'h3',body:'p',caption:'p'};return el(tags[node.role],node.text,`cp-copy cp-copy-${node.role}`);}
   case 'divider': {const divider=el('div',undefined,`cp-divider cp-divider-${node.style}`);divider.setAttribute('aria-hidden','true');return divider;}
   case 'metric': {const metric=metrics.get(node.metricId);return metric?metricBlock(metric,node.variant,report):missingBlock();}
   case 'comparison': return comparisonBlock(node.metricIds.flatMap(id=>metrics.has(id)?[metrics.get(id)!]:[]),report);
   case 'metric_collection': {const group=el('div',undefined,`cp-metric-collection cp-collection-${node.variant}`);report.metrics.forEach(metric=>group.append(metricBlock(metric,node.variant,report)));if(!report.metrics.length)group.append(missingBlock('No metrics are shared with you in this report.'));return group;}
   default: {const unreachable:never=node;return missingBlock();}
  }
 };
 design.sections.forEach(id=>{const node=renderNode(id);if(!node)return;if(nodes.get(id)!.type==='band')canvas.append(node);else{const section=el('section',undefined,'cp-band cp-space-normal'),inner=el('div',undefined,'cp-band-inner');inner.append(node);section.append(inner);canvas.append(section);}});renderLedger(ledger,report);
}
/** Fixed, complete report evidence lives outside the authored composition. */
export function renderLedger(ledger:HTMLElement,report:Report){
 ledger.replaceChildren();const heading=el('h2','The data behind this report');heading.id='client-ledger-heading';
 ledger.append(el('p','DATA & METHODOLOGY','cp-kicker'),heading,el('p',`${monthLabel(report.month)} compared with ${monthLabel(report.previousMonth)}. All monthly metrics available to your verified account on this page are listed below, whether or not they appear in the design. Values are supplied observations for exact monthly periods, not estimated totals.`,'cp-ledger-intro'));
 const details=el('details',undefined,'cp-ledger-details');details.append(el('summary','View all readings & collection details'));ledger.append(details);
 details.append(el('p','Changes are provided only when the underlying readings are comparable. A missing value is not zero. Partial periods are labeled. Percentage-point changes and relative percentage changes are different measures; relative change is unavailable when the previous value is zero. Design copy is supplied commentary, not verified analysis.','cp-ledger-method'));
 if(!report.metrics.length){ledger.append(missingBlock('There are no shared metric readings to display.'));return;}
 const scroll=el('div',undefined,'cp-ledger-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Full report data. Scroll horizontally on small screens.');
 const table=el('table'),caption=el('caption',`Complete report: ${report.target.name}, ${monthLabel(report.month)}`);table.append(caption);
 const head=el('thead'),row=el('tr');for(const label of ['Metric & unit',monthLabel(report.month),monthLabel(report.previousMonth),'Change','Quality & sources']){const cell=el('th',label);cell.scope='col';row.append(cell);}head.append(row);table.append(head);
 const body=el('tbody');for(const metric of report.metrics){const row=el('tr'),name=el('th');name.scope='row';name.append(el('span',metric.label),el('small',`Unit: ${metric.unit} · Direction: ${metric.direction}`));row.append(name,el('td',value(metric.current,metric.unit)),el('td',value(metric.previous,metric.unit)));const delta=el('td');delta.append(el('p',metricInsight(metric,report.previousMonth).headline),el('small',comparisonContext(metric)));const sources=el('td');sources.append(el('p',`Selected month: ${readingQuality(metric.current)}`),el('p',`Previous month: ${readingQuality(metric.previous)}`));row.append(delta,sources);body.append(row);}table.append(body);scroll.append(table);details.append(scroll);
}
