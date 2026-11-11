import { z } from 'zod';
import { authorize, PublicError, type Principal } from './auth.ts';
import { requireSuperAdmin } from './admin.ts';
import { canonicalJson, sha256 } from './domain.ts';
import { id } from './schemas.ts';
import { readProjectTheme } from './themes.ts';
import { readProjectPlugins } from './plugins.ts';
import { adminReport } from './adminReports.ts';
import type { HumanIdentity } from './humanAuth.ts';
import { appOrigin, type InvitationEnv } from './mail.ts';
import { presentationDocumentSchema, presentationTargetInput, getPresentationInput, validatePresentationInput, savePresentationInput, selectPresentationInput, presentationMetricIds, defaultPresentation, filterPresentation, type PresentationDocument, type PresentationView } from './presentationSchema.ts';

type Target=z.infer<typeof presentationTargetInput>;
type RevisionRow={revision:number;operation:'save'|'publish'|'restore';source_revision:number|null;document_json:string;created_at:string};
const columns='revision,operation,source_revision,document_json,created_at';
async function requireTarget(db:D1Database,tenant:string,input:Target,write=false){
 const row=await db.prepare('SELECT status FROM projects WHERE tenant_id=? AND client_id=? AND id=?').bind(tenant,input.clientId,input.projectId).first<{status:string}>();
 if(!row||write&&row.status==='archived')throw new PublicError('Project is not available for this action.');
}
async function requirePrincipal(db:D1Database,p:Principal,input:Target,scope:string){await authorize(db,p,input.clientId,scope);await requireTarget(db,p.tenantId,input);}
function parseStored(raw:string):PresentationDocument|null{try{const value=presentationDocumentSchema.safeParse(JSON.parse(raw));return value.success?value.data:null;}catch{return null;}}
async function revision(db:D1Database,tenant:string,input:Target,value:number){return db.prepare(`SELECT ${columns} FROM presentation_revisions WHERE tenant_id=? AND client_id=? AND project_id=? AND revision=?`).bind(tenant,input.clientId,input.projectId,value).first<RevisionRow>();}
export async function readPresentationState(db:D1Database,tenant:string,input:Target){
 const head=await db.prepare('SELECT revision,draft_revision,published_revision FROM project_presentations WHERE tenant_id=? AND client_id=? AND project_id=?').bind(tenant,input.clientId,input.projectId).first<{revision:number;draft_revision:number;published_revision:number|null}>();
 if(!head)return {revision:0,draftRevision:null,publishedRevision:null,draft:null,published:null,isDraftPublished:false,history:[]};
 const rows=(await db.prepare(`SELECT ${columns} FROM presentation_revisions WHERE tenant_id=? AND client_id=? AND project_id=? AND (revision=? OR revision=?)`).bind(tenant,input.clientId,input.projectId,head.draft_revision,head.published_revision).all<RevisionRow>()).results;
 const draftRow=rows.find(r=>r.revision===head.draft_revision),publishedRow=rows.find(r=>r.revision===head.published_revision);
 const history=(await db.prepare('SELECT revision,operation,source_revision AS sourceRevision,created_at AS createdAt FROM presentation_revisions WHERE tenant_id=? AND client_id=? AND project_id=? ORDER BY revision DESC LIMIT 50').bind(tenant,input.clientId,input.projectId).all()).results;
 return {revision:head.revision,draftRevision:head.draft_revision,publishedRevision:head.published_revision,draft:draftRow?parseStored(draftRow.document_json):null,published:publishedRow?parseStored(publishedRow.document_json):null,isDraftPublished:!!draftRow&&!!publishedRow&&draftRow.document_json===publishedRow.document_json,history};
}
/** Internal: caller must authorize exact target first and recheck recipient grants after all awaits. */
export async function readPublishedPresentation(db:D1Database,tenant:string,input:Target):Promise<PresentationView>{
 const row=await db.prepare(`SELECT r.revision,r.document_json FROM project_presentations p JOIN presentation_revisions r ON r.tenant_id=p.tenant_id AND r.client_id=p.client_id AND r.project_id=p.project_id AND r.revision=p.published_revision WHERE p.tenant_id=? AND p.client_id=? AND p.project_id=? AND r.operation='publish'`).bind(tenant,input.clientId,input.projectId).first<{revision:number;document_json:string}>();
 const document=row?parseStored(row.document_json):null;
 return {revision:document?row!.revision:0,document,mode:document?'published':'default'};
}
async function validateReferences(db:D1Database,tenant:string,input:Target,document:PresentationDocument){
 const rows=(await db.prepare('SELECT metric_id FROM project_metrics WHERE tenant_id=? AND client_id=? AND project_id=? LIMIT 201').bind(tenant,input.clientId,input.projectId).all<{metric_id:string}>()).results;
 if(rows.length>200)throw new PublicError('This project exceeds the supported report size.');
 const allowed=new Set(rows.map(r=>r.metric_id));
 if(presentationMetricIds(document).some(id=>!allowed.has(id)))throw new PublicError('A presentation metric is not available in this project.');
}
export async function getProjectPresentation(db:D1Database,p:Principal,raw:z.infer<typeof getPresentationInput>){
 const input=getPresentationInput.parse(raw);await requirePrincipal(db,p,input,'presentations:read');
 const state=await readPresentationState(db,p.tenantId,input);
 const selected=input.revision===undefined?null:await revision(db,p.tenantId,input,input.revision);
 if(input.revision!==undefined&&!selected)throw new PublicError('Presentation revision is not available.');
 const theme=await readProjectTheme(db,p.tenantId,input.clientId,input.projectId);
 const query=new URLSearchParams({tenant:p.tenantId,client:input.clientId,project:input.projectId});
 const enabledPages=(await readProjectPlugins(db,p.tenantId,input.clientId,input.projectId)).filter(plugin=>plugin.enabled).map(plugin=>plugin.key);
 const pagePaths=Object.fromEntries(enabledPages.map(plugin=>[plugin,{clientPath:`/client?${new URLSearchParams({client:input.clientId,project:input.projectId,plugin})}`,previewPath:state.draftRevision?`/client?${query}&plugin=${plugin}&preview=${state.draftRevision}`:null}]));
 return {...input,...state,pagePaths,sharedDesign:true,selected:selected?parseStored(selected.document_json):null,starter:defaultPresentation(theme.theme??undefined),schema:z.toJSONSchema(presentationDocumentSchema,{io:'input'}),previewPath:state.draftRevision?`/client?${query}&preview=${state.draftRevision}`:null,clientPath:`/client?${new URLSearchParams({client:input.clientId,project:input.projectId})}`,capabilities:{sharedPages:'SEO and Instagram client pages use this one project design and revision. Saving remains private; publication updates both pages together. Optional node.page markers select page-specific copy/blocks, never a separate theme.',execution:'Trusted layout/report components only. No scripts, HTML, CSS, URLs or network requests.',media:'Images and logos are not supported. Use text branding; theme.brand.logo must be null.',privacy:'Preview requires verified browser administrator access. URLs grant no access. Recipients see only published designs and their existing report permissions.',limits:'80 nodes, six levels, 48 KiB document, at most 400 report blocks. History lists the latest 50 revisions; exact older revisions remain retrievable.',publishing:'Draft edits and restore do not change the client page. Publish explicitly after private preview. To roll back, restore a historical revision then publish the new draft.',reportDataChanged:false}};
}
export async function validateProjectPresentation(db:D1Database,p:Principal,raw:z.infer<typeof validatePresentationInput>){const input=validatePresentationInput.parse(raw);await requirePrincipal(db,p,input,'presentations:read');await validateReferences(db,p.tenantId,input,input.document);return {...input,valid:true,persisted:false,reportDataChanged:false};}

