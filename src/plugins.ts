import { z } from 'zod';
import { id } from './schemas.ts';
import { authorize, PublicError, type Principal } from './auth.ts';
import { canonicalJson, sha256 } from './domain.ts';
import { requireSuperAdmin } from './admin.ts';
import type { HumanIdentity } from './humanAuth.ts';
import { appOrigin, type InvitationEnv } from './mail.ts';

export const pluginKey = z.enum(['seo','instagram']);
export const pluginTargetInput = z.object({clientId:id,projectId:id}).strict();
export const setPluginInput = pluginTargetInput.extend({key:pluginKey,enabled:z.boolean(),metricIds:z.array(id).max(200).refine(v=>new Set(v).size===v.length,'Duplicate metrics are not allowed.'),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),idempotencyKey:z.string().min(8).max(100)}).strict();
export type Plugin = {key:'seo'|'instagram';enabled:boolean;revision:number;metricIds:string[];updatedAt:string};
async function target(db:D1Database,tenant:string,client:string,project:string){
 if(!await db.prepare('SELECT 1 FROM projects WHERE tenant_id=? AND client_id=? AND id=?').bind(tenant,client,project).first())throw new PublicError('Project is not available.');
}
/** Internal reads require an already authorized exact target. Stale mappings never expand a report. */
export async function readProjectPlugins(db:D1Database,tenant:string,client:string,project:string):Promise<Plugin[]> {
 const rows=(await db.prepare('SELECT key,enabled,revision,metric_ids_json,updated_at FROM project_plugins WHERE tenant_id=? AND client_id=? AND project_id=? ORDER BY key').bind(tenant,client,project).all<{key:'seo'|'instagram';enabled:number;revision:number;metric_ids_json:string;updated_at:string}>()).results;
 return rows.map(r=>({key:r.key,enabled:!!r.enabled,revision:r.revision,metricIds:JSON.parse(r.metric_ids_json),updatedAt:r.updated_at}));
}
export function selectPlugin(plugins:Plugin[],key:string):Plugin {
 const parsed=pluginKey.safeParse(key);if(!parsed.success)throw new PublicError('Unknown project plugin.');
 const plugin=plugins.find(p=>p.key===parsed.data&&p.enabled);if(!plugin)throw new PublicError('This project plugin is not enabled.');return plugin;
}
export async function getProjectPlugins(db:D1Database,p:Principal,raw:z.infer<typeof pluginTargetInput>){
 const input=pluginTargetInput.parse(raw);await authorize(db,p,input.clientId,'projects:read');await target(db,p.tenantId,input.clientId,input.projectId);
 return {plugins:await readProjectPlugins(db,p.tenantId,input.clientId,input.projectId)};
}
async function writePlugin(db:D1Database,tenant:string,actor:string,input:z.infer<typeof setPluginInput>){
 await target(db,tenant,input.clientId,input.projectId);
 const hash=await sha256(canonicalJson(input));
 async function replay(){const row=await db.prepare('SELECT payload_hash,result_json FROM plugin_events WHERE tenant_id=? AND actor_id=? AND idempotency_key=?').bind(tenant,actor,input.idempotencyKey).first<{payload_hash:string;result_json:string}>();if(!row)return null;if(row.payload_hash!==hash)throw new PublicError('Idempotency key was already used for a different plugin request.');return {...JSON.parse(row.result_json),replayed:true};}
 const old=await replay();if(old)return old;
 const mappings=(await db.prepare('SELECT metric_id FROM project_metrics WHERE tenant_id=? AND client_id=? AND project_id=?').bind(tenant,input.clientId,input.projectId).all<{metric_id:string}>()).results;
 if(input.metricIds.some(id=>!mappings.some(m=>m.metric_id===id)))throw new PublicError('Plugin metrics must belong to this project.');
 const now=new Date().toISOString(),revision=input.expectedRevision+1;
 const result:Plugin={key:input.key,enabled:input.enabled,revision,metricIds:input.metricIds,updatedAt:now};
 const mutation=input.expectedRevision===0?db.prepare('INSERT INTO project_plugins VALUES(?,?,?,?,?,1,?,?,?)').bind(tenant,input.clientId,input.projectId,input.key,Number(input.enabled),JSON.stringify(input.metricIds),now,actor):db.prepare('UPDATE project_plugins SET enabled=?,revision=revision+1,metric_ids_json=?,updated_at=?,updated_by=? WHERE tenant_id=? AND client_id=? AND project_id=? AND key=? AND revision=?').bind(Number(input.enabled),JSON.stringify(input.metricIds),now,actor,tenant,input.clientId,input.projectId,input.key,input.expectedRevision);
 const receipt=db.prepare('INSERT INTO plugin_events VALUES(?,?,?,?,?,?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?)').bind(tenant,actor,input.idempotencyKey,input.clientId,input.projectId,input.key,revision,hash,JSON.stringify(result),now);
 try{await db.batch([mutation,receipt]);}catch(error){const previous=await replay();if(previous)return previous;if(/constraint|unique|NOT NULL/i.test(String(error)))throw new PublicError('Plugin write rejected. Read the current revision and retry with a new idempotency key.');throw error;}
 return {...result,replayed:false};
}
export async function setProjectPlugin(db:D1Database,p:Principal,raw:z.infer<typeof setPluginInput>){const input=setPluginInput.parse(raw);await authorize(db,p,input.clientId,'projects:write');return writePlugin(db,p.tenantId,`mcp:${p.id}`,input);}
const route=/^\/api\/admin\/targets\/([^/]+)\/([^/]+)\/([^/]+)\/plugins(?:\/(instagram)\/content)?$/;
export const isAdminPluginPath=(path:string)=>route.test(path);
async function readJson(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new PublicError('Request body is required.');let size=0;const chunks:Uint8Array[]=[];
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32768){await reader.cancel();throw new PublicError('Request is too large.');}chunks.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleAdminPluginRequest(request:Request,env:InvitationEnv,identity:HumanIdentity|null){
 requireSuperAdmin(identity,env);const url=new URL(request.url),match=url.pathname.match(route)!;
 const [tenant,clientId,projectId]=match.slice(1,4).map(v=>id.parse(decodeURIComponent(v)));
 if(!['GET','POST'].includes(request.method)||(match[4]&&request.method!=='GET'))return Response.json({error:'Method not allowed.'},{status:405});
 if(request.method==='POST'&&(request.headers.get('Origin')!==appOrigin(env)||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json'))return Response.json({error:'Request rejected.'},{status:403});
 await target(env.DB,tenant,clientId,projectId);
 if(request.method==='GET'){
  const plugins=await readProjectPlugins(env.DB,tenant,clientId,projectId);
  if(!match[4])return Response.json({plugins});
  selectPlugin(plugins,'instagram');const cursor=url.searchParams.get('cursor')??'';if(cursor)id.parse(cursor);
  const rows=(await env.DB.prepare(`SELECT c.id,c.title,c.status,c.scheduled_at AS scheduledAt,c.published_at AS publishedAt FROM content_items c WHERE c.tenant_id=? AND c.client_id=? AND c.channel='instagram' AND c.id>? AND (EXISTS(SELECT 1 FROM content_metrics cm JOIN project_metrics pm ON pm.tenant_id=cm.tenant_id AND pm.client_id=cm.client_id AND pm.metric_id=cm.metric_id WHERE cm.tenant_id=c.tenant_id AND cm.client_id=c.client_id AND cm.content_id=c.id AND pm.project_id=?) OR EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=c.tenant_id AND p.client_id=c.client_id AND p.id=? AND p.kind='instagram_account' AND p.platform_account_ref=c.account_ref)) ORDER BY c.id LIMIT 51`).bind(tenant,clientId,cursor,projectId,projectId).all<{id:string;title:string;status:string;scheduledAt:string|null;publishedAt:string|null}>()).results;
  return Response.json({items:rows.slice(0,50).map(r=>({...r,kind:null})),nextCursor:rows.length>50?rows[49].id:null});
 }
 const input=setPluginInput.omit({clientId:true,projectId:true}).parse(await readJson(request));
 const actor=`browser:${await sha256(canonicalJson({issuer:identity!.issuer,subject:identity!.subject}))}`;
 const bucket=await sha256(`plugin:${actor}:${Math.floor(Date.now()/600000)}`);
 const rate=await env.DB.prepare('INSERT INTO invitation_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket).first<{hits:number}>();
 if(!rate||rate.hits>30)return Response.json({error:'Too many plugin changes. Try again later.'},{status:429});
 return Response.json(await writePlugin(env.DB,tenant,actor,{...input,clientId,projectId}));
}
