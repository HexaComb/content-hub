import type {Metric,Reading} from './types';

const number=new Intl.NumberFormat('en',{maximumFractionDigits:2});
// Preserve very small nonzero readings instead of displaying them as zero.
export const formatNumber=(n:number)=>n!==0&&Math.abs(n)<.01?new Intl.NumberFormat('en',{maximumSignificantDigits:2}).format(n):number.format(n);
export const monthLabel=(month:string)=>new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en',{month:'long',year:'numeric',timeZone:'UTC'});
export const dateLabel=(date:string)=>new Date(date.length===10?`${date}T00:00:00Z`:date).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
export const value=(reading:Reading|null,unit:string)=>reading?.value==null?'Not available':`${formatNumber(reading.value)}${unit==='percent'?'%':unit==='count'?'':` ${unit}`}`;
const signed=(n:number)=>`${n>0?'+':''}${formatNumber(n)}`;
/** Compact formatter retained for existing consumers; cards use full wording. */
export function change(metric:Metric){
 if(metric.delta===null)return 'No comparable data';
 if(metric.percentagePoints!==null)return `${signed(metric.percentagePoints)} pp`;
 return `${signed(metric.delta)}${metric.unit==='count'?'':` ${metric.unit}`}`;
}
export function readingQuality(reading:Reading|null):string {
 if(!reading||reading.value===null)return 'Missing reading';
 const label=reading.quality==='complete'?'Complete period':reading.quality==='partial'?'Partial period':'Missing reading';
 return `${label}${reading.provider?` · Source: ${reading.provider}`:''}${reading.collectedAt?` · Collected ${dateLabel(reading.collectedAt)} (UTC)`:''}`;
}
export function comparisonContext(metric:Metric):string {
 if(metric.relativePercent!==null)return `${signed(metric.relativePercent)}% relative to the previous value${(metric.previous?.value??0)<0?' (using its absolute size)':''}.`;
 if(metric.reason==='relative_change_out_of_range'||metric.reason==='numeric_change_out_of_range')return 'Percentage change is outside the supported numeric range.';
 if(metric.reason==='zero_baseline')return 'The previous value was 0, so a percentage change cannot be calculated.';
 return 'Both periods need complete readings before a change can be shown.';
}
/** Wording only: comparison eligibility, deltas and improvement come from the server. */
export function metricInsight(metric:Metric,previousMonth:string){
 const previous=monthLabel(previousMonth);
 if(metric.delta===null||metric.change==='not_comparable'){
  const missing=metric.current?.value==null?'There is no reading for this month.':metric.previous?.value==null?`There is no reading for ${previous}.`:metric.current?.quality!=='complete'||metric.previous?.quality!=='complete'?'One or both periods are incomplete.':'The change is outside the supported numeric range.';
  return {status:'Not comparable',tone:'neutral',headline:'Comparison unavailable',explanation:missing};
 }
 const status=({improved:'Improved',declined:'Declined',unchanged:'No change',changed:'Changed'} as Record<string,string>)[metric.change]??'Changed';
 const tone=metric.change==='improved'?'positive':metric.change==='declined'?'negative':'neutral';
 const direction=metric.direction==='lower'?'Lower is better for this metric.':metric.direction==='higher'?'Higher is better for this metric.':'An increase or decrease is not rated as better or worse.';
 if(metric.delta===0)return {status,tone,headline:`Unchanged from ${previous}`,explanation:direction};
 const amount=formatNumber(Math.abs(metric.percentagePoints??metric.delta));
 const unit=metric.percentagePoints!==null?` percentage point${Math.abs(metric.percentagePoints)===1?'':'s'}`:metric.unit==='count'?'':metric.unit==='position'?` position${Math.abs(metric.delta)===1?'':'s'}`:` ${metric.unit}`;
 return {status,tone,headline:`${metric.delta>0?'Up':'Down'} ${amount}${unit} from ${previous}`,explanation:direction};
}
