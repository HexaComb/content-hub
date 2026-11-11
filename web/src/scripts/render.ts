import { applyProjectTheme } from './theme.ts';
import type {Metric,Reading,Report} from './types';
const number=new Intl.NumberFormat('en',{maximumFractionDigits:2});
export const monthLabel=(m:string)=>new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en',{month:'long',year:'numeric',timeZone:'UTC'});
export const value=(r:Reading|null,u:string)=>r?.value==null?'Not available':`${number.format(r.value)}${u==='percent'?'%':u==='count'?'':` ${u}`}`;
const signed=(n:number)=>`${n>0?'+':''}${number.format(n)}`;
export function change(m:Metric) {if(m.delta===null)return 'No comparable data'; if(m.percentagePoints!==null)return `${signed(m.percentagePoints)} pp`; return `${signed(m.delta)}${m.unit==='count'?'':` ${m.unit}`}`;}
function el(tag:string,text?:string,cls?:string) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function relative(m:Metric) {return m.relativePercent===null ? m.reason==='zero_baseline'?'Relative change unavailable: zero baseline':'Complete readings needed for comparison':`${signed(m.relativePercent)}% relative to previous month`;}
function quality(r:Reading|null) {if(!r)return 'Missing';return `${r.quality}${r.provider?` · ${r.provider}`:''}${r.collectedAt?` · Collected ${new Date(r.collectedAt).toLocaleDateString('en',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'})}`:''}`;}
export function renderReport(report:Report) {
 applyProjectTheme(document.querySelector<HTMLElement>('#dashboard')??document.querySelector<HTMLElement>('#report'),report.appearance);
 const cards=document.querySelector('#metrics')!;const rows=document.querySelector('#metric-rows')!;const chart=document.querySelector('#comparison-chart')!;cards.replaceChildren();rows.replaceChildren();chart.replaceChildren();
 document.querySelector('#comparison-label')!.textContent=`${monthLabel(report.month)} vs ${monthLabel(report.previousMonth)}`;
 for(const m of report.metrics){
  const card=el('article',undefined,'metric-card');const top=el('div',undefined,'metric-top');top.append(el('h3',m.label),el('span',m.current?.quality==='complete'?'↗':'◷','metric-symbol'));card.append(top,el('p',value(m.current,m.unit),'metric-value'),el('p',`${value(m.previous,m.unit)} previous month`,'metric-baseline'));
  const delta=el('span',change(m),`delta ${['improved','declined','unchanged'].includes(m.change)?m.change:'neutral'}`);card.append(delta,el('p',relative(m),'metric-context'));if(m.current?.quality!=='complete')card.append(el('span',m.current?.quality==='partial'?'Partial period':'Missing reading','quality-warning'));cards.append(card);
  const row=el('tr');[m.label,value(m.current,m.unit),value(m.previous,m.unit),`${change(m)}; ${relative(m)}`].forEach(t=>row.append(el('td',t)));const source=el('td');source.append(el('div',`Selected: ${quality(m.current)}`),el('div',`Previous: ${quality(m.previous)}`));row.append(source);rows.append(row);
  const group=el('div',undefined,'bar-group');group.append(el('h3',m.label));const max=Math.max(Math.abs(m.current?.value??0),Math.abs(m.previous?.value??0),1);
  for(const [r,cls,label] of [[m.current,'current','Selected'],[m.previous,'previous','Previous']] as const){const line=el('div',undefined,'bar-line');const track=el('div',undefined,'bar-track');const bar=el('div',undefined,`bar ${cls}`);bar.style.width=`${r?.value==null?0:Math.abs(r.value)/max*100}%`;track.append(bar);line.append(track,el('span',`${value(r,m.unit)}${r?.quality==='partial'?'*':''}`));line.setAttribute('aria-label',`${m.label}, ${label} month: ${value(r,m.unit)}, ${r?.quality??'missing'}`);group.append(line);}chart.append(group);
 }
 if(!report.metrics.length){cards.append(el('div','No metrics have been shared for this target and month yet. Try another month.','notice'));chart.append(el('p','Nothing to compare yet.','muted'));}
}
