import { applyProjectTheme } from './theme.ts';
import {appendMetricReading} from './metric-reading.ts';
import {metricInsight,monthLabel,readingQuality,value} from './metric-copy.ts';
import type {Report} from './types';
export {change,monthLabel,value} from './metric-copy.ts';
function el(tag:string,text?:string,cls?:string) {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
export function renderReport(report:Report) {
 applyProjectTheme(document.querySelector<HTMLElement>('#dashboard')??document.querySelector<HTMLElement>('#report'),report.appearance);
 const cards=document.querySelector('#metrics')!,rows=document.querySelector('#metric-rows')!;cards.replaceChildren();rows.replaceChildren();
 document.querySelector('#comparison-label')!.textContent=`${monthLabel(report.month)} · Compared with ${monthLabel(report.previousMonth)}`;
 for(const [id,month] of [['current-period-heading',report.month],['previous-period-heading',report.previousMonth]]){const heading=document.getElementById(id);if(heading)heading.textContent=monthLabel(month);}
 for(const metric of report.metrics){
  const card=el('article',undefined,'metric-card');appendMetricReading(card,metric,report);cards.append(card);
  const row=el('tr'),name=el('th',metric.label);name.setAttribute('scope','row');row.append(name);
  [value(metric.current,metric.unit),value(metric.previous,metric.unit),metricInsight(metric,report.previousMonth).headline].forEach(text=>row.append(el('td',text)));
  const source=el('td');source.append(el('div',`${monthLabel(report.month)}: ${readingQuality(metric.current)}`),el('div',`${monthLabel(report.previousMonth)}: ${readingQuality(metric.previous)}`));row.append(source);rows.append(row);
 }
 if(!report.metrics.length)cards.append(el('div','No metrics have been shared for this target and month yet. Try another month.','notice'));
}
