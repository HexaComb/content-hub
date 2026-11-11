import {dateLabel} from './metric-copy.ts';
import {lastIncludedDate,kpiLabels,metricReason,metricValue} from './instagram-view-state.ts';
import type {InstagramKpi} from './instagram-dashboard';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const descriptions={followers:'The latest recorded size of your audience.',posts:'Posts published since the start of the selected month.',average_likes_per_post:'Average likes received per post in the recorded period.',posts_per_week:'Average publishing frequency in the recorded period.'};
export function kpiPeriod(kpi:InstagramKpi|undefined){
 if(!kpi?.periodStart||!kpi.periodEnd)return 'No reporting period recorded';
 const end=lastIncludedDate(kpi.periodEnd);
 return kpi.periodStart===end?`Recorded for ${dateLabel(end)}`:`${dateLabel(kpi.periodStart)} – ${dateLabel(end)}`;
}
/** Shared, metrics-only view. It never computes an average or a growth rate. */
export function appendInstagramKpi(parent:HTMLElement,kind:keyof typeof kpiLabels,kpi:InstagramKpi|undefined){
 const root=el('div',undefined,'metric-reading ig-reading'),heading=el('div',undefined,'mr-heading');
 heading.append(el('h3',kpiLabels[kind],'mr-title'));if(kpi?.quality==='partial'&&kpi.value!==null)heading.append(el('span','Partial period','mr-status'));
 root.append(heading,el('p',descriptions[kind],'mr-definition'),el('p',metricValue(kpi?.value),`mr-value ig-reading-value${kpi?.value==null?' mr-missing':''}`));
 const reason=metricReason(kpi?.reason);
 root.append(el('p',kpiPeriod(kpi),'mr-period'));
 if(reason||kpi?.value==null)root.append(el('p',reason??'No recorded value.','mr-guidance'));
 else if(kpi.quality==='partial')root.append(el('p','This period is still incomplete.','mr-guidance'));
 const details=el('details',undefined,'mr-details');details.append(el('summary','View recording details'));
 const body=el('div',undefined,'mr-details-body');
 body.append(el('p','This is a recorded value, not a comparison with the previous month.'));
 if(kind==='followers')body.append(el('p','Uses the latest daily snapshot in the selected month, or the recorded monthly snapshot when daily data is unavailable.'));
 if(kpi?.asOf)body.append(el('p',`Source updated ${dateLabel(kpi.asOf)} (UTC)`));
 if(kpi?.sourceQuality&&kpi.sourceQuality!==kpi.quality)body.append(el('p',`Source marked this ${kpi.sourceQuality}; the reporting period is ${kpi.quality}.`));
 details.append(body);root.append(details);parent.append(root);
}
