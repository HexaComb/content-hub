import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { invitations, handleInvitationRequest } from '../src/invitations.ts';
import { getSession, portalTargets, portalReport } from '../src/portal.ts';
import { sha256 } from '../src/domain.ts';
import { invitationMail, type MailMessage, type InvitationEnv } from '../src/mail.ts';

test('invitations: passwordless verification, atomic scope, isolation and durable delivery', async t => {
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
 const env:InvitationEnv={DB:db,APP_ORIGIN:'https://reports.example.test'};
 const messages:MailMessage[]=[];
 const mail={async send(message:MailMessage){messages.push(message);return {id:'fake-'+messages.length};}};
 const repo=invitations(db,principal,env,mail);
 const prepare=()=>repo.prepareInvitation({clientId:'c',projectId:'project',recipient:'Viewer@example.test',metricIds:['approved'],grantExpiresAt:new Date(Date.now()+86400000).toISOString()});
 const send=async()=>{const p=await prepare();await repo.sendInvitation({invitationId:p.invitationId,approvalDigest:p.approvalDigest,explicitlyApproved:true});return {id:p.invitationId,token:messages.at(-1)!.text.match(/#token=([\w-]+)/)![1]};};
 let ip=0;
 const request=(path:string,body:unknown,cookie='',override:Record<string,string>={})=>new Request(env.APP_ORIGIN+path,{method:'POST',headers:{Origin:env.APP_ORIGIN!,'Content-Type':'application/json','CF-Connecting-IP':String(++ip),Cookie:cookie,...override},body:JSON.stringify(body)});
 const post=async(path:string,body:unknown,cookie='',override:Record<string,string>={})=>{const tasks:Promise<void>[]=[];const response=await handleInvitationRequest(request(path,body,cookie,override),env,mail,task=>{tasks.push(task);});await Promise.all(tasks);return response;};
 const begin=async(token:string)=>{const res=await post('/api/invitations/begin',{token});const cookie=res.headers.get('set-cookie')!.split(';')[0];const code=messages.at(-1)!.text.match(/code is ([a-f0-9]{16})/)![1];return {cookie,code};};
 assert.throws(()=>invitationMail(env));
 await assert.rejects(invitations(db,{...principal,scopes:['metrics:write']},env,mail).prepareInvitation({clientId:'c',projectId:'project',recipient:'a@example.test',metricIds:['approved'],grantExpiresAt:new Date(Date.now()+86400000).toISOString()}));
 await assert.rejects(repo.prepareInvitation({clientId:'c',projectId:'project',recipient:'a@example.test',metricIds:['missing'],grantExpiresAt:new Date(Date.now()+86400000).toISOString()}));
 const prepared=await prepare();
 await assert.rejects(repo.sendInvitation({invitationId:prepared.invitationId,approvalDigest:'b'.repeat(64),explicitlyApproved:true}));
 assert.equal(messages.length,0);
 const invite=await send();
 assert.equal(invite.token.length,43);
 assert.equal(messages.at(-1)!.to,'viewer@example.test');
 const saved=await db.prepare('SELECT * FROM invitations WHERE id=?').bind(invite.id).first();
 assert.equal(saved!.token_hash,await sha256(invite.token));
 assert.ok(!JSON.stringify(saved).includes(invite.token));
 assert.equal((await handleInvitationRequest(new Request(env.APP_ORIGIN+'/api/invitations/accept?token='+invite.token),env,mail)).status,405);
 assert.equal((await post('/api/invitations/begin',{token:invite.token},'',{Origin:'https://attacker.test'})).status,403);
 const challenge=await begin(invite.token);
 assert.equal(messages.at(-1)!.to,'viewer@example.test');
 assert.equal((await post('/api/invitations/accept',{code:challenge.code,email:'attacker@example.test'},challenge.cookie)).status,400);
 assert.equal((await post('/api/invitations/accept',{code:'0'.repeat(16)},challenge.cookie)).status,400);
 const winners=await Promise.all([post('/api/invitations/accept',{code:challenge.code},challenge.cookie),post('/api/invitations/accept',{code:challenge.code},challenge.cookie)]);
 assert.deepEqual(winners.map(r=>r.status).sort(),[200,400]);
 const response=winners.find(r=>r.status===200)!;
 const setCookie=response.headers.get('set-cookie')!;
 assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);
 const sessionCookie=setCookie.match(/__Host-ch_session=[^;]+/)![0];
 const session=await getSession(db,new Request(env.APP_ORIGIN!,{headers:{Cookie:sessionCookie}}));assert.ok(session);
 assert.equal(await getSession(db,new Request(env.APP_ORIGIN!,{headers:{Cookie:sessionCookie+'; '+sessionCookie}})),null);
 assert.equal((await portalTargets(db,session)).targets.length,1);
 await assert.rejects(portalReport(db,session,'c','sibling','2026-10'));
 await assert.rejects(portalReport(db,session,'other','project','2026-10'));
 const report=await portalReport(db,session,'c','project','2026-10');
 assert.deepEqual(report.metrics.map(m=>m.id),['approved']);assert.equal(report.metrics[0].current!.value,42);assert.equal(report.target.name,'project');
 assert.ok(!JSON.stringify(report).includes('secret'));assert.ok(!JSON.stringify(report).includes('definition'));assert.ok(!JSON.stringify(report).includes('source'));
 assert.equal((await db.prepare('SELECT count(*) n FROM client_grants').first())!.n,1);
 // Revoke grant A after observations were fetched while grant B survives.
 const second=await repo.prepareInvitation({clientId:'c',projectId:'project',recipient:'viewer@example.test',metricIds:['unapproved'],grantExpiresAt:new Date(Date.now()+86400000).toISOString()});
 await db.prepare("UPDATE invitations SET accepted_at='2026-01-01' WHERE id=?").bind(second.invitationId).run();
 let interrupted=false;
 const racingDb=new Proxy(db,{get(target,key){
  if(key!=='prepare') { const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value; }
  return (sql:string)=>{
   const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(st,k){
    if(k==='bind')return (...args:unknown[])=>wrap(st.bind(...args));
    if(k==='all'&&sql.includes('SELECT o.metric_id'))return async()=>{const rows=await st.all();if(!interrupted){interrupted=true;await repo.revokeInvitation({clientId:'c',invitationId:invite.id});}return rows;};
    const value=Reflect.get(st,k);return typeof value==='function'?value.bind(st):value;
   }});
   return wrap(target.prepare(sql));
  };
 }});
 const racedReport=await portalReport(racingDb,session,'c','project','2026-10');
 assert.equal(interrupted,true);assert.deepEqual(racedReport.metrics.map(m=>m.id),['unapproved']);
 await db.prepare('UPDATE invitations SET revoked_at=NULL WHERE id=?').bind(invite.id).run();
 await repo.revokeInvitation({clientId:'c',invitationId:second.invitationId});
 // Known and unknown login addresses get the same immediate response;
 // database lookup and slow provider delivery happen only in dispatched work.
 let releaseMail!:()=>void;
 const mailBlocked=new Promise<void>(resolve=>{releaseMail=resolve;});
 let mailEntered=false;
 const pendingTasks:Promise<void>[]=[];
 const slowMail={async send(message:MailMessage){mailEntered=true;await mailBlocked;return {id:'delayed-fake'};}};
 let timer:ReturnType<typeof setTimeout>|undefined;
 const knownResponse=await Promise.race([
  handleInvitationRequest(request('/api/login/begin',{email:'viewer@example.test'}),env,slowMail,task=>{pendingTasks.push(task);}),
  new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Login response waited for mail')),3000);}),
 ]).finally(()=>{clearTimeout(timer);releaseMail();});
 const unknownTasks:Promise<void>[]=[];
 const unknownResponse=await handleInvitationRequest(request('/api/login/begin',{email:'unknown@example.test'}),env,slowMail,task=>{unknownTasks.push(task);});
 assert.equal(knownResponse.status,unknownResponse.status);
 assert.deepEqual(await knownResponse.json(),await unknownResponse.json());
 assert.match(knownResponse.headers.get('set-cookie')!,/__Host-ch_login=/);
 assert.match(unknownResponse.headers.get('set-cookie')!,/__Host-ch_login=/);
 await Promise.all([...pendingTasks,...unknownTasks]);assert.equal(mailEntered,true);
 const loginResponse=await post('/api/login/begin',{email:'VIEWER@example.test'});
 const loginCookie=loginResponse.headers.get('set-cookie')!.split(';')[0];
 const loginCode=messages.at(-1)!.text.match(/code is ([a-f0-9]{16})/)![1];
 assert.equal(messages.at(-1)!.to,'viewer@example.test');
 assert.equal((await post('/api/login/verify',{code:'0'.repeat(16)},loginCookie)).status,400);
 const loginWinners=await Promise.all([post('/api/login/verify',{code:loginCode},loginCookie),post('/api/login/verify',{code:loginCode},loginCookie)]);
 assert.deepEqual(loginWinners.map(r=>r.status).sort(),[200,400]);
 const repeatCookie=loginWinners.find(r=>r.status===200)!.headers.get('set-cookie')!.match(/__Host-ch_session=[^;]+/)![0];
 assert.ok(await getSession(db,new Request(env.APP_ORIGIN!,{headers:{Cookie:repeatCookie}})));
 await post('/api/logout',{},repeatCookie);
 assert.equal(await getSession(db,new Request(env.APP_ORIGIN!,{headers:{Cookie:repeatCookie}})),null);
 const emailCount=messages.length;await post('/api/login/begin',{email:'unknown@example.test'});assert.equal(messages.length,emailCount);
 await db.prepare("DELETE FROM project_metrics WHERE metric_id='approved'").run();
 assert.deepEqual((await portalReport(db,session,'c','project','2026-10')).metrics,[]);
 await db.prepare("INSERT INTO project_metrics VALUES('t','c','project','approved')").run();
 const before=messages.length;await post('/api/invitations/begin',{token:invite.token});assert.equal(messages.length,before);
 await repo.revokeInvitation({clientId:'c',invitationId:invite.id});
 assert.deepEqual((await portalTargets(db,session)).targets,[]);await assert.rejects(portalReport(db,session,'c','project','2026-10'));
 for(const mutation of ["revoked_at='2026-01-01'","invite_expires_at='2020-01-01'","target_revision=999"]) {
  const v=await send();await db.prepare(`UPDATE invitations SET ${mutation} WHERE id=?`).bind(v.id).run();const count:number=messages.length;await post('/api/invitations/begin',{token:v.token});assert.equal(messages.length,count);
 }
 const attemptsInvite=await send(), limited=await begin(attemptsInvite.token);
 for(let n=0;n<5;n++)assert.equal((await post('/api/invitations/accept',{code:'f'.repeat(16)},limited.cookie)).status,400);
 assert.equal((await post('/api/invitations/accept',{code:limited.code},limited.cookie)).status,400);
 const authorityInvite=await send(), authorityChallenge=await begin(authorityInvite.token);
 await db.prepare("UPDATE principals SET revoked_at='2026-01-01' WHERE tenant_id='t' AND id='p'").run();
 assert.equal((await post('/api/invitations/accept',{code:authorityChallenge.code},authorityChallenge.cookie)).status,400);
 await db.prepare("UPDATE principals SET revoked_at=NULL WHERE tenant_id='t' AND id='p'").run();
 const expired=await send(), expiredChallenge=await begin(expired.token);
 await db.prepare("UPDATE invitation_challenges SET expires_at='2020-01-01' WHERE invitation_id=?").bind(expired.id).run();
 assert.equal((await post('/api/invitations/accept',{code:expiredChallenge.code},expiredChallenge.cookie)).status,400);
 const stale=await send(), staleChallenge=await begin(stale.token);
 await db.prepare("DELETE FROM project_metrics WHERE metric_id='approved'").run();
 assert.equal((await post('/api/invitations/accept',{code:staleChallenge.code},staleChallenge.cookie)).status,400);
 await db.prepare("INSERT INTO project_metrics VALUES('t','c','project','approved')").run();
 let calls=0;const uncertain=invitations(db,principal,env,{async send(){calls++;throw Error('Synthetic timeout');}});
 const uncertainPrepared=await prepare();assert.equal((await uncertain.sendInvitation({invitationId:uncertainPrepared.invitationId,approvalDigest:uncertainPrepared.approvalDigest,explicitlyApproved:true})).deliveryState,'uncertain');
 await assert.rejects(uncertain.sendInvitation({invitationId:uncertainPrepared.invitationId,approvalDigest:uncertainPrepared.approvalDigest,explicitlyApproved:true}));assert.equal(calls,1);
 for(let n=0;n<30;n++)await post('/api/invitations/begin',{token:'invalid'},'',{'CF-Connecting-IP':'rate-test'});
 assert.equal((await post('/api/invitations/begin',{token:'invalid'},'',{'CF-Connecting-IP':'rate-test'})).status,429);
});
