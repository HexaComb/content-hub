import {comparisonContext,metricInsight,monthLabel,readingQuality,value} from './metric-copy.ts';
import type {Metric,Report} from './types';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};

/** One reading hierarchy shared by workspace reports and authored client reports. */
export function appendMetricReading(parent:HTMLElement,metric:Metric,report:Report){
 const root=el('div',undefined,'metric-reading'),insight=metricInsight(metric,report.previousMonth);
 const heading=el('div',undefined,'mr-heading');
 heading.append(el('h3',metric.label,'mr-title'),el('span',insight.status,`mr-status mr-${insight.tone}`));root.append(heading);
 const description=({period_total:'Total recorded for the month.',period_average:'Average recorded for the month.',snapshot:'Snapshot reported for this month.'} as Record<string,string>)[metric.semantics??''];
 if(description)root.append(el('p',description,'mr-definition'));
 const pair=el('dl',undefined,'mr-pair');
 for(const [reading,month,kind] of [[metric.current,report.month,'current'],[metric.previous,report.previousMonth,'previous']] as const){
  const cell=el('div',undefined,`mr-${kind}`);cell.append(el('dt',monthLabel(month),'mr-period'),el('dd',value(reading,metric.unit),`mr-value${reading?.value==null?' mr-missing':''}`));
  if(reading?.quality==='partial'&&reading.value!==null)cell.append(el('span','Partial period','mr-quality'));
  pair.append(cell);
 }
 root.append(pair);
 const takeaway=el('div',undefined,'mr-takeaway');takeaway.append(el('p',insight.headline,'mr-change'),el('p',insight.explanation,'mr-guidance'));root.append(takeaway);
 const details=el('details',undefined,'mr-details');details.append(el('summary','How to read this metric'));
 const body=el('div',undefined,'mr-details-body');
 if(metric.delta!==null)body.append(el('p',comparisonContext(metric)));
 const semantics=({period_total:'Total for the reporting period.',period_average:'Average for the reporting period.',snapshot:'A single reported snapshot; daily snapshots are not added together.',custom:'A custom measure reported by your team.'} as Record<string,string>)[metric.semantics??''];
 if(semantics)body.append(el('p',semantics));
 if(metric.timezone)body.append(el('p',`Reporting timezone: ${metric.timezone}.`));
 body.append(el('p',`${monthLabel(report.month)}: ${readingQuality(metric.current)}`),el('p',`${monthLabel(report.previousMonth)}: ${readingQuality(metric.previous)}`));
 details.append(body);root.append(details);parent.append(root);
}
