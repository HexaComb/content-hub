import { adminAccessEnabled, requireSuperAdmin, SUPER_ADMINS } from './admin.ts';
import { getHumanIdentity, clerkAuthConfigured, type HumanIdentity } from './humanAuth.ts';
import { authorize, PublicError, type Principal } from './auth.ts';
import { canonicalJson, sha256 } from './domain.ts';
import { appOrigin, invitationMail, type InvitationEnv, type MailTransport } from './mail.ts';
import { prepareInvitationInput, sendInvitationInput, type PrepareInvitationInput } from './invitationSchemas.ts';

const now = () => new Date().toISOString();
const expiry = (ms:number) => new Date(Date.now()+ms).toISOString();
export function randomToken() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
type Invite = {id:string;tenant_id:string;client_id:string;project_id:string;recipient_email:string;metric_ids_json:string;target_revision:number;preview_json:string;approval_digest:string;created_by:string;approved_by:string;invite_expires_at:string;grant_expires_at:string;delivery_state:string};
// Revalidate authoritative principal and exact target on issuance and acceptance.
const eligible = `i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.invite_expires_at > ? AND i.grant_expires_at > ?
 AND EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=i.tenant_id AND p.client_id=i.client_id AND p.id=i.project_id AND p.status!='archived' AND p.revision=i.target_revision)
 AND NOT EXISTS(SELECT 1 FROM json_each(i.metric_ids_json) m WHERE NOT EXISTS(SELECT 1 FROM project_metrics pm WHERE pm.tenant_id=i.tenant_id AND pm.client_id=i.client_id AND pm.project_id=i.project_id AND pm.metric_id=m.value))`;
