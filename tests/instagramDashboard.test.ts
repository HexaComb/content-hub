import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {setProjectPlugin} from '../src/plugins.ts';
import {getInstagramDashboard,getInstagramWorkflow,adminInstagramDashboard,recipientInstagramDashboard,upsertInstagramItem,recordInstagramDecision,handleAdminInstagramRequest,instagramDateWindows} from '../src/instagramDashboard.ts';
import {instagramMetricKind,validInstagramMetricValue,upsertInstagramItemInput} from '../src/instagramSchema.ts';
import type {InvitationEnv} from '../src/mail.ts';

test('Instagram calendar windows use target timezone, calendar months and exact kinds',()=>{
 assert.equal(instagramMetricKind('instagram.reach'),null);
 assert.equal(instagramMetricKind('ig:avg_likes_per_post'),'average_likes_per_post');
 assert.equal(instagramMetricKind('instagram.followers_growth'),null);
 const windows=instagramDateWindows('America/Los_Angeles',undefined,new Date('2026-03-01T01:00:00Z'));
 assert.equal(windows.month,'2026-02');assert.equal(windows.asOfDate,'2026-02-28');
 assert.deepEqual(windows.ranges[0],{key:'7d',start:'2026-02-22',end:'2026-03-01'});
 assert.equal(windows.ranges[3].start,'2025-08-29');
 assert.equal(instagramDateWindows('UTC','2026-03',new Date('2026-04-01T00:00:00Z')).ranges[1].start,'2026-03-01');
 assert.throws(()=>instagramDateWindows('UTC','2099-01'),/Future/);
 assert.equal(upsertInstagramItemInput.safeParse({}).success,false);
 for(const kind of ['followers','posts','average_likes_per_post','posts_per_week'] as const){
  for(const value of [-1,NaN,Infinity,null])assert.equal(validInstagramMetricValue(kind,value),false);
  assert.equal(validInstagramMetricValue(kind,0),true);
  assert.equal(validInstagramMetricValue(kind,12),true);
 }
 for(const kind of ['followers','posts'] as const){assert.equal(validInstagramMetricValue(kind,1.5),false);assert.equal(validInstagramMetricValue(kind,Number.MAX_SAFE_INTEGER+1),false);}
 for(const kind of ['average_likes_per_post','posts_per_week'] as const)assert.equal(validInstagramMetricValue(kind,1.5),true);

});

