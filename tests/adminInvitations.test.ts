import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {handleAdminInvitationRequest,invitationReadiness} from '../src/adminInvitations.ts';
import {handleInvitationRequest} from '../src/invitations.ts';
import {portalReport,portalTargets} from '../src/portal.ts';
import {authenticate} from '../src/auth.ts';
import type {HumanIdentity} from '../src/humanAuth.ts';
import type {InvitationEnv,MailMessage} from '../src/mail.ts';

test('browser invitations require verified admins, exact project review and isolated recipient acceptance',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'admin-invites-test',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'admin-invites'}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())for(const statement of(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const env:InvitationEnv={DB:db,APP_ORIGIN:'https://reports.example.test',ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:'https://clerk.example.test',CLERK_PUBLISHABLE_KEY:'pk_test_'+btoa('clerk.example.test$').replaceAll('=',''),CLERK_SECRET_KEY:'test-only',INVITATIONS_ENABLED:'false'};
 const admin:HumanIdentity={issuer:env.CLERK_ISSUER!,subject:'admin-one',email:'marco@hexacombllc.com',sessionId:'verified-session'};
 const viewer:HumanIdentity={...admin,subject:'viewer-one',email:'viewer@example.test'};
 const messages:MailMessage[]=[];
 const fake={async send(message:MailMessage){messages.push(message);return {id:'fake-'+messages.length};}};
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants VALUES(?,?)').bind(tenant,tenant).run();
  await db.prepare("INSERT INTO clients(tenant_id,id,name,timezone) VALUES(?,'c',?,'UTC')").bind(tenant,'Client '+tenant).run();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES(?,'agent','Synthetic',?,'2099-01-01','[]')").bind(tenant,tenant.repeat(64)).run();
  for(const project of ['p','sibling'])await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES(?,'c',?,?,'','active',1,'2026-11-01','2026-11-01')").bind(tenant,project,'Project '+project+' '+tenant).run();
  for(const metric of ['m','later']){
   await db.prepare("INSERT INTO metrics(tenant_id,client_id,id,key,label,category,unit,direction,semantics,timezone,dimensions_json,definition,created_by,created_at) VALUES(?,'c',?,?,?,'test','count','higher','period_total','UTC','{}','Synthetic','agent','2026-11-01')").bind(tenant,metric,metric,metric).run();
   await db.prepare("INSERT INTO project_metrics VALUES(?,'c','p',?)").bind(tenant,metric).run();
  }
 }
 const base='/api/admin/targets/a/c/p/invitations';
 const request=(path:string,body?:unknown,headers:Record<string,string>={})=>new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Origin:env.APP_ORIGIN!,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const call=(path=base,body?:unknown,identity:HumanIdentity|null=admin,config=env,mail:typeof fake|undefined=fake)=>handleAdminInvitationRequest(request(path,body),config,identity,mail);
 const noRead={...env,DB:{prepare(){throw Error('Must authorize before DB');}} as unknown as D1Database};
 for(const identity of [null,viewer,{...viewer,role:'super_admin'} as HumanIdentity,{...admin,issuer:'https://evil.example.test'}])await assert.rejects(call(base,undefined,identity,noRead),/Administrator access/);
 await assert.rejects(call(base,undefined,admin,{...noRead,ADMIN_ACCESS_ENABLED:'false'}),/Administrator access/);
 assert.equal((await call(base,{})).status,405);
 assert.equal((await handleAdminInvitationRequest(request(base+'/prepare',{}, {Origin:'https://evil.example.test'}),env,admin,fake)).status,403);
 assert.equal((await handleAdminInvitationRequest(request(base+'/prepare',{}, {'Sec-Fetch-Site':'cross-site'}),env,admin,fake)).status,403);
 const listing=await(await call()).json() as any;
 assert.equal(listing.target.clientName,'Client a');assert.equal(listing.target.name,'Project p a');assert.equal(listing.readiness.enabled,false);assert.equal(listing.invitations.length,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM admin_invitation_actors').first<{n:number}>())!.n,0);
 const input={recipient:viewer.email,metricIds:['m'],grantExpiresAt:new Date(Date.now()+86400000*30).toISOString()};
 const prepare=async()=>await(await call(base+'/prepare',input)).json() as any;
 const prepared=await prepare();assert.deepEqual(prepared.preview.metricIds,['m']);assert.equal(messages.length,0);assert.equal(prepared.preview.projectId,'p');
 assert.equal((await db.prepare('SELECT count(*) n FROM client_grants').first<{n:number}>())!.n,0);
 const actor=await db.prepare("SELECT token_hash,scopes_json FROM principals WHERE id LIKE 'admin-%'").first<{token_hash:string;scopes_json:string}>();assert.equal(actor!.scopes_json,'[]');assert.match(actor!.token_hash,/^admin:/);
 assert.equal(await authenticate(new Request(env.APP_ORIGIN!,{headers:{Authorization:'Bearer '+actor!.token_hash}}),db),null);
 const send={invitationId:prepared.invitationId,approvalDigest:prepared.approvalDigest,explicitlyApproved:true};
 assert.equal((await handleAdminInvitationRequest(request(base+'/send',send),env,admin)).status,409);assert.equal(messages.length,0);
 await assert.rejects(call(base+'/send',{...send,explicitlyApproved:false}));
 await assert.rejects(call(base+'/send',{...send,approvalDigest:'f'.repeat(64)}),/Approval does not match/);
 await assert.rejects(call(base.replace('/a/','/b/')+'/send',send),/not available for this project/);
 await assert.rejects(call(base.replace('/p/','/sibling/')+'/send',send),/not available for this project/);
 const sent=await Promise.allSettled([call(base+'/send',send),call(base+'/send',send)]);assert.equal(sent.filter(r=>r.status==='fulfilled').length,1);assert.equal(messages.length,1);
 const token=messages[0].text.match(/#token=([A-Za-z0-9_-]+)/)![1];
 const accept=(identity:HumanIdentity,config=env)=>handleInvitationRequest(request('/api/invitations/accept',{token}),config,undefined,identity);
 assert.equal((await accept({...viewer,email:'wrong@example.test'})).status,400);
 assert.equal((await accept(viewer,{...env,ADMIN_ACCESS_ENABLED:'false'})).status,400);
 const accepted=await accept(viewer);assert.equal(accepted.status,200);assert.equal((await accepted.json() as any).projectPath,'/project?client=c&project=p');
 assert.equal((await accept(viewer)).status,400);
 const report=await portalReport(db,viewer,'c','p','2026-10');assert.equal(report.target.clientName,'Client a');assert.deepEqual(report.metrics.map(m=>m.id),['m']);
 await assert.rejects(portalReport(db,viewer,'c','sibling','2026-10'),/not available/);
 assert.deepEqual((await portalTargets(db,{...viewer,subject:'different-user'})).targets,[]);
 const limited=await(await call()).text();for(const privateKey of [token,'token_hash','approval_digest','identity_subject','provider_id'])assert.equal(limited.includes(privateKey),false);
 assert.equal((await call(base+'/revoke',{invitationId:prepared.invitationId})).status,200);assert.deepEqual((await portalTargets(db,viewer)).targets,[]);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 // A failed transport is never silently retried. Prepared scope cannot be changed.
 const second=await prepare();let attempted=0;
 const uncertain={async send(){attempted++;throw Error('synthetic timeout');}};
 const secondSend={invitationId:second.invitationId,approvalDigest:second.approvalDigest,explicitlyApproved:true};
 const outcome=await(await handleAdminInvitationRequest(request(base+'/send',secondSend),env,admin,uncertain)).json() as any;assert.equal(outcome.deliveryState,'uncertain');
 await assert.rejects(handleAdminInvitationRequest(request(base+'/send',secondSend),env,admin,uncertain),/Do not retry/);assert.equal(attempted,1);
 assert.equal(invitationReadiness({...env,INVITATIONS_ENABLED:'true'}).enabled,false);
 assert.equal(invitationReadiness({...env,INVITATIONS_ENABLED:'true',RESEND_API_KEY:'synthetic',RESEND_FROM:'sender@example.test'}).enabled,true);
});
