import { z } from 'zod';
import { PublicError, type Principal } from './auth.ts';
import { requireSuperAdmin } from './admin.ts';
import { canonicalJson, sha256 } from './domain.ts';
import type { HumanIdentity } from './humanAuth.ts';
import { invitations } from './invitations.ts';
import { prepareInvitationInput, sendInvitationInput } from './invitationSchemas.ts';
import { appOrigin, type InvitationEnv, type MailTransport } from './mail.ts';
import { id } from './schemas.ts';

const route = /^\/api\/admin\/targets\/([^/]+)\/([^/]+)\/([^/]+)\/invitations(?:\/(prepare|send|revoke))?$/;
export const isAdminInvitationPath = (path:string) => route.test(path);
const prepareInput = prepareInvitationInput.omit({clientId:true,projectId:true});
const revokeInput = z.object({invitationId:id}).strict();
type Target = {name:string;clientName:string;kind:string;status:string};

export function invitationReadiness(env:InvitationEnv) {
 if(env.INVITATIONS_ENABLED!=='true')return {enabled:false,reason:'Email invitations are disabled. Verify the sending domain and enable delivery before sending.'};
 if(!env.RESEND_API_KEY||!env.RESEND_FROM)return {enabled:false,reason:'The email sender is not configured. No invitation will be sent.'};
 try{appOrigin(env);}catch{return {enabled:false,reason:'The secure invitation address is not configured.'};}
 return {enabled:true,reason:'Email delivery is enabled. Review the recipient, project, metrics and expiry before sending.'};
}

async function target(db:D1Database,tenantId:string,clientId:string,projectId:string):Promise<Target> {
 const row=await db.prepare('SELECT p.name,p.kind,p.status,c.name AS clientName FROM projects p JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id WHERE p.tenant_id=? AND p.client_id=? AND p.id=?').bind(tenantId,clientId,projectId).first<Target>();
 if(!row)throw new PublicError('Project is not available.');
 return row;
}

/** Inert audit attribution only: no secret, MCP scope, OAuth grant or client grant
 * is generated. The non-hex admin: marker can never match a bearer token hash. */
async function auditActor(db:D1Database,identity:HumanIdentity,env:InvitationEnv,tenantId:string):Promise<Principal> {
 requireSuperAdmin(identity,env);
 const digest=await sha256(canonicalJson({tenantId,issuer:identity.issuer,subject:identity.subject}));
 const principalId=`admin-${digest.slice(0,48)}`;
 await db.batch([
  db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json,auth_kind) VALUES(?,?,? ,?,'9999-12-31T23:59:59.999Z','[]','service') ON CONFLICT(tenant_id,id) DO NOTHING").bind(tenantId,principalId,'Browser administrator audit actor',`admin:${digest.slice(0,58)}`),
  db.prepare('INSERT INTO admin_invitation_actors(tenant_id,principal_id,identity_issuer,identity_subject,verified_email) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,principal_id) DO NOTHING').bind(tenantId,principalId,identity.issuer,identity.subject,identity.email),
 ]);
 return {tenantId,id:principalId,scopes:[]};
}

async function readJson(request:Request):Promise<unknown> {
 if(Number(request.headers.get('Content-Length')??0)>16384)throw new PublicError('Request is too large.');
 const reader=request.body?.getReader();if(!reader)throw new PublicError('Request body is required.');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();throw new PublicError('Request is too large.');}chunks.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}

/** Only call with the current getHumanIdentity result; never caller JSON roles. */
export async function handleAdminInvitationRequest(request:Request,env:InvitationEnv,identity:HumanIdentity|null,fake?:MailTransport):Promise<Response> {
 requireSuperAdmin(identity,env);
 const match=new URL(request.url).pathname.match(route);
 if(!match)return Response.json({error:'Not found.'},{status:404});
 const [tenantId,clientId,projectId]=match.slice(1,4).map(value=>id.parse(decodeURIComponent(value)));
 const action=match[4];
 if(request.method!==(action?'POST':'GET'))return Response.json({error:'Method not allowed.'},{status:405});
 if(action&&(request.headers.get('Origin')!==appOrigin(env)||request.headers.get('Sec-Fetch-Site')==='cross-site'||!request.headers.get('Content-Type')?.startsWith('application/json')))return Response.json({error:'Request rejected.'},{status:403});
 const project=await target(env.DB,tenantId,clientId,projectId);
 if(!action){
  const metrics=(await env.DB.prepare('SELECT m.id,m.label,m.unit FROM project_metrics pm JOIN metrics m ON m.tenant_id=pm.tenant_id AND m.client_id=pm.client_id AND m.id=pm.metric_id WHERE pm.tenant_id=? AND pm.client_id=? AND pm.project_id=? ORDER BY m.key LIMIT 201').bind(tenantId,clientId,projectId).all()).results;
  if(metrics.length>200)throw new PublicError('Too many metrics for one invitation.');
  const rows=(await env.DB.prepare('SELECT id,recipient_email,metric_ids_json,invite_expires_at,grant_expires_at,delivery_state,accepted_at,revoked_at FROM invitations WHERE tenant_id=? AND client_id=? AND project_id=? ORDER BY created_at DESC LIMIT 200').bind(tenantId,clientId,projectId).all()).results;
  return Response.json({target:{...project,tenantId,clientId,projectId},metrics,invitations:rows,readiness:invitationReadiness(env)});
 }
 const body=await readJson(request);
 const input=action==='prepare'?prepareInput.parse(body):action==='send'?sendInvitationInput.parse(body):revokeInput.parse(body);
 if(action!=='revoke'&&project.status==='archived')throw new PublicError('Archived projects cannot receive invitations.');
 // A valid session, exact same-origin action and bounded body precede rate state.
 const bucket=await sha256(`admin-invitation:${identity!.issuer}:${identity!.subject}:${Math.floor(Date.now()/600000)}`);
 const rate=await env.DB.prepare('INSERT INTO invitation_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket).first<{hits:number}>();
 if(!rate||rate.hits>30)return Response.json({error:'Too many invitation changes. Try again later.'},{status:429});
 if(action==='send'&&!fake&&!invitationReadiness(env).enabled)return Response.json({error:invitationReadiness(env).reason},{status:409});
 if(action==='send'||action==='revoke'){
  // Never allow an ID from another client or project to borrow this route's scope.
  const invitationId=(input as {invitationId:string}).invitationId;
  if(!await env.DB.prepare('SELECT 1 FROM invitations WHERE id=? AND tenant_id=? AND client_id=? AND project_id=?').bind(invitationId,tenantId,clientId,projectId).first())throw new PublicError('Invitation is not available for this project.');
 }
 const principal=await auditActor(env.DB,identity!,env,tenantId);
 const repo=invitations(env.DB,principal,env,fake,identity!);
 if(action==='prepare')return Response.json(await repo.prepareInvitation({...prepareInput.parse(input),clientId,projectId}));
 if(action==='send')return Response.json(await repo.sendInvitation(sendInvitationInput.parse(input)));
 return Response.json(await repo.revokeInvitation({clientId,...revokeInput.parse(input)}));
}
