/** Rendering-only helpers. Metric definitions and reporting windows come from the API. */
export type FollowerPoint={date:string;value:number|null;quality?:string;sourceQuality?:string|null;reason?:string|null;asOf?:string|null};
export type FollowerRange={key:'7d'|'1m'|'90d'|'6m';start:string;end:string};
export const rangeLabels={'7d':'Last 7 days','1m':'Last month','90d':'Last 90 days','6m':'Last 6 months'};
export const kpiLabels={followers:'Followers',posts:'Posts since beginning of month',average_likes_per_post:'Average likes per post',posts_per_week:'Posts per week (avg)'};
const day=86400000;
export function followerPlot(points:FollowerPoint[],range:FollowerRange){
 const start=Date.parse(range.start+'T00:00:00Z'),end=Date.parse(range.end+'T00:00:00Z');
 const days=Math.max(1,Math.round((end-start)/day)),byDate=new Map(points.map(point=>[point.date,point]));
 const daily=Array.from({length:days},(_,i)=>{const date=new Date(start+i*day).toISOString().slice(0,10);const point=byDate.get(date);return {date,value:point&&point.value!==null&&Number.isFinite(point.value)?point.value:null,quality:point?.quality??'missing',sourceQuality:point?.sourceQuality??null,reason:point?.reason??null,asOf:point?.asOf??null};});
 const values=daily.flatMap(point=>point.value===null?[]:[point.value]);
 const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1,padding=Math.max(1,(max-min)*.12);
 const low=Math.max(0,min-padding),high=Math.max(low+1,max+padding);
 const segments:{date:string;value:number;x:number;y:number}[][]=[];let segment:typeof segments[number]=[];
 for(const [i,point] of daily.entries()){
  if(point.value===null){if(segment.length)segments.push(segment);segment=[];continue;}
  segment.push({date:point.date,value:point.value,x:64+(days===1?.5:i/(days-1))*620,y:208-(point.value-low)/(high-low)*176});
 }
 if(segment.length)segments.push(segment);
 return {daily,segments,low,high,observed:values.length,days};
}
export function safeContentUrl(value:string|null|undefined){if(!value)return null;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function metricValue(value:number|null|undefined){return value===null||value===undefined||!Number.isFinite(value)?'Not available':new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(value);}

export function lastIncludedDate(end:string){return new Date(Date.parse(end+'T00:00:00Z')-day).toISOString().slice(0,10);}
export function metricReason(reason:string|null|undefined){return ({missing_value:'The source recorded this value as missing.',invalid_value:'The recorded value is not valid for this metric.',not_configured:'No matching metric is configured.',ambiguous_metric:'Multiple matching metrics need to be resolved in settings.',timezone_mismatch:'Metric and project timezones do not match.',no_observation:'No value is recorded for this period.'} as Record<string,string>)[reason??'']??(reason?'No usable value is available.':null);}
