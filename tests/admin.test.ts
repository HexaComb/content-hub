import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { adminAccessEnabled, getAdminSession, requireSuperAdmin, isSuperAdminEmail } from '../src/admin.ts';
import { handleInvitationRequest, invitations, randomToken } from '../src/invitations.ts';
import { sha256 } from '../src/domain.ts';
import type { InvitationEnv, MailMessage } from '../src/mail.ts';

test('superadmins: exact verified allowlist, current gates and atomic passwordless login', async t => {
 const mf=new Miniflare({workers:[{config:{name:'admin-tests',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'admin-tests'}}}}]});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  const sql=await readFile('migrations/'+file,'utf8');
  for(const statement of sql.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 // Synthetic configuration used only with an injected fake transport. No network.
 const env:InvitationEnv={DB:db,APP_ORIGIN:'https://reports.example.test',ADMIN_ACCESS_ENABLED:'true',INVITATIONS_ENABLED:'true',RESEND_FROM:'Test <test@example.test>',RESEND_API_KEY:'synthetic-not-a-real-key'};
 const messages:MailMessage[]=[];
 const mail={async send(message:MailMessage){messages.push(message);return {id:'fake-'+messages.length};}};
 let ip=0;
 const request=(path:string,body:unknown,cookie='')=>new Request(env.APP_ORIGIN+path,{method:'POST',headers:{Origin:env.APP_ORIGIN!,'Content-Type':'application/json','CF-Connecting-IP':String(++ip),Cookie:cookie},body:JSON.stringify(body)});
 const post=async(path:string,body:unknown,cookie='',config=env)=>{const tasks:Promise<void>[]=[];const response=await handleInvitationRequest(request(path,body,cookie),config,mail,task=>{tasks.push(task);});await Promise.all(tasks);return response;};
 const sessionRequest=(cookie='')=>new Request(env.APP_ORIGIN+'/api/admin/session',{headers:{Cookie:cookie}});
 const begin=async(email:string)=>{const response=await post('/api/login/begin',{email});assert.equal(response.status,200);return {cookie:response.headers.get('set-cookie')!.split(';')[0],code:messages.at(-1)!.text.match(/code is ([a-f0-9]{16})/)![1]};};
 const readAdmin=(cookie:string,config=env)=>getAdminSession(db,sessionRequest(cookie),config);
 assert.equal(isSuperAdminEmail(' CHRISTIAN@UNREELVIEWS.COM '),true);
 assert.equal(isSuperAdminEmail('marco@hexacombllc.com'),true);
 for(const address of ['someone@example.test','christian+alias@unreelviews.com','christian@unreelviews.com.evil.test','mar.co@hexacombllc.com','marco@hexacombllc.com@evil.test'])assert.equal(isSuperAdminEmail(address),false);
 assert.equal(adminAccessEnabled(env),true);
 for(const config of [{...env,ADMIN_ACCESS_ENABLED:undefined},{...env,ADMIN_ACCESS_ENABLED:'false'},{...env,INVITATIONS_ENABLED:'false'},{...env,RESEND_API_KEY:undefined},{...env,RESEND_FROM:undefined},{...env,APP_ORIGIN:'http://reports.example.test'}])assert.equal(adminAccessEnabled(config),false);
 assert.equal(await readAdmin(''),null);
 assert.equal(await getAdminSession(db,new Request(env.APP_ORIGIN+'/api/admin/session?email=christian@unreelviews.com&role=super_admin',{headers:{'X-User-Email':'christian@unreelviews.com','X-Role':'super_admin'}}),env),null);
 assert.equal(await readAdmin('__Host-ch_session='+randomToken()),null);
 await assert.rejects(requireSuperAdmin(db,sessionRequest(),env));
 const challenge=await begin(' CHRISTIAN@UNREELVIEWS.COM ');
 assert.equal(messages.at(-1)!.to,'christian@unreelviews.com');
 assert.equal(await readAdmin(challenge.cookie),null);
 assert.equal((await post('/api/login/verify',{code:challenge.code,role:'super_admin',email:'marco@hexacombllc.com'},challenge.cookie)).status,400);
 assert.equal((await post('/api/login/verify',{code:'0'.repeat(16)},challenge.cookie)).status,400);
 const verified=await Promise.all([post('/api/login/verify',{code:challenge.code},challenge.cookie),post('/api/login/verify',{code:challenge.code},challenge.cookie)]);
 assert.deepEqual(verified.map(r=>r.status).sort(),[200,400]);
 const christianCookie=verified.find(r=>r.status===200)!.headers.get('set-cookie')!.match(/__Host-ch_session=[^;]+/)![0];
 assert.deepEqual(await readAdmin(christianCookie),{email:'christian@unreelviews.com',role:'super_admin'});
 assert.deepEqual(await requireSuperAdmin(db,sessionRequest(christianCookie),env),{email:'christian@unreelviews.com',role:'super_admin'});
 assert.equal(await readAdmin(christianCookie,{...env,ADMIN_ACCESS_ENABLED:'false'}),null);
 assert.equal(await readAdmin(christianCookie,{...env,INVITATIONS_ENABLED:'false'}),null);
 assert.equal(await readAdmin(christianCookie+'; '+christianCookie),null);
 const count=messages.length;
 for(const email of ['unknown@example.test','christian+alias@unreelviews.com']) {
  const response=await post('/api/login/begin',{email});assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie'));assert.equal(messages.length,count);
 }
 const disabled=await post('/api/login/begin',{email:'marco@hexacombllc.com'},'',{...env,ADMIN_ACCESS_ENABLED:'false'});assert.equal(disabled.status,200);assert.equal(messages.length,count);
 const marco=await begin('MARCO@HEXACOMBLLC.COM');
 assert.equal((await post('/api/login/verify',{code:marco.code},marco.cookie,{...env,ADMIN_ACCESS_ENABLED:'false'})).status,400);
 const marcoVerified=await post('/api/login/verify',{code:marco.code},marco.cookie);assert.equal(marcoVerified.status,200);
 const marcoCookie=marcoVerified.headers.get('set-cookie')!.match(/__Host-ch_session=[^;]+/)![0];
 assert.deepEqual(await readAdmin(marcoCookie),{email:'marco@hexacombllc.com',role:'super_admin'});
 // Both allowlisted and unknown addresses return before identity-dependent mail I/O.
 let releaseMail!:()=>void;
 const blocked=new Promise<void>(resolve=>{releaseMail=resolve;});
 const background:Promise<void>[]=[];
 const slowMail={async send(message:MailMessage){await blocked;return {id:'fake-delayed'};}};
 let timer:ReturnType<typeof setTimeout>;
 const immediate=await Promise.race([
  handleInvitationRequest(request('/api/login/begin',{email:'christian@unreelviews.com'}),env,slowMail,task=>{background.push(task);}),
  new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Login waited for mail')),1500);}),
 ]).finally(()=>{clearTimeout(timer);releaseMail();});
 assert.equal(immediate.status,200);assert.ok(immediate.headers.get('set-cookie'));
 await Promise.all(background);
 const unknown=await post('/api/login/begin',{email:'nobody@example.test'});
 assert.deepEqual(await immediate.json(),await unknown.json());
 assert.equal(await readAdmin(marcoCookie,{...env,ADMIN_ACCESS_ENABLED:'false'}),null);
 assert.deepEqual(await readAdmin(marcoCookie),{email:'marco@hexacombllc.com',role:'super_admin'});
 const christianHash=await sha256(christianCookie.split('=')[1]);
 await db.prepare("UPDATE human_sessions SET revoked_at='2026-01-01' WHERE token_hash=?").bind(christianHash).run();assert.equal(await readAdmin(christianCookie),null);
 await db.prepare("UPDATE human_sessions SET revoked_at=NULL,expires_at='2020-01-01' WHERE token_hash=?").bind(christianHash).run();assert.equal(await readAdmin(christianCookie),null);
 // An actually accepted viewer invitation never establishes administrator role.
 await db.prepare("INSERT INTO tenants VALUES('t','Test')").run();
 await db.prepare("INSERT INTO clients VALUES('t','c','Client','UTC')").run();
 const scopes=['invitations:manage','invitations:send'];
 await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES('t','p','Test',?,'2099-01-01',?)").bind('a'.repeat(64),JSON.stringify(scopes)).run();
 await db.prepare("INSERT INTO client_grants VALUES('t','p','c')").run();
 await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES('t','c','project','Project','','active',1,'2026-01-01','2026-01-01')").run();
 await db.prepare("INSERT INTO metrics VALUES('t','c','metric','metric','Metric','category','count','higher','period_total','UTC','{}','Definition','p','2026-01-01')").run();
 await db.prepare("INSERT INTO project_metrics VALUES('t','c','project','metric')").run();
 const repo=invitations(db,{tenantId:'t',id:'p',scopes},env,mail);
 const prepared=await repo.prepareInvitation({clientId:'c',projectId:'project',recipient:'viewer@example.test',metricIds:['metric'],grantExpiresAt:new Date(Date.now()+86400000).toISOString()});
 await repo.sendInvitation({invitationId:prepared.invitationId,approvalDigest:prepared.approvalDigest,explicitlyApproved:true});
 const token=messages.at(-1)!.text.match(/#token=([\w-]+)/)![1];
 const invitation=await post('/api/invitations/begin',{token});
 const inviteCookie=invitation.headers.get('set-cookie')!.split(';')[0],code=messages.at(-1)!.text.match(/code is ([a-f0-9]{16})/)![1];
 const accepted=await post('/api/invitations/accept',{code},inviteCookie);assert.equal(accepted.status,200);
 const viewerCookie=accepted.headers.get('set-cookie')!.match(/__Host-ch_session=[^;]+/)![0];
 assert.equal(await readAdmin(viewerCookie),null);await assert.rejects(requireSuperAdmin(db,sessionRequest(viewerCookie),env));
 const viewer=await begin('viewer@example.test');
 assert.equal((await post('/api/login/verify',{code:viewer.code},viewer.cookie,{...env,ADMIN_ACCESS_ENABLED:'false'})).status,200);
});
