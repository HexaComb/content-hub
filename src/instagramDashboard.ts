import {authorize,PublicError,type Principal} from './auth.ts';
import {canonicalJson,sha256,monthRange,type Quality} from './domain.ts';
import {readProjectPlugins,selectPlugin} from './plugins.ts';
import {requireSuperAdmin} from './admin.ts';
import {portalReport} from './portal.ts';
import type {HumanIdentity} from './humanAuth.ts';
import {appOrigin,type InvitationEnv} from './mail.ts';
import {id} from './schemas.ts';
import {instagramKinds,instagramMetricKind,validInstagramMetricValue,instagramMetricLabels,instagramDashboardInput,instagramTargetInput,upsertInstagramItemInput,instagramDecisionInput,type InstagramItemInput,type InstagramDecisionInput,type InstagramMetricKind} from './instagramSchema.ts';
import type {z} from 'zod';

type Target={tenantId:string;clientId:string;projectId:string;name:string;clientName:string;timezone:string};
type Metric={id:string;key:string;unit:string;timezone:string};
type Observation={metric_id:string;period_start:string;period_end:string;value:number|null;quality:Quality;collected_at:string};
export type InstagramWorkItem={id:string;format:'reel'|'post'|null;title:string;idea:string|null;platform:'instagram';status:string;contentUrl:string|null;evidence:string|null;revision:number;createdAt:string;updatedAt:string;source:'idea'|'content'};
const dateShift=(date:string,days:number)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
function calendarShift(date:string,months:number){const [y,m,d]=date.split('-').map(Number),first=new Date(Date.UTC(y,m-1+months,1));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return `${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;}
export function instagramDateWindows(timezone:string,month?:string,now=new Date()){
 let today:string;try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);today=['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');}catch{throw new PublicError('The client timezone is invalid.');}
 const selected=month??today.slice(0,7);let range:ReturnType<typeof monthRange>;try{range=monthRange(selected);}catch{throw new PublicError('Use a valid reporting month.');}
 if(selected>today.slice(0,7))throw new PublicError('Future reporting months are not available.');
 const anchor=selected===today.slice(0,7)?today:dateShift(range.end,-1),end=dateShift(anchor,1);
 return {month:selected,today,asOfDate:anchor,monthStart:range.start,monthEnd:range.end,ranges:[{key:'7d' as const,start:dateShift(anchor,-6),end},{key:'1m' as const,start:dateShift(calendarShift(anchor,-1),1),end},{key:'90d' as const,start:dateShift(anchor,-89),end},{key:'6m' as const,start:dateShift(calendarShift(anchor,-6),1),end}]};
}
async function requireTarget(db:D1Database,tenantId:string,clientId:string,projectId:string):Promise<Target>{
 const row=await db.prepare('SELECT p.name,c.name AS clientName,c.timezone FROM projects p JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id WHERE p.tenant_id=? AND p.client_id=? AND p.id=?').bind(tenantId,clientId,projectId).first<{name:string;clientName:string;timezone:string}>();
 if(!row)throw new PublicError('Project is not available.');
 selectPlugin(await readProjectPlugins(db,tenantId,clientId,projectId),'instagram');
 return {tenantId,clientId,projectId,...row};
}
async function metricsPacket(db:D1Database,target:Target,month:string|undefined,granted?:Set<string>){
 const windows=instagramDateWindows(target.timezone,month);
 const plugin=selectPlugin(await readProjectPlugins(db,target.tenantId,target.clientId,target.projectId),'instagram');
 const definitions=(await db.prepare('SELECT m.id,m.key,m.unit,m.timezone FROM metrics m JOIN project_metrics pm ON pm.tenant_id=m.tenant_id AND pm.client_id=m.client_id AND pm.metric_id=m.id WHERE pm.tenant_id=? AND pm.client_id=? AND pm.project_id=? ORDER BY m.key LIMIT 201').bind(target.tenantId,target.clientId,target.projectId).all<Metric>()).results;
 if(definitions.length>200)throw new PublicError('Too many project metrics.');
 const eligible=definitions.filter(m=>plugin.metricIds.includes(m.id)&&(!granted||granted.has(m.id))&&instagramMetricKind(m.key)!==null);
 const selected=new Map<InstagramMetricKind,Metric>();
 for(const kind of instagramKinds){const found=eligible.filter(m=>instagramMetricKind(m.key)===kind);if(found.length===1&&found[0].timezone===target.timezone)selected.set(kind,found[0]);}
 const readings:Observation[]=[];
 for(const metric of selected.values()){
  const rows=(await db.prepare(`SELECT o.metric_id,o.period_start,o.period_end,o.value,o.quality,o.collected_at FROM observations o WHERE o.tenant_id=? AND o.client_id=? AND o.metric_id=? AND o.period_start>=? AND o.period_start<=? AND o.period_end<=? AND o.revision=(SELECT MAX(r.revision) FROM observations r WHERE r.tenant_id=o.tenant_id AND r.client_id=o.client_id AND r.metric_id=o.metric_id AND r.period_start=o.period_start AND r.period_end=o.period_end) ORDER BY o.period_start,o.period_end LIMIT 1001`).bind(target.tenantId,target.clientId,metric.id,windows.ranges[3].start,windows.asOfDate,windows.monthEnd).all<Observation>()).results;
  if(rows.length>1000)throw new PublicError('Too many observations for this dashboard.');readings.push(...rows);
 }
 const kpis=instagramKinds.map(kind=>{
  const metric=selected.get(kind),candidates=eligible.filter(m=>instagramMetricKind(m.key)===kind);
  const missingReason=candidates.length>1?'ambiguous_metric':candidates.length===1&&candidates[0].timezone!==target.timezone?'timezone_mismatch':'not_configured';
  const rows=metric?readings.filter(r=>r.metric_id===metric.id):[];
  // A latest daily follower snapshot is usable; monthly totals/averages must
  // explicitly describe this reporting month. Never sum or average snapshots.
  const daily=kind==='followers'?rows.filter(r=>r.period_start>=windows.monthStart&&r.period_end===dateShift(r.period_start,1)).sort((a,b)=>b.period_start.localeCompare(a.period_start))[0]:undefined;
  const monthly=rows.filter(r=>r.period_start===windows.monthStart&&(r.period_end===windows.monthEnd||(windows.month===windows.today.slice(0,7)&&r.period_end<=dateShift(windows.asOfDate,1)))).sort((a,b)=>b.collected_at.localeCompare(a.collected_at)||b.period_end.localeCompare(a.period_end))[0];
  const row=daily??monthly;
  const invalid=row?.value!==null&&row!==undefined&&!validInstagramMetricValue(kind,row.value);
  const quality=invalid?'missing':row?(windows.month===windows.today.slice(0,7)&&!daily&&row.quality==='complete'?'partial':row.quality):'missing';
  return {kind,metricId:metric?.id??null,key:metric?.key??null,label:instagramMetricLabels[kind],value:invalid?null:row?.value??null,unit:metric?.unit??null,quality,sourceQuality:row?.quality??null,asOf:row?.collected_at??null,periodStart:row?.period_start??null,periodEnd:row?.period_end??null,reason:metric?(invalid?'invalid_value':row?(row.value===null?'missing_value':null):'no_observation'):missingReason};
 });
 const follower=selected.get('followers');
 const points:{date:string;value:number|null;quality:Quality;sourceQuality:Quality|null;asOf:string|null;reason:string|null}[]=[];
 for(let date=windows.ranges[3].start;date<windows.ranges[3].end;date=dateShift(date,1)){
  const row=follower?readings.find(r=>r.metric_id===follower.id&&r.period_start===date&&r.period_end===dateShift(date,1)):undefined;
  const invalid=row?.value!==null&&row!==undefined&&!validInstagramMetricValue('followers',row.value);
  points.push({date,value:invalid?null:row?.value??null,quality:invalid?'missing':row?(date===windows.today&&row.quality==='complete'?'partial':row.quality):'missing',sourceQuality:row?.quality??null,asOf:row?.collected_at??null,reason:invalid?'invalid_value':row?(row.value===null?'missing_value':null):'no_observation'});
 }
 return {target,month:windows.month,asOfDate:windows.asOfDate,timezone:target.timezone,kpis,followers:{metricId:follower?.id??null,timezone:target.timezone,ranges:windows.ranges,points}};
}
const itemColumns='id,format,title,idea,platform,status,content_url AS contentUrl,evidence,revision,created_at AS createdAt,updated_at AS updatedAt';
async function workflowPacket(db:D1Database,target:Target){
 const bindings=[target.tenantId,target.clientId,target.projectId];
 const items=(await db.prepare(`SELECT ${itemColumns} FROM instagram_work_items WHERE tenant_id=? AND client_id=? AND project_id=? ORDER BY updated_at DESC,id LIMIT 201`).bind(...bindings).all<Omit<InstagramWorkItem,'source'>>()).results;
 const events=(await db.prepare(`SELECT item_id AS itemId,answer,revision,recorded_at AS recordedAt,result_json FROM instagram_work_events WHERE tenant_id=? AND client_id=? AND project_id=? AND operation='decision' ORDER BY recorded_at DESC,item_id LIMIT 201`).bind(...bindings).all<{itemId:string;answer:'yes'|'no';revision:number;recordedAt:string;result_json:string}>()).results;
 const content=(await db.prepare(`SELECT c.id,c.title,c.status,c.revision,c.created_at AS createdAt,c.updated_at AS updatedAt FROM content_items c WHERE c.tenant_id=? AND c.client_id=? AND c.channel='instagram' AND c.status IN ('draft','approved','scheduled','publishing','failed') AND (EXISTS(SELECT 1 FROM content_metrics cm JOIN project_metrics pm ON pm.tenant_id=cm.tenant_id AND pm.client_id=cm.client_id AND pm.metric_id=cm.metric_id WHERE cm.tenant_id=c.tenant_id AND cm.client_id=c.client_id AND cm.content_id=c.id AND pm.project_id=?) OR EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=c.tenant_id AND p.client_id=c.client_id AND p.id=? AND p.kind='instagram_account' AND p.platform_account_ref=c.account_ref)) ORDER BY c.updated_at DESC,c.id LIMIT 201`).bind(...bindings,target.projectId).all<{id:string;title:string;status:string;revision:number;createdAt:string;updatedAt:string}>()).results;
 const own=items.slice(0,200).map(i=>({...i,source:'idea' as const}));
 return {pending:[...own.filter(i=>['queued','in_progress'].includes(i.status)),...content.slice(0,200).map(i=>({...i,format:null,idea:null,platform:'instagram' as const,contentUrl:null,evidence:null,source:'content' as const}))],ideas:own.filter(i=>i.status==='proposed'),executed:own.filter(i=>i.status==='completed'),answers:events.slice(0,200).map(e=>{const snapshot=JSON.parse(e.result_json) as InstagramWorkItem;return {itemId:e.itemId,answer:e.answer,revision:e.revision,recordedAt:e.recordedAt,title:snapshot.title,idea:snapshot.idea,format:snapshot.format,platform:'instagram' as const};}),workflowAvailable:true,truncated:items.length>200||events.length>200||content.length>200};
}
const noWorkflow=()=>({pending:[],ideas:[],executed:[],answers:[],workflowAvailable:false,truncated:false});
export async function getInstagramDashboard(db:D1Database,p:Principal,raw:z.infer<typeof instagramDashboardInput>){
 const input=instagramDashboardInput.parse(raw);await authorize(db,p,input.clientId,'metrics:read');
 const target=await requireTarget(db,p.tenantId,input.clientId,input.projectId);
 return {...await metricsPacket(db,target,input.month),...noWorkflow()};
}
export async function getInstagramWorkflow(db:D1Database,p:Principal,raw:z.infer<typeof instagramTargetInput>){const input=instagramTargetInput.parse(raw);await authorize(db,p,input.clientId,'content:read');const target=await requireTarget(db,p.tenantId,input.clientId,input.projectId);return {target,...await workflowPacket(db,target)};}
export async function adminInstagramDashboard(db:D1Database,identity:HumanIdentity|null,env:InvitationEnv,tenant:string,client:string,project:string,month?:string){requireSuperAdmin(identity,env);[tenant,client,project].forEach(v=>id.parse(v));const target=await requireTarget(db,tenant,client,project);return {...await metricsPacket(db,target,month),...await workflowPacket(db,target)};}
export async function recipientInstagramDashboard(db:D1Database,identity:HumanIdentity,client:string,project:string,month?:string){
 [client,project].forEach(v=>id.parse(v));
 const targets=(await db.prepare(`SELECT DISTINCT p.tenant_id FROM invitations i JOIN projects p ON p.tenant_id=i.tenant_id AND p.client_id=i.client_id AND p.id=i.project_id WHERE i.accepted_at IS NOT NULL AND i.revoked_at IS NULL AND i.grant_expires_at>? AND p.status!='archived' AND i.accepted_identity_issuer=? AND i.accepted_identity_subject=? AND p.client_id=? AND p.id=? LIMIT 2`).bind(new Date().toISOString(),identity.issuer,identity.subject,client,project).all<{tenant_id:string}>()).results;
 if(targets.length!==1)throw new PublicError('Reporting target is not available.');
 const target=await requireTarget(db,targets[0].tenant_id,client,project),selected=instagramDateWindows(target.timezone,month).month;
 const report=await portalReport(db,identity,client,project,selected,'instagram');
 const packet=await metricsPacket(db,target,selected,new Set(report.metrics.map(m=>m.id)));
 // Recheck revocations after reads. No await follows this permission snapshot.
 const final=(await db.prepare(`SELECT DISTINCT p.tenant_id,CASE WHEN pp.enabled=1 AND EXISTS(SELECT 1 FROM json_each(pp.metric_ids_json) mapped WHERE mapped.value=pm.metric_id) THEN pm.metric_id ELSE NULL END AS metric_id FROM invitations i JOIN projects p ON p.tenant_id=i.tenant_id AND p.client_id=i.client_id AND p.id=i.project_id LEFT JOIN project_plugins pp ON pp.tenant_id=p.tenant_id AND pp.client_id=p.client_id AND pp.project_id=p.id AND pp.key='instagram' LEFT JOIN json_each(i.metric_ids_json) approved ON 1=1 LEFT JOIN project_metrics pm ON pm.tenant_id=p.tenant_id AND pm.client_id=p.client_id AND pm.project_id=p.id AND pm.metric_id=approved.value WHERE i.accepted_at IS NOT NULL AND i.revoked_at IS NULL AND i.grant_expires_at>? AND p.status!='archived' AND i.accepted_identity_issuer=? AND i.accepted_identity_subject=? AND p.client_id=? AND p.id=?`).bind(new Date().toISOString(),identity.issuer,identity.subject,client,project).all<{tenant_id:string;metric_id:string|null}>()).results;
 if(!final.length||final.some(r=>r.tenant_id!==target.tenantId))throw new PublicError('Reporting target is not available.');
 const ids=new Set(final.flatMap(r=>r.metric_id?[r.metric_id]:[]));
 const kpis=packet.kpis.map(k=>k.metricId&&!ids.has(k.metricId)?{...k,metricId:null,key:null,value:null,unit:null,quality:'missing',sourceQuality:null,asOf:null,periodStart:null,periodEnd:null,reason:'not_configured'}:k);
 const followers=packet.followers.metricId&&!ids.has(packet.followers.metricId)?{...packet.followers,metricId:null,points:packet.followers.points.map(p=>({...p,value:null,quality:'missing' as const,sourceQuality:null,asOf:null,reason:'not_configured'}))}:packet.followers;
 const {tenantId,...publicTarget}=target;return {...packet,target:publicTarget,kpis,followers,...noWorkflow()};
}
async function writeItem(db:D1Database,target:Target,actor:string,input:InstagramItemInput|InstagramDecisionInput,operation:'upsert'|'decision'){
 const hash=await sha256(canonicalJson({operation,input}));
 async function replay(){const receipt=await db.prepare('SELECT payload_hash,result_json FROM instagram_work_events WHERE tenant_id=? AND actor_id=? AND idempotency_key=?').bind(target.tenantId,actor,input.idempotencyKey).first<{payload_hash:string;result_json:string}>();if(!receipt)return null;if(receipt.payload_hash!==hash)throw new PublicError('Idempotency key was already used for another Instagram request.');return {...JSON.parse(receipt.result_json),replayed:true};}
 const prior=await replay();if(prior)return prior;
 const current=await db.prepare(`SELECT ${itemColumns} FROM instagram_work_items WHERE tenant_id=? AND client_id=? AND project_id=? AND id=?`).bind(target.tenantId,target.clientId,target.projectId,input.id).first<Omit<InstagramWorkItem,'source'>>();
 if((current?.revision??0)!==input.expectedRevision){const concurrent=await replay();if(concurrent)return concurrent;throw new PublicError('Instagram item revision changed. Read the current item and retry with a new idempotency key.');}
 const now=new Date().toISOString();let result:InstagramWorkItem;
 if(operation==='decision'){
  if(!current||current.status!=='proposed')throw new PublicError('Only an unanswered proposed idea can receive a decision.');
  result={...current,status:(input as InstagramDecisionInput).answer==='yes'?'queued':'declined',revision:current.revision+1,updatedAt:now,source:'idea'};
 }else{
  const item=input as InstagramItemInput;
  if(!current&&item.status!=='proposed')throw new PublicError('New ideas must start as proposed. Record a yes/no decision before production.');
  if(current){
   const transitions:Record<string,string[]>={proposed:['proposed'],queued:['queued','in_progress'],in_progress:['in_progress','completed'],completed:[],declined:[]};
   if(!transitions[current.status]?.includes(item.status))throw new PublicError('This status change requires a decision or is not allowed.');
   if(current.status!=='proposed'&&(item.title!==current.title||item.idea!==current.idea||item.format!==current.format))throw new PublicError('An answered idea cannot be silently rewritten. Create a new proposed idea.');
  }
  result={id:item.id,format:item.format,title:item.title,idea:item.idea,platform:'instagram',status:item.status,contentUrl:item.contentUrl,evidence:item.evidence,revision:item.expectedRevision+1,createdAt:current?.createdAt??now,updatedAt:now,source:'idea'};
 }
 const mutation=current?db.prepare('UPDATE instagram_work_items SET format=?,title=?,idea=?,status=?,content_url=?,evidence=?,revision=?,updated_at=?,updated_by=? WHERE tenant_id=? AND client_id=? AND project_id=? AND id=? AND revision=?').bind(result.format,result.title,result.idea,result.status,result.contentUrl,result.evidence,result.revision,now,actor,target.tenantId,target.clientId,target.projectId,result.id,input.expectedRevision):db.prepare('INSERT INTO instagram_work_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(target.tenantId,target.clientId,target.projectId,result.id,result.format,result.title,result.idea,'instagram',result.status,result.contentUrl,result.evidence,1,now,now,actor);
 const event=db.prepare('INSERT INTO instagram_work_events VALUES(?,?,?,?,?,?,?,?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?)').bind(target.tenantId,target.clientId,target.projectId,result.id,actor,input.idempotencyKey,operation,operation==='decision'?(input as InstagramDecisionInput).answer:null,result.revision,hash,JSON.stringify(result),now);
 try{await db.batch([mutation,event]);}catch(error){const previous=await replay();if(previous)return previous;if(/constraint|unique|NOT NULL/i.test(String(error)))throw new PublicError('Instagram item revision changed. Read the current item and retry with a new idempotency key.');throw error;}
 return {...result,replayed:false};
}
export async function upsertInstagramItem(db:D1Database,p:Principal,raw:InstagramItemInput){const input=upsertInstagramItemInput.parse(raw);await authorize(db,p,input.clientId,'content:write');const target=await requireTarget(db,p.tenantId,input.clientId,input.projectId);return writeItem(db,target,`mcp:${p.id}`,input,'upsert');}
export async function recordInstagramDecision(db:D1Database,p:Principal,raw:InstagramDecisionInput){const input=instagramDecisionInput.parse(raw);await authorize(db,p,input.clientId,'content:write');const target=await requireTarget(db,p.tenantId,input.clientId,input.projectId);return writeItem(db,target,`mcp:${p.id}`,input,'decision');}
const adminRoute=/^\/api\/admin\/targets\/([^/]+)\/([^/]+)\/([^/]+)\/plugins\/instagram\/(dashboard|ideas\/([^/]+)\/decision)$/;
export const isAdminInstagramPath=(path:string)=>adminRoute.test(path);
async function boundedJson(request:Request){const reader=request.body?.getReader();if(!reader)throw new PublicError('Request body required.');const chunks:Uint8Array[]=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16384){await reader.cancel();throw new PublicError('Request is too large.');}chunks.push(r.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export async function handleAdminInstagramRequest(request:Request,env:InvitationEnv,identity:HumanIdentity|null){
 requireSuperAdmin(identity,env);const url=new URL(request.url),match=url.pathname.match(adminRoute);if(!match)return Response.json({error:'Not found.'},{status:404});
 const [tenant,clientId,projectId]=match.slice(1,4).map(v=>id.parse(decodeURIComponent(v))),decision=match[5];
 if(request.method!==(decision?'POST':'GET'))return Response.json({error:'Method not allowed.'},{status:405});
 if(!decision)return Response.json(await adminInstagramDashboard(env.DB,identity,env,tenant,clientId,projectId,url.searchParams.get('month')??undefined));
 if(request.headers.get('Origin')!==appOrigin(env)||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return Response.json({error:'Request rejected.'},{status:403});
 const body=instagramDecisionInput.omit({clientId:true,projectId:true,id:true}).parse(await boundedJson(request));
 const target=await requireTarget(env.DB,tenant,clientId,projectId),actor=`browser:${await sha256(canonicalJson({issuer:identity!.issuer,subject:identity!.subject}))}`;
 const bucket=await sha256(`instagram-decision:${actor}:${Math.floor(Date.now()/600000)}`);
 const rate=await env.DB.prepare('INSERT INTO invitation_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket).first<{hits:number}>();
 if(!rate||rate.hits>30)return Response.json({error:'Too many decisions. Try again later.'},{status:429});
 return Response.json(await writeItem(env.DB,target,actor,{...body,clientId,projectId,id:id.parse(decodeURIComponent(decision))},'decision'));
}
