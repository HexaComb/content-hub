import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { invitations, handleInvitationRequest } from '../src/invitations.ts';
import { portalTargets, portalReport } from '../src/portal.ts';
import type { HumanIdentity } from '../src/humanAuth.ts';
import { sha256 } from '../src/domain.ts';
import { invitationMail, type MailMessage, type InvitationEnv } from '../src/mail.ts';

test('invitations: Clerk identity binding, atomic scope, isolation and durable delivery', async t => {
 const mf=new Miniflare({workers:[{config:{name:'invitation-tests',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'invitation-tests'}}}}]});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  const sql=await readFile('migrations/'+file,'utf8');
  for(const statement of sql.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 await db.prepare("INSERT INTO tenants VALUES('t','Test'),('other','Other')").run();
 await db.prepare("INSERT INTO clients VALUES('t','c','Client','UTC'),('other','c','Other','UTC')").run();
 const scopes=['invitations:manage','invitations:send'];
 await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES('t','p','Test',?,'2099-01-01',?)").bind('a'.repeat(64),JSON.stringify(scopes)).run();
 await db.prepare("INSERT INTO client_grants VALUES('t','p','c')").run();
 for(const id of ['project','sibling']) await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES('t','c',?,?,'Internal secret','active',1,'2026-01-01','2026-01-01')").bind(id,id).run();
 await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES('other','c','project','Other tenant secret','Private','active',1,'2026-01-01','2026-01-01')").run();
 for(const id of ['approved','unapproved']) {
  await db.prepare("INSERT INTO metrics VALUES('t','c',?,?,?,'private','count','higher','period_total','UTC','{}','Private definition','p','2026-01-01')").bind(id,id,id).run();
  await db.prepare("INSERT INTO project_metrics VALUES('t','c','project',?)").bind(id).run();
  await db.prepare("INSERT INTO observations VALUES('t','c',?,?,'2026-10-01','2026-11-01',1,42,'complete',?, '2026-11-01','2026-11-01','p',?,'hash',NULL)").bind(id,id,JSON.stringify({url:'https://internal.invalid/secret',notes:'secret'}),id).run();
 }
 const principal={tenantId:'t',id:'p',scopes};
 const env:InvitationEnv={DB:db,APP_ORIGIN:'https://reports.example.test',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:'https://clerk.example.test',CLERK_PUBLISHABLE_KEY:'pk_test_'+btoa('clerk.example.test$').replaceAll('=',''),CLERK_SECRET_KEY:'synthetic-test-only'};
 const actor:HumanIdentity={issuer:env.CLERK_ISSUER!,subject:'user_viewer',sessionId:'sess_viewer',email:'viewer@example.test'};
 const messages:MailMessage[]=[];
 const mail={async send(message:MailMessage){messages.push(message);return {id:'fake-'+messages.length};}};
 const repo=invitations(db,principal,env,mail);
 const prepare=(metricIds=['approved'])=>repo.prepareInvitation({clientId:'c',projectId:'project',recipient:'Viewer@example.test',metricIds,grantExpiresAt:new Date(Date.now()+86400000).toISOString()});
 const send=async(metricIds=['approved'])=>{const prepared=await prepare(metricIds);await repo.sendInvitation({invitationId:prepared.invitationId,approvalDigest:prepared.approvalDigest,explicitlyApproved:true});const token=messages.at(-1)!.text.match(/#token=([A-Za-z0-9_-]+)/)![1];return {id:prepared.invitationId,token};};
 let requestNumber=0;
 const post=(path:string,body:unknown,identity:HumanIdentity|null=actor,headers:Record<string,string>={})=>handleInvitationRequest(new Request(env.APP_ORIGIN+path,{method:'POST',headers:{Origin:env.APP_ORIGIN!,'Content-Type':'application/json','CF-Connecting-IP':'test-'+requestNumber++,...headers},body:JSON.stringify(body)}),env,mail,identity);
 await assert.rejects(()=>invitations(db,{...principal,scopes:['metrics:write']},env,mail).prepareInvitation({clientId:'c',projectId:'project',recipient:actor.email,metricIds:['approved'],grantExpiresAt:new Date(Date.now()+86400000).toISOString()}));
 assert.throws(()=>invitationMail(env));
 const invite=await send();
 assert.equal(messages[0].to,actor.email);
 assert.equal((await post('/api/invitations/begin',{token:invite.token},null)).status,401);
 assert.equal((await post('/api/invitations/begin',{token:invite.token},{...actor,email:'other@example.test'})).status,400);
 assert.equal((await post('/api/invitations/begin',{token:invite.token,role:'super_admin'})).status,400);
 const preview=await post('/api/invitations/begin',{token:invite.token});
 assert.equal(preview.status,200);assert.equal(preview.headers.get('Cache-Control'),'no-store');
 const previewText=await preview.text();assert.ok(!previewText.includes(invite.token));assert.ok(!previewText.includes('Internal secret'));
 assert.equal((await handleInvitationRequest(new Request(env.APP_ORIGIN+'/api/invitations/accept'),env,mail,actor)).status,405);
 assert.equal((await post('/api/invitations/accept',{token:invite.token},actor,{Origin:'https://evil.example'})).status,403);
 const accepted=await Promise.all([post('/api/invitations/accept',{token:invite.token}),post('/api/invitations/accept',{token:invite.token})]);
 assert.deepEqual(accepted.map(r=>r.status).sort(),[200,400]);
 assert.ok(accepted.every(r=>!r.headers.has('Set-Cookie')));
 assert.equal((await db.prepare('SELECT count(*) n FROM human_sessions').first<{n:number}>())!.n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM invitation_challenges').first<{n:number}>())!.n,0);
 const bound=await db.prepare('SELECT accepted_identity_issuer issuer,accepted_identity_subject subject FROM invitations WHERE id=?').bind(invite.id).first();
 assert.deepEqual(bound,{issuer:actor.issuer,subject:actor.subject});
 await assert.rejects(()=>db.prepare("UPDATE invitations SET accepted_identity_subject='other' WHERE id=?").bind(invite.id).run(),/immutable/);
 assert.equal((await portalTargets(db,actor)).targets.length,1);
 assert.deepEqual((await portalTargets(db,{...actor,subject:'other_user'})).targets,[]);
 assert.deepEqual((await portalTargets(db,{...actor,issuer:'https://other.example'})).targets,[]);
 // A changed verified email cannot transfer a grant to another Clerk user.
 assert.equal((await portalTargets(db,{...actor,email:'changed@example.test'})).targets.length,1);
 const report=await portalReport(db,actor,'c','project','2026-10');
 assert.deepEqual(report.metrics.map(m=>m.id),['approved']);
 assert.equal(report.metrics[0].current?.value,42);
 const dto=JSON.stringify(report);for(const secret of ['Internal secret','Private definition','internal.invalid','notes','source_json',invite.token,'token_hash'])assert.ok(!dto.includes(secret));
 await assert.rejects(()=>portalReport(db,actor,'c','sibling','2026-10'));
 await assert.rejects(()=>portalReport(db,actor,'wrong-client','project','2026-10'));
 await db.prepare("DELETE FROM project_metrics WHERE metric_id='approved'").run();
 assert.deepEqual((await portalReport(db,actor,'c','project','2026-10')).metrics,[]);
 await db.prepare("INSERT INTO project_metrics VALUES('t','c','project','approved')").run();
 // Revoke grant A after reading observations while grant B survives. Cached A
 // data must be filtered out by the final exact metric authorization query.
 const second=await send(['unapproved']);assert.equal((await post('/api/invitations/accept',{token:second.token})).status,200);
 let revokedDuringRead=false;
 const wrappedDb={prepare(sql:string){const statement=db.prepare(sql);if(!sql.startsWith('SELECT o.metric_id'))return statement;return {bind(...values:unknown[]){const bound=statement.bind(...values);return {async all(){const rows=await bound.all();await repo.revokeInvitation({clientId:'c',invitationId:invite.id});revokedDuringRead=true;return rows;}};}};}} as unknown as D1Database;
 const filtered=await portalReport(wrappedDb,actor,'c','project','2026-10');
 assert.equal(revokedDuringRead,true);assert.deepEqual(filtered.metrics.map(m=>m.id),['unapproved']);
 await repo.revokeInvitation({clientId:'c',invitationId:second.id});
 assert.deepEqual((await portalTargets(db,actor)).targets,[]);
 // Legacy email-only accepted rows intentionally never migrate by matching email.
 const legacy=await send();await db.prepare("UPDATE invitations SET accepted_at=?,acceptance_id='legacy' WHERE id=?").bind(new Date().toISOString(),legacy.id).run();
 assert.deepEqual((await portalTargets(db,actor)).targets,[]);
 for(const mutation of ["revoked_at='2026-01-01'","invite_expires_at='2020-01-01'","target_revision=999"]){const v=await send();await db.prepare(`UPDATE invitations SET ${mutation} WHERE id=?`).bind(v.id).run();assert.equal((await post('/api/invitations/accept',{token:v.token})).status,400);}
 const stale=await send();await db.prepare("DELETE FROM project_metrics WHERE metric_id='approved'").run();assert.equal((await post('/api/invitations/accept',{token:stale.token})).status,400);await db.prepare("INSERT INTO project_metrics VALUES('t','c','project','approved')").run();
 const authority=await send();await db.prepare("UPDATE principals SET revoked_at='2026-01-01' WHERE tenant_id='t' AND id='p'").run();assert.equal((await post('/api/invitations/accept',{token:authority.token})).status,400);await db.prepare("UPDATE principals SET revoked_at=NULL WHERE tenant_id='t' AND id='p'").run();
 let calls=0;const uncertain=invitations(db,principal,env,{async send(){calls++;throw Error('Synthetic timeout');}});const pending=await prepare();
 assert.equal((await uncertain.sendInvitation({invitationId:pending.invitationId,approvalDigest:pending.approvalDigest,explicitlyApproved:true})).deliveryState,'uncertain');
 await assert.rejects(()=>uncertain.sendInvitation({invitationId:pending.invitationId,approvalDigest:pending.approvalDigest,explicitlyApproved:true}));assert.equal(calls,1);
 for(const path of ['/api/login/begin','/api/login/verify','/api/logout'])assert.equal((await post(path,{email:actor.email,code:'000000'})).status,404);
 for(let n=0;n<30;n++)await post('/api/invitations/begin',{token:'a'.repeat(43)},actor,{'CF-Connecting-IP':'rate-test'});
 assert.equal((await post('/api/invitations/begin',{token:'a'.repeat(43)},actor,{'CF-Connecting-IP':'rate-test'})).status,429);
 assert.equal(messages.length,(await db.prepare("SELECT count(*) n FROM invitations WHERE delivery_state='accepted'").first<{n:number}>())!.n);
});