const serviceAuthority = `EXISTS(SELECT 1 FROM principals a JOIN client_grants cg ON cg.tenant_id=a.tenant_id AND cg.principal_id=a.id WHERE a.tenant_id=i.tenant_id AND a.id=i.approved_by AND a.revoked_at IS NULL AND a.expires_at > ? AND cg.client_id=i.client_id AND EXISTS(SELECT 1 FROM json_each(a.scopes_json) WHERE value='invitations:send'))`;
// A browser admin is an inert audit actor, not an authenticated service or OAuth
// principal. Only server-verified identity can enter this branch. Every action
// checks the current admin allowlist/gate and its immutable issuer/subject binding.
export function invitations(db:D1Database, principal:Principal, env:InvitationEnv, fake?:MailTransport, adminIdentity?:HumanIdentity) {
 const authorizeActor = async (clientId:string,scope:string) => {
  if (!adminIdentity) return authorize(db,principal,clientId,scope);
  requireSuperAdmin(adminIdentity,env);
  const actor=await db.prepare(`SELECT 1 FROM admin_invitation_actors a JOIN principals p ON p.tenant_id=a.tenant_id AND p.id=a.principal_id WHERE a.tenant_id=? AND a.principal_id=? AND a.identity_issuer=? AND a.identity_subject=? AND a.verified_email=? AND p.revoked_at IS NULL AND p.expires_at>? AND substr(p.token_hash,1,6)='admin:' AND p.scopes_json='[]'`).bind(principal.tenantId,principal.id,adminIdentity.issuer,adminIdentity.subject,adminIdentity.email,new Date().toISOString()).first();
  if(!actor)throw new PublicError('Administrator invitation authority is unavailable.');
 };

 return {
 async prepareInvitation(raw:PrepareInvitationInput) {
  const input=prepareInvitationInput.parse(raw);
  await authorizeActor(input.clientId,'invitations:manage');
  if (!(Date.parse(input.grantExpiresAt)>Date.now()) || Date.parse(input.grantExpiresAt)>Date.now()+366*86400000) throw new PublicError('Access expiry must be within one year.');
  const target=await db.prepare('SELECT name,kind,platform_account_ref,revision,status FROM projects WHERE tenant_id=? AND client_id=? AND id=?').bind(principal.tenantId,input.clientId,input.projectId).first<{name:string;kind:string;platform_account_ref:string|null;revision:number;status:string}>();
  if (!target || target.status==='archived') throw new PublicError('Target unavailable.');
  const metricIds=[...new Set(input.metricIds)].sort();
  const linked=await db.prepare('SELECT metric_id FROM project_metrics WHERE tenant_id=? AND client_id=? AND project_id=?').bind(principal.tenantId,input.clientId,input.projectId).all<{metric_id:string}>();
  if (metricIds.some(id=>!linked.results.some(m=>m.metric_id===id))) throw new PublicError('Only explicitly mapped metrics may be approved.');
  const id=crypto.randomUUID(), inviteExpiresAt=expiry(48*3600000);
  const preview={recipient:input.recipient.trim().toLowerCase(),clientId:input.clientId,projectId:input.projectId,target:{name:target.name,kind:target.kind,platformAccountRef:target.platform_account_ref,revision:target.revision},metricIds,role:'metrics_viewer',grantExpiresAt:new Date(input.grantExpiresAt).toISOString(),inviteExpiresAt,subject:'Your private metrics invitation',email:'You have been invited to view private metrics. Open the secure invitation link, verify your email, and accept access.',disclosure:'Resend receives the recipient address and invitation link. Access includes reporting history and future observations for only these approved mapped metrics until expiry or revocation.'};
  const serialized=canonicalJson(preview), approvalDigest=await sha256(serialized);
  await db.prepare('INSERT INTO invitations(id,tenant_id,client_id,project_id,recipient_email,metric_ids_json,target_revision,preview_json,approval_digest,created_by,created_at,invite_expires_at,grant_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,principal.tenantId,input.clientId,input.projectId,preview.recipient,JSON.stringify(metricIds),target.revision,serialized,approvalDigest,principal.id,now(),inviteExpiresAt,preview.grantExpiresAt).run();
  return {invitationId:id,approvalDigest,preview};
 },
 async sendInvitation(input:{invitationId:string;approvalDigest:string;explicitlyApproved:true}) {
  sendInvitationInput.parse(input);
  const row=await db.prepare('SELECT * FROM invitations WHERE id=? AND tenant_id=?').bind(input.invitationId,principal.tenantId).first<Invite>();
  if(!row) throw new PublicError('Invitation unavailable.');
  await authorizeActor(row.client_id,'invitations:send');
  const transport=invitationMail(env,fake), origin=appOrigin(env);
  if(row.approval_digest!==input.approvalDigest) throw new PublicError('Approval does not match the prepared invitation.');
  const token=randomToken(), time=now();
  const changed=await db.prepare(`UPDATE invitations AS i SET delivery_state='sending',token_hash=?,approved_by=? WHERE i.id=? AND i.delivery_state='prepared' AND ${eligible}`).bind(await sha256(token),principal.id,row.id,time,time).run();
  if(!changed.meta.changes) throw new PublicError('Invitation is stale or has a send receipt. Do not retry uncertain sends; revoke and explicitly approve a replacement.');
  await db.prepare('INSERT INTO invitation_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),row.id,principal.id,'approved_send',time).run();
  try {
   const preview=JSON.parse(row.preview_json) as {subject:string;email:string};
   const sent=await transport.send({to:row.recipient_email,subject:preview.subject,text:`${preview.email}\n\n${origin}/invite#token=${token}`,idempotencyKey:`invitation-${row.id}`});
   await db.prepare("UPDATE invitations SET delivery_state='accepted',provider_id=? WHERE id=?").bind(sent.id,row.id).run();
   return {invitationId:row.id,deliveryState:'accepted',notice:'Provider acceptance is not delivery or access acceptance.'};
  } catch { await db.prepare("UPDATE invitations SET delivery_state='uncertain' WHERE id=?").bind(row.id).run(); return {invitationId:row.id,deliveryState:'uncertain',notice:'Do not resend. Revoke and explicitly approve a replacement.'}; }
 },
 async listInvitations(input:{clientId:string}) {
  await authorizeActor(input.clientId,'invitations:manage');
  return {invitations:(await db.prepare('SELECT id,project_id,recipient_email,metric_ids_json,invite_expires_at,grant_expires_at,delivery_state,accepted_at,revoked_at FROM invitations WHERE tenant_id=? AND client_id=? ORDER BY created_at DESC LIMIT 200').bind(principal.tenantId,input.clientId).all()).results};
 },
 async revokeInvitation(input:{clientId:string;invitationId:string}) {
  await authorizeActor(input.clientId,'invitations:manage');
  const result=await db.prepare('UPDATE invitations SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND tenant_id=? AND client_id=?').bind(now(),input.invitationId,principal.tenantId,input.clientId).run();
  if(result.meta.changes)await db.prepare('INSERT INTO invitation_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),input.invitationId,principal.id,'revoked',now()).run();
  return {revoked:Boolean(result.meta.changes)};
 }
 };
}
function json(body:unknown,status=200,setCookie?:string) { const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}; if(setCookie)headers['Set-Cookie']=setCookie; return new Response(JSON.stringify(body),{status,headers}); }
/** identity is trusted internal dependency injection, never caller JSON/headers. */
export async function handleInvitationRequest(request:Request,env:InvitationEnv,_mail?:MailTransport,identity?:HumanIdentity|null):Promise<Response> {
 const db=env.DB,path=new URL(request.url).pathname;
 if(path!=='/api/invitations/begin' && path!=='/api/invitations/accept')return json({error:'Not found.'},404);
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 let origin:string;try{origin=appOrigin(env);}catch{return json({error:'Authentication unavailable.'},503);}
 if(!clerkAuthConfigured(env))return json({error:'Authentication unavailable.'},503);
 if(request.headers.get('Origin')!==origin || request.headers.get('Sec-Fetch-Site')==='cross-site' || !request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Request rejected.'},403);
 if(Number(request.headers.get('Content-Length')??0)>4096)return json({error:'Request too large.'},413);
 const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
 if(reader){for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();return json({error:'Request too large.'},413);}chunks.push(part.value);}}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let input:Record<string,unknown>;try{input=JSON.parse(new TextDecoder().decode(bytes));if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}catch{return json({error:'Invalid request.'},400);}
 if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token)||Object.keys(input).some(k=>k!=='token'))return json({error:'Invitation unavailable.'},400);
 let actor:HumanIdentity|null;try{actor=identity===undefined?await getHumanIdentity(request,env):identity;}catch{return json({error:'Authentication unavailable.'},503);}
 if(!actor || actor.issuer!==env.CLERK_ISSUER)return json({error:'Sign in with a verified email to continue.'},401);
 const bucket=await sha256(`${request.headers.get('CF-Connecting-IP')??'unknown'}:${actor.issuer}:${actor.subject}:${Math.floor(Date.now()/600000)}`);
 const rate=await db.prepare('INSERT INTO invitation_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket).first<{hits:number}>();
 if(!rate||rate.hits>30)return json({error:'Please try again later.'},429);
 const tokenHash=await sha256(input.token),time=now();
 // Pending browser invitations remain valid only while their issuing admin is
 // eligible and enabled. Existing service invitations retain their original rules.
 const authority = `(${serviceAuthority} OR EXISTS(SELECT 1 FROM admin_invitation_actors a JOIN principals p ON p.tenant_id=a.tenant_id AND p.id=a.principal_id WHERE ?=1 AND a.tenant_id=i.tenant_id AND a.principal_id=i.approved_by AND a.identity_issuer=? AND a.verified_email IN (?,?) AND p.revoked_at IS NULL AND p.expires_at>? AND substr(p.token_hash,1,6)='admin:' AND p.scopes_json='[]'))`;
 const authorityBindings = [time,adminAccessEnabled(env)?1:0,env.CLERK_ISSUER??'',...SUPER_ADMINS,time];
 if(path==='/api/invitations/begin'){
  const row=await db.prepare(`SELECT i.* FROM invitations i WHERE token_hash=? AND recipient_email=? AND i.delivery_state IN ('accepted','uncertain') AND ${eligible} AND ${authority}`).bind(tokenHash,actor.email,time,time,...authorityBindings).first<Invite>();
  if(!row)return json({error:'Invitation unavailable.'},400);
  const preview=JSON.parse(row.preview_json) as {target:{name:string;kind:string;platformAccountRef:string|null}};
  return json({invitation:{target:{name:preview.target.name,kind:preview.target.kind,platformAccountRef:preview.target.platformAccountRef},metricIds:JSON.parse(row.metric_ids_json),role:'metrics_viewer',grantExpiresAt:row.grant_expires_at}});
 }
 const operation=crypto.randomUUID();
 // D1 executes this batch atomically. Only the conditional single-use winner
 // receives this operation ID and its issuer/subject-bound read-only grant.
 await db.batch([
  db.prepare(`UPDATE invitations AS i SET accepted_at=?,acceptance_id=?,accepted_identity_issuer=?,accepted_identity_subject=? WHERE token_hash=? AND recipient_email=? AND i.delivery_state IN ('accepted','uncertain') AND ${eligible} AND ${authority}`).bind(time,operation,actor.issuer,actor.subject,tokenHash,actor.email,time,time,...authorityBindings),
  db.prepare("INSERT INTO invitation_audit SELECT ?,id,?,'accepted',? FROM invitations WHERE acceptance_id=?").bind(crypto.randomUUID(),canonicalJson({issuer:actor.issuer,subject:actor.subject}),time,operation),
 ]);
 const accepted=await db.prepare('SELECT client_id,project_id FROM invitations WHERE acceptance_id=?').bind(operation).first<{client_id:string;project_id:string}>();
 if(!accepted)return json({error:'Invitation unavailable.'},400);
 return json({accepted:true,role:'metrics_viewer',projectPath:`/project?client=${encodeURIComponent(accepted.client_id)}&project=${encodeURIComponent(accepted.project_id)}`});
}