test('Instagram dashboard isolates exact metrics, histories, workflow and immutable decisions',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'theme-tests',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'theme-tests'}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())for(const statement of(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants VALUES(?,?)').bind(tenant,tenant).run();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES(?,'agent','Agent',?,'2099-01-01','[]')").bind(tenant,tenant.repeat(64)).run();
  for(const client of ['c','other']){
   await db.prepare("INSERT INTO clients VALUES(?,?,'Client','UTC')").bind(tenant,client).run();
   for(const project of ['p','sibling'])await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES(?,?,?,'Project','','active',1,'2026-11-01','2026-11-01')").bind(tenant,client,project).run();
  }
  await db.prepare("INSERT INTO client_grants VALUES(?,'agent','c')").bind(tenant).run();
  await db.prepare("INSERT INTO metrics VALUES(?,'c','m','views','Views','test','count','higher','period_total','UTC','{}','Synthetic','agent','2026-11-01')").bind(tenant).run();
  await db.prepare("INSERT INTO project_metrics VALUES(?,'c','p','m')").bind(tenant).run();
  for(const [month,end,value]of [['2026-10-01','2026-11-01',10],['2026-11-01','2026-12-01',20]])await db.prepare("INSERT INTO observations VALUES(?,'c',?,'m',?,?,1,?,'complete','{}','2026-11-11','2026-11-11','agent',?,'hash',NULL)").bind(tenant,month,month,end,value,month).run();
 }
 const env:InvitationEnv={DB:db,APP_ORIGIN:'https://reports.example.test',ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:'https://clerk.example.test',CLERK_PUBLISHABLE_KEY:'pk_test_'+btoa('clerk.example.test$').replace(/=+$/,''),CLERK_SECRET_KEY:'sk_test_synthetic'};
 const admin={issuer:env.CLERK_ISSUER!,subject:'user_admin',sessionId:'session_admin',email:'marco@hexacombllc.com'};
 const p={tenantId:'a',id:'agent',scopes:['projects:write','metrics:read','content:read','content:write']},target={clientId:'c',projectId:'p'};
 for(const key of ['followers','posts','average_likes_per_post','posts_per_week','reach']){
  await db.prepare("INSERT INTO metrics VALUES('a','c',?,?,?,'test','count','higher','snapshot','UTC','{}','Synthetic','agent','2026-11-01')").bind(key,'instagram.'+key,key).run();
  await db.prepare("INSERT INTO project_metrics VALUES('a','c','p',?)").bind(key).run();
 }
 await setProjectPlugin(db,p,{...target,key:'instagram',enabled:true,metricIds:['followers','posts','average_likes_per_post','posts_per_week','reach'],expectedRevision:0,idempotencyKey:'install-instagram'});
 const insert=async(metric:string,start:string,end:string,value:number,revision=1)=>db.prepare("INSERT INTO observations VALUES('a','c',?,?,?,?,?,?,'complete','{}','2026-11-11','2026-11-11','agent',?,'hash',?)").bind(metric+start+revision,metric,start,end,revision,value,metric+start+revision,revision>1?'Correction':null).run();
 for(const metric of ['posts','average_likes_per_post','posts_per_week','reach'])await insert(metric,'2026-10-01','2026-11-01',42);
 await insert('followers','2026-10-20','2026-10-21',100);
 await insert('followers','2026-10-20','2026-10-21',110,2);
 await insert('followers','2026-10-30','2026-10-31',120);
 const packet=await getInstagramDashboard(db,p,{...target,month:'2026-10'});
 assert.equal(packet.kpis.length,4);assert.equal(packet.kpis.find(k=>k.kind==='followers')!.value,120);
 assert.equal(packet.kpis.find(k=>k.kind==='posts')!.value,42);
 assert.equal(packet.followers.points.find(p=>p.date==='2026-10-20')!.value,110);
 assert.equal(packet.followers.points.find(p=>p.date==='2026-10-21')!.value,null);
 assert.equal(packet.followers.points.at(-1)!.date,'2026-10-31');
 assert.equal(packet.workflowAvailable,false);
 assert.ok(!JSON.stringify(packet).includes('instagram.reach'));
 await assert.rejects(getInstagramDashboard(db,{...p,scopes:['content:read']},target),/scope/);
 await assert.rejects(getInstagramDashboard(db,p,{...target,clientId:'other'}),/not available/);
 await assert.rejects(getInstagramDashboard(db,p,{...target,projectId:'sibling'}),/not enabled/);
 const viewer={...admin,subject:'viewer',email:'viewer@example.test'};
 await db.prepare("INSERT INTO invitations(id,tenant_id,client_id,project_id,recipient_email,metric_ids_json,target_revision,preview_json,approval_digest,created_by,created_at,invite_expires_at,grant_expires_at,accepted_at,accepted_identity_issuer,accepted_identity_subject) VALUES('grant','a','c','p',?,'[\"posts\"]',1,'{}','hash','agent','2026-11-01','2099-01-01','2099-01-01','2026-11-01',?,?)").bind(viewer.email,viewer.issuer,viewer.subject).run();
 const recipient=await recipientInstagramDashboard(db,viewer,'c','p','2026-10');
 assert.equal(recipient.kpis.find(k=>k.kind==='posts')!.value,42);assert.equal(recipient.kpis.find(k=>k.kind==='followers')!.metricId,null);
 assert.ok(recipient.followers.points.every(p=>p.value===null));assert.equal(recipient.workflowAvailable,false);assert.deepEqual(recipient.answers,[]);
 assert.equal('tenantId' in recipient.target,false);
 const input={...target,id:'idea-one',format:'reel' as const,title:'Actual idea',idea:'Create a real product demonstration',platform:'instagram' as const,status:'proposed' as const,contentUrl:null,evidence:null,expectedRevision:0,idempotencyKey:'create-idea'};
 const currentWindow=instagramDateWindows('UTC');
 await db.prepare("INSERT INTO observations VALUES('a','c','current-mtd','posts',?,?,1,5,'complete','{}',?,?,'agent','current-mtd','hash',NULL)").bind(currentWindow.monthStart,currentWindow.ranges[0].end,new Date().toISOString(),new Date().toISOString()).run();
 const mtd=(await getInstagramDashboard(db,p,target)).kpis.find(k=>k.kind==='posts')!;
 assert.equal(mtd.value,5);assert.equal(mtd.quality,'partial');assert.equal(mtd.sourceQuality,'complete');assert.equal(mtd.periodStart,currentWindow.monthStart);
 await db.prepare("INSERT INTO content_items(tenant_id,client_id,id,channel,account_ref,title,caption,assets_json,status,created_at,updated_at) VALUES('a','c','pending-content','instagram','test-account','Actual draft','Private caption','[]','draft','now','now')").run();
 await db.prepare("INSERT INTO content_metrics VALUES('a','c','pending-content','posts')").run();
 const pending=(await getInstagramWorkflow(db,p,target)).pending;
 assert.equal(pending.length,1);assert.equal(pending[0].format,null);assert.equal(pending[0].source,'content');assert.ok(!JSON.stringify(pending).includes('Private caption'));
 const before=(await db.prepare('SELECT * FROM observations ORDER BY tenant_id,id').all()).results;
 const created=await upsertInstagramItem(db,p,input);assert.equal(created.revision,1);
 assert.equal((await upsertInstagramItem(db,p,input)).replayed,true);
 await assert.rejects(upsertInstagramItem(db,p,{...input,idempotencyKey:'stale-idea'}),/revision/);
 await assert.rejects(upsertInstagramItem(db,p,{...input,expectedRevision:1,status:'queued',idempotencyKey:'bypass-decision'}),/requires a decision/);
 const decision={...target,id:'idea-one',answer:'yes' as const,expectedRevision:1,idempotencyKey:'answer-idea'};
 const decisions=await Promise.all([recordInstagramDecision(db,p,decision),recordInstagramDecision(db,p,decision)]);assert.equal(decisions.filter(d=>d.replayed).length,1);
 await assert.rejects(recordInstagramDecision(db,p,{...decision,answer:'no',idempotencyKey:'change-answer',expectedRevision:2}),/unanswered/);
 await assert.rejects(upsertInstagramItem(db,p,{...input,expectedRevision:2,status:'in_progress',title:'Changed silently',idempotencyKey:'rewrite-idea'}),/silently rewritten/);
 await upsertInstagramItem(db,p,{...input,expectedRevision:2,status:'in_progress',idempotencyKey:'begin-production'});
 await assert.rejects(upsertInstagramItem(db,p,{...input,expectedRevision:3,status:'completed',idempotencyKey:'no-evidence'}));
 await upsertInstagramItem(db,p,{...input,expectedRevision:3,status:'completed',contentUrl:'https://www.instagram.com/p/synthetic/',evidence:'Supplied publication receipt, test only',idempotencyKey:'complete-production'});
 const workflow=await getInstagramWorkflow(db,p,target);assert.equal(workflow.executed.length,1);assert.equal(workflow.answers.length,1);assert.equal(workflow.answers[0].answer,'yes');assert.equal(workflow.answers[0].title,'Actual idea');
 assert.equal((await adminInstagramDashboard(db,admin,env,'a','c','p','2026-10')).executed.length,1);
 assert.equal((await recipientInstagramDashboard(db,viewer,'c','p','2026-10')).executed.length,0);
 await upsertInstagramItem(db,p,{...input,id:'idea-two',idempotencyKey:'second-idea'});
 const url=env.APP_ORIGIN+'/api/admin/targets/a/c/p/plugins/instagram/ideas/idea-two/decision';
 const request=(origin=env.APP_ORIGIN!)=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({answer:'no',expectedRevision:1,idempotencyKey:'browser-no'})});
 for(const who of [null,viewer])await assert.rejects(handleAdminInstagramRequest(request(),env,who),/Administrator/);
 assert.equal((await handleAdminInstagramRequest(request('https://evil.test'),env,admin)).status,403);
 assert.equal((await handleAdminInstagramRequest(request(),env,admin)).status,200);
 const after=await getInstagramWorkflow(db,p,target);assert.equal(after.answers.length,2);assert.equal(after.ideas.length,0);
 await assert.rejects(db.prepare('DELETE FROM instagram_work_events').run(),/append-only/);
 assert.deepEqual((await db.prepare('SELECT * FROM observations ORDER BY tenant_id,id').all()).results,before);
 await db.prepare("UPDATE invitations SET revoked_at='now' WHERE id='grant'").run();
 await assert.rejects(recipientInstagramDashboard(db,viewer,'c','p','2026-10'),/not available/);
 // Invalid latest observations remain stored but cannot become plotted values.
 for(const [metric,value] of [['posts',1.5],['average_likes_per_post',-2],['posts_per_week',-1]] as const)await insert(metric,'2026-10-01','2026-11-01',value,2);
 await insert('followers','2026-10-30','2026-10-31',120.5,2);
 await insert('followers','2026-10-20','2026-10-21',-3,3);
 const invalidStored=(await db.prepare('SELECT * FROM observations ORDER BY tenant_id,id').all()).results;
 const invalid=await getInstagramDashboard(db,p,{...target,month:'2026-10'});
 for(const kpi of invalid.kpis){assert.equal(kpi.value,null);assert.equal(kpi.quality,'missing');assert.equal(kpi.sourceQuality,'complete');assert.equal(kpi.reason,'invalid_value');}
 for(const date of ['2026-10-20','2026-10-30']){const point=invalid.followers.points.find(p=>p.date===date)!;assert.equal(point.value,null);assert.equal(point.quality,'missing');assert.equal(point.reason,'invalid_value');assert.equal(point.sourceQuality,'complete');}
 assert.deepEqual((await db.prepare('SELECT * FROM observations ORDER BY tenant_id,id').all()).results,invalidStored);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
