import {appendInstagramKpi} from './instagram-kpi-reading.ts';
import {dateLabel,monthLabel} from './metric-copy.ts';
import {followerPlot,lastIncludedDate,rangeLabels,kpiLabels,metricValue,type FollowerPoint,type FollowerRange} from './instagram-view-state.ts';
import type {InstagramKpi} from './instagram-dashboard';
export type ClientInstagramKpi=InstagramKpi&{metricId:string|null;unit:string|null};
export type ClientInstagramMetrics={target:{clientId:string;projectId:string;tenantId?:string};month:string;asOfDate:string;timezone:string;kpis:ClientInstagramKpi[];followers:{metricId:string|null;ranges:FollowerRange[];points:FollowerPoint[]}};
/** Drop every workflow field as the response arrives, including in administrator previews. */
export function selectClientInstagramMetrics(data:ClientInstagramMetrics):ClientInstagramMetrics {
 return {target:{clientId:data.target.clientId,projectId:data.target.projectId,...(data.target.tenantId?{tenantId:data.target.tenantId}:{})},month:data.month,asOfDate:data.asOfDate,timezone:data.timezone,
  kpis:data.kpis.map(({kind,metricId,unit,value,quality,sourceQuality,asOf,periodStart,periodEnd,reason})=>({kind,metricId,unit,value,quality,sourceQuality,asOf,periodStart,periodEnd,reason})),
  followers:{metricId:data.followers.metricId,ranges:data.followers.ranges.map(({key,start,end})=>({key,start,end})),points:data.followers.points.map(({date,value,quality,sourceQuality,reason,asOf})=>({date,value,quality,sourceQuality,reason,asOf}))}};
}
/** The later presentation response is the final authority for every displayed metric. */
export function restrictClientInstagramMetrics(data:ClientInstagramMetrics,allowed:ReadonlySet<string>):ClientInstagramMetrics {
 return {...data,kpis:data.kpis.map(kpi=>kpi.metricId&&allowed.has(kpi.metricId)?kpi:{kind:kpi.kind,metricId:null,unit:null,value:null,quality:'missing',sourceQuality:null,asOf:null,periodStart:null,periodEnd:null,reason:'not_configured'}),followers:data.followers.metricId&&allowed.has(data.followers.metricId)?data.followers:{metricId:null,ranges:data.followers.ranges,points:[]}};
}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const svgNode=<K extends keyof SVGElementTagNameMap>(name:K,attrs:Record<string,string>)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;};
/** A trusted metrics-only block inside the validated shared theme boundary. No network or workflow actions. */
export function renderClientInstagramMetrics(canvas:HTMLElement,model:ClientInstagramMetrics,isCurrent:()=>boolean){
 const section=el('section',undefined,'cp-band cp-tone-surface cp-space-normal cp-instagram-metrics');section.setAttribute('aria-label','Instagram metrics and follower history');
 const inner=el('div',undefined,'cp-band-inner');section.append(inner);
 inner.append(el('h2','Instagram performance','cp-copy cp-copy-heading'),el('p',`${monthLabel(model.month)} · Reporting through ${dateLabel(model.asOfDate)} · ${model.timezone}`,'cp-copy cp-copy-caption'));
 inner.append(el('p','Each metric shows its own recorded period. Monthly comparisons, when available, are in the data details below.','cp-copy cp-copy-caption'));
 const cards=el('div',undefined,'cp-metric-collection cp-ig-kpis');
 for(const kind of Object.keys(kpiLabels) as (keyof typeof kpiLabels)[]){
  const card=el('article',undefined,'cp-fact cp-fact-stat');appendInstagramKpi(card,kind,model.kpis.find(item=>item.kind===kind));cards.append(card);
 }
 inner.append(cards);
 const history=el('section',undefined,'cp-ig-history');history.append(el('h3','Followers over time','cp-copy cp-copy-heading'),el('p','Your audience size each day. Gaps mean no reading was recorded; they do not mean zero followers.','cp-copy cp-copy-caption'));
 const choices=el('div',undefined,'cp-ig-ranges'),graph=el('div',undefined,'cp-ig-graph');choices.setAttribute('role','group');choices.setAttribute('aria-label','Follower history range');
 let selected:FollowerRange['key']='7d';const buttons=new Map<FollowerRange['key'],HTMLButtonElement>();
 const draw=()=>{
  graph.replaceChildren();for(const [key,button] of buttons)button.setAttribute('aria-pressed',String(key===selected));
  const range=model.followers.ranges.find(range=>range.key===selected);
  if(!range){graph.append(el('p','This history range is not available.','cp-unavailable'));return;}
  const plot=followerPlot(model.followers.points,range),notice=el('p',`${dateLabel(range.start)} – ${dateLabel(lastIncludedDate(range.end))} · ${plot.observed} of ${plot.days} days recorded`,'cp-copy cp-copy-caption');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');graph.append(notice);
  if(!plot.observed){graph.append(el('p','No daily follower observations for this range. Monthly totals cannot be used as daily history.','cp-unavailable'));return;}
  const svg=svgNode('svg',{viewBox:'0 0 720 260',role:'img','aria-label':`${rangeLabels[selected]} follower history, ${plot.observed} of ${plot.days} days recorded. Full values follow in the data table.`});
  for(let i=0;i<3;i++){
   const y=32+i*88,value=plot.high-(plot.high-plot.low)*i/2;svg.append(svgNode('line',{x1:'64',x2:'684',y1:String(y),y2:String(y),class:'cp-ig-gridline'}));
   const label=svgNode('text',{x:'54',y:String(y+4),'text-anchor':'end',class:'cp-ig-axis'});label.textContent=metricValue(value);svg.append(label);
  }
  for(const segment of plot.segments){
   if(segment.length>1)svg.append(svgNode('polyline',{points:segment.map(point=>`${point.x},${point.y}`).join(' '),fill:'none',class:'cp-ig-series'}));
   for(const point of segment){const mark=svgNode('circle',{cx:String(point.x),cy:String(point.y),r:'3',class:'cp-ig-point'}),title=svgNode('title',{});title.textContent=`${point.date}: ${metricValue(point.value)} followers`;mark.append(title);svg.append(mark);}
  }
  for(const [x,date,anchor] of [['64',range.start,'start'],['684',lastIncludedDate(range.end),'end']]){const label=svgNode('text',{x,y:'242','text-anchor':anchor,class:'cp-ig-axis'});label.textContent=new Date(date+'T00:00:00Z').toLocaleDateString('en',{month:'short',day:'numeric',timeZone:'UTC'});svg.append(label);}graph.append(svg);
  const details=el('details',undefined,'cp-ig-data');details.append(el('summary','View daily values and missing dates'));
  const scroll=el('div',undefined,'cp-ig-data-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Daily follower readings. Scroll horizontally on small screens.');
  const table=el('table'),head=el('thead'),header=el('tr');table.append(el('caption',`Daily follower observations · ${range.start} to ${lastIncludedDate(range.end)}`));
  for(const text of ['Date','Followers','Quality / coverage','Source updated']){const cell=el('th',text);cell.scope='col';header.append(cell);}head.append(header);table.append(head);
  const body=el('tbody');for(const point of plot.daily){const row=el('tr');row.append(el('td',point.date),el('td',point.value===null?(point.reason==='invalid_value'?'Invalid source value':'Not recorded'):metricValue(point.value)),el('td',(point.quality??'Not specified')+(point.sourceQuality&&point.sourceQuality!==point.quality?` (source: ${point.sourceQuality})`:'')),el('td',point.asOf??'Not recorded'));body.append(row);}table.append(body);scroll.append(table);details.append(scroll);graph.append(details);
 };
 for(const key of ['7d','1m','90d','6m'] as const){const button=el('button',rangeLabels[key]);button.type='button';button.disabled=!model.followers.ranges.some(range=>range.key===key);button.addEventListener('click',()=>{if(!isCurrent()||button.disabled)return;selected=key;draw();});buttons.set(key,button);choices.append(button);}
 draw();history.append(choices,graph);inner.append(history);canvas.append(section);
}
