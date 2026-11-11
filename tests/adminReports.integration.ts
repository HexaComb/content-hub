import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {adminOverview,adminReport,handleAdminReadRequest} from '../src/adminReports.ts';
import {portalTargets,portalReport} from '../src/portal.ts';
import type {InvitationEnv} from '../src/mail.ts';

test('admin overview and reports are read-only, gated and separate from client invitations',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'admin-tests',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'admin-tests'}}}}]});t.after(()=>mf.dispose());
 const database=await mf.getD1Database('DB');const db=database as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())for(const statement of(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s=>s.trim()).filter(Boolean))await database.prepare(statement).run();
 const env:InvitationEnv={DB:db,APP_ORIGIN:'https://reports.example.test',ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:'https://clerk.example.test',CLERK_PUBLISHABLE_KEY:'pk_test_'+Buffer.from('clerk.example.test$').toString('base64').replace(/=+$/,''),CLERK_SECRET_KEY:'sk_test_synthetic'};
 const admin={issuer:env.CLERK_ISSUER!,subject:'user_admin',sessionId:'session_admin',email:'marco@hexacombllc.com'};
 assert.deepEqual((await adminOverview(db,admin,env)).entries,[]);
 assert.deepEqual((await adminOverview(db,admin,env)).counts,{clients:0,projects:0,workspaces:0});
 const noRead={prepare(){throw new Error('Database must not be queried before authorization');}} as unknown as D1Database;
 for(const identity of [null,{...admin,email:'viewer@example.test'},{...admin,email:'marco+admin@hexacombllc.com'},{...admin,issuer:'https://evil.example.test'},{...admin,email:'viewer@example.test',role:'super_admin'}]){
  await assert.rejects(adminOverview(noRead,identity,env),/Administrator access/);
  await assert.rejects(adminReport(noRead,identity,env,'t','c','p','2026-11'),/Administrator access/);
 }
 await assert.rejects(adminOverview(noRead,admin,{...env,ADMIN_ACCESS_ENABLED:'false'}),/Administrator access/);
 for(const tenant of ['a','b']){
  await database.prepare('INSERT INTO tenants VALUES (?,?)').bind(tenant,`Workspace ${tenant}`).run();
  await database.prepare("INSERT INTO clients(tenant_id,id,name,timezone) VALUES (?,'c',?,'UTC')").bind(tenant,`Client ${tenant}`).run();
  await database.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES (?,'principal','Synthetic',?,'2099-01-01','[]')").bind(tenant,tenant.repeat(64)).run();
  await database.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES (?,'c','p',?,'','archived',1,'2026-11-01','2026-11-01')").bind(tenant,`Project ${tenant}`).run();
  await database.prepare("INSERT INTO metrics(tenant_id,client_id,id,key,label,category,unit,direction,semantics,timezone,dimensions_json,definition,created_by,created_at) VALUES(?,'c','m','views','Views','test','count','higher','period_total','UTC','{}','Synthetic','principal','2026-11-01')").bind(tenant).run();
  await database.prepare("INSERT INTO project_metrics VALUES (?,'c','p','m')").bind(tenant).run();
  for(const [i,start,end,value] of [[1,'2026-10-01','2026-11-01',10],[2,'2026-11-01','2026-12-01',20]] as const)await database.prepare("INSERT INTO observations(tenant_id,client_id,id,metric_id,period_start,period_end,revision,value,quality,source_json,collected_at,recorded_at,recorded_by,idempotency_key,payload_hash) VALUES (?,'c',?,'m',?,?,1,?,'complete','{\"private\":\"never disclose\"}','2026-11-11','2026-11-11','principal',?,?)").bind(tenant,`o${i}`,start,end,tenant==='a'?value:value*100,`key${i}`,'f'.repeat(64)).run();
 }
 await database.prepare("INSERT INTO clients(tenant_id,id,name,timezone) VALUES ('a','empty','Empty client','UTC')").run();
 const overview=await adminOverview(db,admin,env);assert.deepEqual(overview.counts,{clients:3,projects:2,workspaces:2});assert.equal(overview.entries.length,3);assert.equal(overview.entries.find(e=>e.clientId==='empty')?.project,null);assert.equal(overview.nextOffset,null);
 assert.deepEqual((await adminOverview(db,{...admin,email:'christian@unreelviews.com'},env)).counts,overview.counts);
 const report=await adminReport(db,admin,env,'a','c','p','2026-11');assert.equal(report.target.tenantId,'a');assert.equal(report.target.status,'archived');assert.equal(report.metrics[0].current?.value,20);assert.equal(report.metrics[0].previous?.value,10);assert.equal(report.metrics[0].delta,10);assert.equal(report.metrics[0].relativePercent,100);assert.equal(report.previousMonth,'2026-10');assert.equal(JSON.stringify(report).includes('never disclose'),false);
 assert.equal((await adminReport(db,admin,env,'b','c','p','2026-11')).metrics[0].current?.value,2000);
 await assert.rejects(adminReport(db,admin,env,'a','missing','p','2026-11'),/not available/);
 await assert.rejects(adminReport(db,admin,env,'a','c','p','invalid'),/valid reporting month/);
 assert.deepEqual(await portalTargets(db,admin),{targets:[]});await assert.rejects(portalReport(db,admin,'c','p','2026-11'),/not available/);
 assert.equal((await handleAdminReadRequest(new Request('https://reports.example.test/api/admin/overview',{method:'POST'}),env,admin))?.status,405);
 assert.equal((await handleAdminReadRequest(new Request('https://reports.example.test/api/admin/overview'),env,admin))?.status,200);
 await assert.rejects(handleAdminReadRequest(new Request('https://reports.example.test/api/admin/overview?offset=-1'),env,admin),/Invalid overview page/);
 // Pagination never silently truncates an application-wide project list.
 for(let i=0;i<101;i++)await database.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES ('a','c',?,?,'','active',1,'2026-11-01','2026-11-01')").bind(`extra${String(i).padStart(3,'0')}`,`Project ${i}`).run();
 const first=await adminOverview(db,admin,env);assert.equal(first.entries.length,100);assert.equal(first.nextOffset,100);const second=await adminOverview(db,admin,env,first.nextOffset!);assert.equal(second.entries.length,4);assert.equal(second.nextOffset,null);
 assert.deepEqual((await adminReport(db,admin,env,'a','c','extra000','2026-11')).metrics,[]);
});
