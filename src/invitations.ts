import { adminAccessEnabled, isSuperAdminEmail } from './admin.ts';
import { authorize, PublicError, type Principal } from './auth.ts';
import { canonicalJson, sha256 } from './domain.ts';
import { appOrigin, invitationMail, type InvitationEnv, type MailTransport } from './mail.ts';
import { prepareInvitationInput, sendInvitationInput, type PrepareInvitationInput } from './invitationSchemas.ts';

const now = () => new Date().toISOString();
const expiry = (ms:number) => new Date(Date.now()+ms).toISOString();
export function randomToken() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
const cookie = (name:string,value:string,maxAge:number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const readCookie = (r:Request,name:string) => { const values=r.headers.get('Cookie')?.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'=')) ?? []; return values.length===1 ? values[0].slice(name.length+1) : ''; };
type Invite = {id:string;tenant_id:string;client_id:string;project_id:string;recipient_email:string;metric_ids_json:string;target_revision:number;preview_json:string;approval_digest:string;created_by:string;approved_by:string;invite_expires_at:string;grant_expires_at:string;delivery_state:string};
// Revalidate authoritative principal and exact target on issuance and acceptance.
const eligible = `i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.invite_expires_at > ? AND i.grant_expires_at > ?
 AND EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=i.tenant_id AND p.client_id=i.client_id AND p.id=i.project_id AND p.status!='archived' AND p.revision=i.target_revision)
 AND NOT EXISTS(SELECT 1 FROM json_each(i.metric_ids_json) m WHERE NOT EXISTS(SELECT 1 FROM project_metrics pm WHERE pm.tenant_id=i.tenant_id AND pm.client_id=i.client_id AND pm.project_id=i.project_id AND pm.metric_id=m.value))`;
