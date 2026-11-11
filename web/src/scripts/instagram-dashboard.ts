import {api,post,message} from './api';
import {createModal} from './modal';
import {followerPlot,lastIncludedDate,metricReason,rangeLabels,kpiLabels,metricValue,safeContentUrl,type FollowerPoint,type FollowerRange} from './instagram-view-state';
export type InstagramKpi={kind:keyof typeof kpiLabels;value:number|null;quality:string;sourceQuality?:string|null;asOf:string|null;periodStart:string|null;periodEnd:string|null;reason:string|null};
type ContentItem={id:string;title:string;format:'reel'|'post'|null;status:string;idea:string|null;platform:string;revision:number;contentUrl:string|null};
type Idea=ContentItem;
type ExecutedIdea=ContentItem;
type Answer={itemId:string;idea:string|null;title:string;answer:'yes'|'no';recordedAt:string};
export type InstagramDashboardData={month:string;asOfDate:string;timezone:string;kpis:InstagramKpi[];followers:{ranges:FollowerRange[];points:FollowerPoint[]};pending:ContentItem[];ideas:Idea[];executed:ExecutedIdea[];answers:Answer[];workflowAvailable:boolean;truncated?:boolean};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const button=(label:string,action:()=>void)=>{const node=el('button',label,'admin-button');node.type='button';node.onclick=action;return node;};
const svgNode=<K extends keyof SVGElementTagNameMap>(name:K,attrs:Record<string,string>)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;};
function empty(text:string){return el('p',text,'ig-empty');}
function section(title:string,description?:string){const node=el('section',undefined,'ig-panel');node.append(el('h2',title));if(description)node.append(el('p',description,'ig-help'));return node;}
/** Mount only after verifying project access and that the Instagram plugin is enabled. */
export function mountInstagramDashboard(context:{root:HTMLElement;apiPrefix:string;month:string;admin:boolean;isCurrent:()=>boolean}){
 const {root,apiPrefix}=context;let month=context.month,disposed=false,sequence=0,controller:AbortController|undefined,data:InstagramDashboardData|undefined;
 let rangeKey:FollowerRange['key']='7d',dialog:ReturnType<typeof createModal>|undefined,decisionBusy=false;const uncertainIdeas=new Set<string>();
 const current=()=>!disposed&&context.isCurrent();
 root.classList.add('instagram-dashboard');
 function notice(text:string){const node=el('p',text,'ig-help');node.setAttribute('role','status');node.setAttribute('aria-live','polite');return node;}
 function clear(){sequence++;controller?.abort();dialog?.dispose();dialog=undefined;data=undefined;root.replaceChildren();root.hidden=true;root.removeAttribute('aria-busy');}
 async function load(signal?:AbortSignal){
  if(!current())return;controller?.abort();controller=new AbortController();const active=controller;const abort=()=>active.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const request=++sequence;
  root.hidden=false;root.setAttribute('aria-busy','true');root.replaceChildren(notice('Loading Instagram dashboard…'));
  try{const result=await api<InstagramDashboardData>(apiPrefix+'/instagram/dashboard?month='+encodeURIComponent(month),{signal:active.signal});if(!current()||request!==sequence)return;data=result;uncertainIdeas.clear();render();}
  catch(error){if(!current()||request!==sequence||active.signal.aborted)return;data=undefined;root.replaceChildren(notice(message(error)),button('Reload dashboard',()=>void load()));}
  finally{signal?.removeEventListener('abort',abort);if(current()&&request===sequence)root.removeAttribute('aria-busy');}
 }
 function chart(model:InstagramDashboardData){
  const panel=section('Followers over time','Daily recorded follower counts. Missing dates stay empty; no estimates or interpolated values.');
  const choices=el('div',undefined,'ig-ranges');choices.setAttribute('role','group');choices.setAttribute('aria-label','Follower history range');
  const graph=el('div',undefined,'ig-graph');const update=(key:FollowerRange['key'])=>{rangeKey=key;for(const node of choices.querySelectorAll('button'))node.setAttribute('aria-pressed',String(node.dataset.range===key));draw();};
  for(const key of ['7d','1m','90d','6m'] as const){const choice=button(rangeLabels[key],()=>update(key));choice.dataset.range=key;choice.setAttribute('aria-pressed',String(rangeKey===key));choice.disabled=!model.followers.ranges.some(range=>range.key===key);choices.append(choice);}
  function draw(){
   graph.replaceChildren();const range=model.followers.ranges.find(range=>range.key===rangeKey);if(!range){graph.append(empty('This history range is not available.'));return;}
   const plot=followerPlot(model.followers.points,range);graph.append(notice(`${range.start} – ${lastIncludedDate(range.end)} · ${model.timezone} · ${plot.observed} of ${plot.days} days recorded`));
   if(!plot.observed){graph.append(empty('No daily follower observations for this range. Monthly totals cannot be used as daily history.'));return;}
   const svg=svgNode('svg',{viewBox:'0 0 720 260',role:'img','aria-label':`${rangeLabels[rangeKey]} follower history, ${plot.observed} of ${plot.days} days recorded. Full values follow in the data table.`});
   for(let i=0;i<3;i++){const y=32+i*88,value=plot.high-(plot.high-plot.low)*i/2;svg.append(svgNode('line',{x1:'64',x2:'684',y1:String(y),y2:String(y),class:'ig-gridline'}));const label=svgNode('text',{x:'54',y:String(y+4),'text-anchor':'end',class:'ig-axis'});label.textContent=metricValue(value);svg.append(label);}
   for(const segment of plot.segments){if(segment.length>1)svg.append(svgNode('polyline',{points:segment.map(point=>`${point.x},${point.y}`).join(' '),fill:'none',class:'ig-series'}));for(const point of segment){const mark=svgNode('circle',{cx:String(point.x),cy:String(point.y),r:'3',class:'ig-point'});const title=svgNode('title',{});title.textContent=`${point.date}: ${metricValue(point.value)} followers`;mark.append(title);svg.append(mark);}}
   for(const [x,date,anchor] of [['64',range.start,'start'],['684',lastIncludedDate(range.end),'end']]){const label=svgNode('text',{x,y:'242','text-anchor':anchor,class:'ig-axis'});label.textContent=date;svg.append(label);}graph.append(svg);
   const details=el('details',undefined,'ig-data');details.append(el('summary','View daily values and missing dates'));const table=el('table');const head=el('thead'),header=el('tr');for(const text of ['Date','Followers','Quality / coverage','Source updated']){const cell=el('th',text);cell.scope='col';header.append(cell);}head.append(header);table.append(head);const body=el('tbody');for(const point of plot.daily){const row=el('tr');row.append(el('td',point.date),el('td',point.value===null?(point.reason==='invalid_value'?'Invalid source value':'Not recorded'):metricValue(point.value)),el('td',(point.quality??'Not specified')+(point.sourceQuality&&point.sourceQuality!==point.quality?` (source: ${point.sourceQuality})`:'')),el('td',point.asOf??'Not recorded'));body.append(row);}table.append(body);details.append(table);graph.append(details);
  }
  draw();panel.append(choices,graph);return panel;
 }
 function decide(idea:Idea,answer:'yes'|'no',trigger:HTMLElement){
  if(!current()||!context.admin||!data?.workflowAvailable||decisionBusy||uncertainIdeas.has(idea.id))return;
  dialog?.dispose();let alive=true;const modal=createModal({title:answer==='yes'?'Queue this content idea?':'Decline this content idea?',trigger,onClose:()=>{alive=false;if(current()&&uncertainIdeas.has(idea.id))render();}});dialog=modal;
  modal.content.append(el('h3',idea.title),el('p',idea.idea??'No idea description recorded.'),el('p',answer==='yes'?'Yes records your answer and queues content creation. It does not publish or schedule anything.':'No records your answer and declines this idea. It does not delete existing content.'));
  const status=notice(''),actions=el('div',undefined,'ig-actions');const cancel=button('Cancel',()=>modal.close());const confirm=button(answer==='yes'?'Yes, queue creation':'No, decline idea',async()=>{
   if(decisionBusy||!alive||!current())return;decisionBusy=true;confirm.disabled=true;cancel.disabled=true;modal.setDismissible(false);status.textContent='Saving your answer…';
   try{await post(apiPrefix+'/instagram/ideas/'+encodeURIComponent(idea.id)+'/decision',{answer,expectedRevision:idea.revision,idempotencyKey:crypto.randomUUID()});if(!alive||!current())return;modal.setDismissible(true);modal.close();await load();}
   catch(error){if(!alive||!current())return;uncertainIdeas.add(idea.id);modal.setDismissible(true);status.textContent=`${message(error)} The result may be uncertain. Check the saved answers before taking another action.`;actions.replaceChildren(button('Check saved answers',async()=>{if(decisionBusy)return;decisionBusy=true;status.textContent='Checking saved answers…';modal.close();await load();decisionBusy=false;}),button('Close',()=>modal.close()));}
   finally{decisionBusy=false;}
  });actions.append(confirm,cancel);modal.content.append(status,actions);modal.open();
 }
 function render(){
  if(!current()||!data)return;const model=data;root.replaceChildren();
  root.append(el('p',`Reporting month ${model.month} · Through ${model.asOfDate} · ${model.timezone}`,'ig-context'));
  const cards=el('div',undefined,'ig-kpis');
  for(const [kind,label] of Object.entries(kpiLabels)){const kpi=model.kpis.find(item=>item.kind===kind),card=el('article',undefined,'ig-kpi');card.append(el('h2',label),el('p',metricValue(kpi?.value),'ig-value'));card.append(el('p',metricReason(kpi?.reason)??(kpi?.value==null?'No recorded value.':`${kpi.quality} · ${kpi.periodStart??model.month} – ${kpi.periodEnd?lastIncludedDate(kpi.periodEnd):model.asOfDate}`),'ig-help'));if(kpi?.asOf)card.append(el('p',`Source updated ${kpi.asOf}`,'ig-help'));cards.append(card);}root.append(cards,chart(model));
  if(!context.admin||!model.workflowAvailable){root.append(section('Content planning','Your access includes shared metrics only. Pending content, ideas and answer history have not been shared with you.'));return;}
  if(model.truncated)root.append(notice('Showing the most recent available content records. Older records may not appear in these lists.'));
  const pending=section('Pending reels & posts','Stored work in progress. A schedule here does not publish content.');
  if(!model.pending.length)pending.append(empty('No reels or posts are in progress for this project.'));
  const pendingList=el('div',undefined,'ig-items');for(const item of model.pending){const card=el('article',undefined,'ig-item');card.append(el('h3',item.title),el('span',`${item.format??'Format not specified'} · ${item.status}`,'ig-badge'));pendingList.append(card);}pending.append(pendingList);root.append(pending);
  const ideas=section('Upcoming content ideas','Choose Yes to queue creation or No to decline. Neither action publishes content.');
  if(uncertainIdeas.size)ideas.append(notice('An answer could not be confirmed. Reload to check saved answers before making another decision on that idea.'),button('Check saved answers',()=>void load()));
  if(!model.ideas.length)ideas.append(empty('No proposed ideas yet. Ideas added to this project will appear here.'));
  const ideaList=el('div',undefined,'ig-items');for(const idea of model.ideas){const card=el('article',undefined,'ig-item');card.append(el('h3',idea.title),el('p',idea.idea??'No idea description recorded.'),el('p',idea.platform,'ig-help'));const actions=el('div',undefined,'ig-actions');for(const answer of ['yes','no'] as const){const action=button(answer==='yes'?'Yes':'No',()=>decide(idea,answer,action));action.disabled=uncertainIdeas.has(idea.id);action.setAttribute('aria-label',`${answer==='yes'?'Yes, queue':'No, decline'}: ${idea.title}`);actions.append(action);}card.append(actions);ideaList.append(card);}ideas.append(ideaList);root.append(ideas);
  const executed=section('Executed content ideas','Completed ideas and links to their actual content.');
  if(!model.executed.length)executed.append(empty('No executed ideas are recorded for this project.'));
  const records=el('div',undefined,'ig-items');for(const item of model.executed){const card=el('article',undefined,'ig-item');card.append(el('h3',item.title),el('p',item.idea??'No linked idea recorded.'),el('p',item.platform,'ig-help'));const url=safeContentUrl(item.contentUrl);if(url){const link=el('a','View content ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',`View content: ${item.title} (opens in new tab)`);card.append(link);}else card.append(el('p','Content link not recorded.','ig-help'));records.append(card);}executed.append(records);root.append(executed);
  const history=section('Answer history','Recorded Yes / No decisions on content ideas.');
  if(!model.answers.length)history.append(empty('No answers have been recorded yet.'));
  const list=el('ol',undefined,'ig-history');for(const answer of model.answers){const row=el('li');row.append(el('strong',answer.answer==='yes'?'Yes · Create content':answer.answer==='no'?'No · Declined':'Recorded answer'),el('p',answer.title??answer.idea??'Content idea'),el('p',answer.recordedAt,'ig-help'));list.append(row);}history.append(list);root.append(history);
 }
 return {load,clear,updateMonth(value:string,signal?:AbortSignal){month=value;dialog?.dispose();return load(signal);},dispose(){clear();disposed=true;}};
}