type Save=z.infer<typeof savePresentationInput>;type Select=z.infer<typeof selectPresentationInput>;
async function writePresentation(db:D1Database,tenant:string,actor:string,input:Save|Select,operation:'save'|'publish'|'restore'){
 await requireTarget(db,tenant,input,true);
 const hash=await sha256(canonicalJson({operation,input}));
 async function replay(){const row=await db.prepare('SELECT payload_hash,result_json FROM presentation_events WHERE tenant_id=? AND actor_id=? AND idempotency_key=?').bind(tenant,actor,input.idempotencyKey).first<{payload_hash:string;result_json:string}>();if(!row)return null;if(row.payload_hash!==hash)throw new PublicError('Idempotency key was used for a different presentation action.');return {...JSON.parse(row.result_json),replayed:true};}
 const prior=await replay();if(prior)return prior;
 const sourceRevision=operation==='save'?null:(input as Select).sourceRevision;
 const source=sourceRevision===null?null:await revision(db,tenant,input,sourceRevision);
 const document=operation==='save'?(input as Save).document:source?parseStored(source.document_json):null;
 if(!document)throw new PublicError('Presentation revision is not available.');
 await validateReferences(db,tenant,input,document);
 const now=new Date().toISOString(),next=input.expectedRevision+1,documentJson=JSON.stringify(document);
 const result={clientId:input.clientId,projectId:input.projectId,revision:next,operation,sourceRevision,createdAt:now,reportDataChanged:false};
 const snapshot=db.prepare('INSERT INTO presentation_revisions(tenant_id,client_id,project_id,revision,operation,source_revision,document_json,created_at,actor_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(tenant,input.clientId,input.projectId,next,operation,sourceRevision,documentJson,now,actor);
 // The publish precondition is part of the atomic head mutation, not just an earlier read.
 const head=input.expectedRevision===0&&operation==='save'
  ? db.prepare('INSERT INTO project_presentations(tenant_id,client_id,project_id,revision,draft_revision,published_revision) VALUES(?,?,?,?,?,NULL)').bind(tenant,input.clientId,input.projectId,next,next)
  : operation==='publish'
   ? db.prepare('UPDATE project_presentations SET revision=?,published_revision=? WHERE tenant_id=? AND client_id=? AND project_id=? AND revision=? AND draft_revision=?').bind(next,next,tenant,input.clientId,input.projectId,input.expectedRevision,sourceRevision)
   : db.prepare('UPDATE project_presentations SET revision=?,draft_revision=? WHERE tenant_id=? AND client_id=? AND project_id=? AND revision=?').bind(next,next,tenant,input.clientId,input.projectId,input.expectedRevision);
 const receipt=db.prepare('INSERT INTO presentation_events VALUES(?,?,?,?,?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?)').bind(tenant,actor,input.idempotencyKey,input.clientId,input.projectId,next,hash,JSON.stringify(result),now);
 try{await db.batch([snapshot,head,receipt]);}catch(error){const retry=await replay();if(retry)return retry;if(/constraint|unique|foreign key|NOT NULL/i.test(String(error)))throw new PublicError('Presentation changed or publication did not match the current draft. Read the latest state and retry with a new idempotency key.');throw error;}
 return {...result,replayed:false};
}
export async function saveProjectPresentationDraft(db:D1Database,p:Principal,raw:Save){const input=savePresentationInput.parse(raw);await requirePrincipal(db,p,input,'presentations:write');return writePresentation(db,p.tenantId,`mcp:${p.id}`,input,'save');}
export async function publishProjectPresentation(db:D1Database,p:Principal,raw:Select){const input=selectPresentationInput.parse(raw);await requirePrincipal(db,p,input,'presentations:publish');return writePresentation(db,p.tenantId,`mcp:${p.id}`,input,'publish');}
export async function restoreProjectPresentation(db:D1Database,p:Principal,raw:Select){const input=selectPresentationInput.parse(raw);await requirePrincipal(db,p,input,'presentations:write');return writePresentation(db,p.tenantId,`mcp:${p.id}`,input,'restore');}

const route=/^\/api\/admin\/targets\/([^/]+)\/([^/]+)\/([^/]+)\/(presentation-state|presentation)(?:\/(publish|restore))?$/;
export const isAdminPresentationPath=(path:string)=>route.test(path);
async function readJson(request:Request){const reader=request.body?.getReader();if(!reader)throw new PublicError('Request body is required.');const chunks:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw new PublicError('Request is too large.');}chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export async function handleAdminPresentationRequest(request:Request,env:InvitationEnv,identity:HumanIdentity|null){
 requireSuperAdmin(identity,env);const url=new URL(request.url),match=url.pathname.match(route)!;
 const [tenant,clientId,projectId]=match.slice(1,4).map(v=>id.parse(decodeURIComponent(v))),input={clientId,projectId},action=match[5];
 if((action&&match[4]!=='presentation')||request.method!==(action?'POST':'GET'))return Response.json({error:'Method not allowed.'},{status:405});
 if(action&&(request.headers.get('Origin')!==appOrigin(env)||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json'))return Response.json({error:'Request rejected.'},{status:403});
 await requireTarget(env.DB,tenant,input);
 if(action){
  const body=selectPresentationInput.omit({clientId:true,projectId:true}).parse(await readJson(request));
  const actor=`browser:${await sha256(canonicalJson({issuer:identity!.issuer,subject:identity!.subject}))}`;
  const bucket=await sha256(`presentation:${actor}:${Math.floor(Date.now()/600000)}`);
  const rate=await env.DB.prepare('INSERT INTO invitation_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket).first<{hits:number}>();
  if(!rate||rate.hits>30)return Response.json({error:'Too many presentation changes. Try again later.'},{status:429});
  try{return Response.json(await writePresentation(env.DB,tenant,actor,{...body,...input},action as 'publish'|'restore'));}
  catch(error){if(error instanceof PublicError)return Response.json({error:error.message},{status:409});throw error;}
 }
 if(match[4]==='presentation-state')return Response.json(await readPresentationState(env.DB,tenant,input));
 if([...url.searchParams.keys()].some(key=>!['month','revision','plugin'].includes(key))||['month','revision','plugin'].some(key=>url.searchParams.getAll(key).length>1))throw new PublicError('Unexpected presentation parameters.');
 const plugin=url.searchParams.has('plugin')?z.enum(['seo','instagram']).parse(url.searchParams.get('plugin')):undefined;
 const revisionParam=url.searchParams.get('revision');
 if(url.searchParams.getAll('revision').length>1||revisionParam!==null&&!/^[1-9]\d{0,15}$/.test(revisionParam))throw new PublicError('Invalid presentation revision.');
 let presentation:PresentationView;
 if(revisionParam!==null){const requested=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1).parse(Number(revisionParam));const row=await revision(env.DB,tenant,input,requested);const document=row?parseStored(row.document_json):null;if(!document)throw new PublicError('Presentation revision is not available.');presentation={revision:requested,document,mode:'preview'};}
 else presentation=await readPublishedPresentation(env.DB,tenant,input);
 const report=await adminReport(env.DB,identity,env,tenant,clientId,projectId,url.searchParams.get('month')??new Date().toISOString().slice(0,7),plugin);
 const pages=(await readProjectPlugins(env.DB,tenant,clientId,projectId)).filter(p=>p.enabled).map(p=>p.key);
 if(plugin&&!pages.includes(plugin))throw new PublicError('This project plugin is not enabled.');
 return Response.json({...report,presentation:{...presentation,plugin:plugin??null,pages,document:presentation.document?filterPresentation(presentation.document,new Set(report.metrics.map(m=>m.id)),plugin):null}});
}