const authority = `EXISTS(SELECT 1 FROM principals a JOIN client_grants cg ON cg.tenant_id=a.tenant_id AND cg.principal_id=a.id WHERE a.tenant_id=i.tenant_id AND a.id=i.approved_by AND a.revoked_at IS NULL AND a.expires_at > ? AND cg.client_id=i.client_id AND EXISTS(SELECT 1 FROM json_each(a.scopes_json) WHERE value='invitations:send'))`;
export function invitations(db:D1Database, principal:Principal, env:InvitationEnv, fake?:MailTransport) {
 return {
 async prepareInvitation(raw:PrepareInvitationInput) {
  const input=prepareInvitationInput.parse(raw);
  await authorize(db,principal,input.clientId,'invitations:manage');
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
  await authorize(db,principal,row.client_id,'invitations:send');
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
  await authorize(db,principal,input.clientId,'invitations:manage');
  return {invitations:(await db.prepare('SELECT id,project_id,recipient_email,metric_ids_json,invite_expires_at,grant_expires_at,delivery_state,accepted_at,revoked_at FROM invitations WHERE tenant_id=? AND client_id=? ORDER BY created_at DESC LIMIT 200').bind(principal.tenantId,input.clientId).all()).results};
 },
 async revokeInvitation(input:{clientId:string;invitationId:string}) {
  await authorize(db,principal,input.clientId,'invitations:manage');
  const result=await db.prepare('UPDATE invitations SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND tenant_id=? AND client_id=?').bind(now(),input.invitationId,principal.tenantId,input.clientId).run();
  if(result.meta.changes)await db.prepare('INSERT INTO invitation_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),input.invitationId,principal.id,'revoked',now()).run();
  return {revoked:Boolean(result.meta.changes)};
 }
 };
}
function json(body:unknown,status=200,setCookie?:string) { const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}; if(setCookie)headers['Set-Cookie']=setCookie; return new Response(JSON.stringify(body),{status,headers}); }
export async function handleInvitationRequest(request:Request,env:InvitationEnv,fake?:MailTransport,dispatch?:(task:Promise<void>)=>void):Promise<Response> {
 const db=env.DB, path=new URL(request.url).pathname;
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 let origin:string; try {origin=appOrigin(env);} catch {return json({error:'Authentication unavailable.'},503);}
 if(request.headers.get('Origin')!==origin || request.headers.get('Sec-Fetch-Site')==='cross-site' || !request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Request rejected.'},403);
 if(Number(request.headers.get('Content-Length')??0)>4096)return json({error:'Request too large.'},413);
 const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
 if(reader) { for(;;) {const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();return json({error:'Request too large.'},413);}chunks.push(part.value);} }
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const text=new TextDecoder().decode(bytes);
 let input:Record<string,unknown>; try {input=JSON.parse(text);if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}catch{return json({error:'Invalid request.'},400);}
 if(path==='/api/logout') { await db.prepare('UPDATE human_sessions SET revoked_at=? WHERE token_hash=?').bind(now(),await sha256(readCookie(request,'__Host-ch_session'))).run(); return json({authenticated:false},200,cookie('__Host-ch_session','',0)); }
 if(!fake) {try{invitationMail(env);}catch{return json({error:'Authentication unavailable.'},503);}}
 const bucket=await sha256(`${request.headers.get('CF-Connecting-IP')??'unknown'}:${Math.floor(Date.now()/600000)}`);
 const rate=await db.prepare('INSERT INTO invitation_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket).first<{hits:number}>();
 if(!rate||rate.hits>30)return json({error:'Please try again later.'},429);
 const liveGrant = `EXISTS(SELECT 1 FROM invitations i JOIN projects p ON p.tenant_id=i.tenant_id AND p.client_id=i.client_id AND p.id=i.project_id WHERE i.recipient_email=c.email AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL AND i.grant_expires_at>? AND p.status!='archived')`;
 if(path==='/api/login/begin') {
  // The public response never waits on identity-dependent reads or provider I/O.
  // A deployment must retain this ephemeral operation with ctx.waitUntil.
  if(!dispatch)return json({error:'Authentication unavailable.'},503);
  const challenge=randomToken();
  const transport=invitationMail(env,fake);
  dispatch(Promise.resolve().then(async()=>{
   if(typeof input.email!=='string'||input.email.length>254||!input.email.includes('@')||Object.keys(input).some(k=>k!=='email'))return;
   const email=input.email.trim().toLowerCase(),time=now();
   const access=await db.prepare(`SELECT 1 FROM (SELECT ? AS email) c WHERE ${liveGrant}`).bind(email,time).first();
   if(!access && !(adminAccessEnabled(env) && isSuperAdminEmail(email)))return;
   const hash=await sha256(challenge),code=Array.from(crypto.getRandomValues(new Uint8Array(8)),x=>x.toString(16).padStart(2,'0')).join('');
   const result=await db.prepare(`INSERT INTO login_challenges(token_hash,email,code_hash,created_at,expires_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM login_challenges WHERE email=? AND created_at>?)<3`).bind(hash,email,await sha256(challenge+':'+code),time,expiry(600000),email,new Date(Date.now()-3600000).toISOString()).run();
   if(!result.meta.changes)return;
   try{await transport.send({to:email,subject:'Your metrics sign-in code',text:`Your sign-in code is ${code}. It expires in 10 minutes. Do not share this code.`,idempotencyKey:`login-${hash}`});await db.prepare("UPDATE login_challenges SET delivery_state='accepted' WHERE token_hash=?").bind(hash).run();}
   catch{await db.prepare("UPDATE login_challenges SET delivery_state='uncertain' WHERE token_hash=?").bind(hash).run();}
  }).catch(()=>{ /* Do not log mail/code-bearing exception objects. No blind retry. */ }));
  return json({status:'If you have active access, a verification code has been sent.'},200,cookie('__Host-ch_login',challenge,600));
 }
 if(path==='/api/login/verify') {
  const challenge=readCookie(request,'__Host-ch_login');
  if(!/^[A-Za-z0-9_-]{43}$/.test(challenge)||typeof input.code!=='string'||!/^[a-f0-9]{16}$/.test(input.code)||Object.keys(input).some(k=>k!=='code'))return json({error:'Invalid or expired verification.'},400);
  const hash=await sha256(challenge),time=now(),operation=crypto.randomUUID(),token=randomToken(),tokenHash=await sha256(token);
  await db.batch([
   db.prepare('UPDATE login_challenges SET attempts=attempts+1 WHERE token_hash=? AND consumed_at IS NULL AND attempts<=5').bind(hash),
   db.prepare(`UPDATE login_challenges AS c SET consumed_at=?,redemption_id=? WHERE c.token_hash=? AND c.code_hash=? AND c.attempts<=5 AND c.consumed_at IS NULL AND c.expires_at>? AND c.delivery_state IN ('accepted','uncertain') AND (${liveGrant} OR (?=1 AND c.email IN ('christian@unreelviews.com','marco@hexacombllc.com')) )`).bind(time,operation,hash,await sha256(challenge+':'+input.code),time,time,adminAccessEnabled(env)?1:0),
   db.prepare('INSERT INTO human_sessions(token_hash,email,expires_at) SELECT ?,email,? FROM login_challenges WHERE redemption_id=?').bind(tokenHash,expiry(12*3600000),operation),
  ]);
  const session=await db.prepare('SELECT email FROM human_sessions WHERE token_hash=?').bind(tokenHash).first<{email:string}>();
  if(!session)return json({error:'Invalid or expired verification.'},400);
  const response=json({authenticated:true,email:session.email},200,cookie('__Host-ch_session',token,43200));response.headers.append('Set-Cookie',cookie('__Host-ch_login','',0));return response;
 }
 if(path==='/api/invitations/begin') {
  const generic=()=>json({status:'If the invitation is valid, a verification code has been sent to its recipient.'});
  if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token)||Object.keys(input).some(k=>k!=='token'))return generic();
  const time=now();
  const row=await db.prepare(`SELECT i.* FROM invitations i WHERE token_hash=? AND i.delivery_state IN ('accepted','uncertain') AND ${eligible} AND ${authority}`).bind(await sha256(input.token),time,time,time).first<Invite>();
  if(!row)return generic();
  let transport:MailTransport;try {transport=invitationMail(env,fake);}catch{return json({error:'Authentication unavailable.'},503);}
  const challenge=randomToken(), code=Array.from(crypto.getRandomValues(new Uint8Array(8)),x=>x.toString(16).padStart(2,'0')).join('');
  const challengeHash=await sha256(challenge), codeHash=await sha256(challenge+':'+code);
  const inserted=await db.prepare(`INSERT INTO invitation_challenges(token_hash,invitation_id,code_hash,created_at,expires_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM invitation_challenges WHERE invitation_id=? AND created_at>?)<3`).bind(challengeHash,row.id,codeHash,time,expiry(600000),row.id,new Date(Date.now()-3600000).toISOString()).run();
  if(!inserted.meta.changes)return generic();
  try {await transport.send({to:row.recipient_email,subject:'Your metrics verification code',text:`Your verification code is ${code}. It expires in 10 minutes. Entering it accepts the invitation. Do not share this code.`,idempotencyKey:`challenge-${challengeHash}`});await db.prepare("UPDATE invitation_challenges SET delivery_state='accepted' WHERE token_hash=?").bind(challengeHash).run();}
  catch {await db.prepare("UPDATE invitation_challenges SET delivery_state='uncertain' WHERE token_hash=?").bind(challengeHash).run();}
  return json({status:'If the invitation is valid, a verification code has been sent to its recipient.'},200,cookie('__Host-ch_challenge',challenge,600));
 }
 if(path==='/api/invitations/accept') {
  const challenge=readCookie(request,'__Host-ch_challenge');
  if(!/^[A-Za-z0-9_-]{43}$/.test(challenge)||typeof input.code!=='string'||!/^[a-f0-9]{16}$/.test(input.code)||Object.keys(input).some(k=>k!=='code'))return json({error:'Invalid or expired verification.'},400);
  const hash=await sha256(challenge), time=now(), operation=crypto.randomUUID(), token=randomToken(), tokenHash=await sha256(token);
  const codeHash=await sha256(challenge+':'+input.code);
  // D1 batch is a transaction. A unique acceptance operation binds all later
  // writes to the single conditional winner, even under concurrent redemption.
  await db.batch([
   db.prepare('UPDATE invitation_challenges SET attempts=attempts+1 WHERE token_hash=? AND consumed_at IS NULL AND attempts<=5').bind(hash),
   db.prepare(`UPDATE invitations AS i SET accepted_at=?,acceptance_id=? WHERE ${eligible} AND ${authority} AND EXISTS(SELECT 1 FROM invitation_challenges c WHERE c.invitation_id=i.id AND c.token_hash=? AND c.code_hash=? AND c.attempts<=5 AND c.consumed_at IS NULL AND c.expires_at>? AND c.delivery_state IN ('accepted','uncertain'))`).bind(time,operation,time,time,time,hash,codeHash,time),
   db.prepare('INSERT INTO human_sessions(token_hash,email,expires_at) SELECT ?,recipient_email,? FROM invitations WHERE acceptance_id=?').bind(tokenHash,expiry(12*3600000),operation),
   db.prepare('UPDATE invitation_challenges SET consumed_at=? WHERE invitation_id IN(SELECT id FROM invitations WHERE acceptance_id=?)').bind(time,operation),
   db.prepare("INSERT INTO invitation_audit SELECT ?,id,recipient_email,'accepted',? FROM invitations WHERE acceptance_id=?").bind(crypto.randomUUID(),time,operation),
  ]);
  const session=await db.prepare('SELECT email FROM human_sessions WHERE token_hash=?').bind(tokenHash).first<{email:string}>();
  if(!session)return json({error:'Invalid or expired verification.'},400);
  const response=json({authenticated:true,email:session.email},200,cookie('__Host-ch_session',token,43200));response.headers.append('Set-Cookie',cookie('__Host-ch_challenge','',0));return response;
 }
 return json({error:'Not found.'},404);
}
