import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {setProjectPlugin} from '../src/plugins.ts';
import {getInstagramDashboard,getInstagramWorkflow,recipientInstagramDashboard,upsertInstagramItem,recordInstagramDecision,adminInstagramDashboard} from '../src/instagramDashboard.ts';
import {upsertInstagramItemInput} from '../src/instagramSchema.ts';

test('independent Instagram isolation, revocation race, concurrent decisions and monthly-only history',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'instagram-security',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'instagram-security'}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())for(const statement of(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const principal=(tenantId:string)=>({tenantId,id:'agent',scopes:['projects:write','metrics:read','content:read','content:write']});
 const target={clientId:'c',projectId:'p'};
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants VALUES(?,?)').bind(tenant,tenant).run();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES(?,'agent','Agent',?,'2099-01-01','[]')").bind(tenant,tenant.repeat(64)).run();
  await db.prepare("INSERT INTO clients VALUES(?,'c','Client','UTC')").bind(tenant).run();
  await db.prepare("INSERT INTO client_grants VALUES(?,'agent','c')").bind(tenant).run();
  for(const project of ['p','sibling']){
   await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES(?,'c',?,'Project','','active',1,'2026-11-01','2026-11-01')").bind(tenant,project).run();
  }
  await db.prepare("INSERT INTO metrics VALUES(?,'c','followers','instagram.followers','Followers','test','count','higher','snapshot','UTC','{}','Synthetic','agent','2026-11-01')").bind(tenant).run();
  await db.prepare("INSERT INTO project_metrics VALUES(?,'c','p','followers')").bind(tenant).run();
  await db.prepare("INSERT INTO observations VALUES(?,'c','monthly','followers','2026-10-01','2026-11-01',1,?,'complete','{\"secret\":\"PROVENANCE_SECRET\"}','2026-11-01','2026-11-01','agent','monthly-key','hash',NULL)").bind(tenant,tenant==='a'?100:900).run();
  for(const project of ['p','sibling'])await setProjectPlugin(db,principal(tenant),{clientId:'c',projectId:project,key:'instagram',enabled:true,metricIds:project==='p'?['followers']:[],expectedRevision:0,idempotencyKey:'install-'+project});
 }
 const input={...target,id:'same-id',format:'reel' as const,title:'PRIVATE_A',idea:'PRIVATE_IDEA_A',platform:'instagram' as const,status:'proposed' as const,contentUrl:null,evidence:null,expectedRevision:0,idempotencyKey:'create-item'};
 await upsertInstagramItem(db,principal('a'),input);
 await upsertInstagramItem(db,principal('b'),{...input,title:'PRIVATE_B'});
 assert.equal((await getInstagramWorkflow(db,principal('a'),target)).ideas[0].title,'PRIVATE_A');
 assert.equal((await getInstagramWorkflow(db,principal('b'),target)).ideas[0].title,'PRIVATE_B');
 assert.deepEqual((await getInstagramWorkflow(db,principal('a'),{...target,projectId:'sibling'})).ideas,[]);
 await assert.rejects(recordInstagramDecision(db,principal('a'),{...target,projectId:'sibling',id:input.id,answer:'yes',expectedRevision:1,idempotencyKey:'wrong-project'}),/revision/);
 const results=await Promise.allSettled(['yes','no'].map(answer=>recordInstagramDecision(db,principal('a'),{...target,id:input.id,answer:answer as 'yes'|'no',expectedRevision:1,idempotencyKey:'race-'+answer})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await getInstagramWorkflow(db,principal('a'),target)).answers.length,1);
 assert.equal((await getInstagramWorkflow(db,principal('b'),target)).answers.length,0);
 const packet=await getInstagramDashboard(db,principal('a'),{...target,month:'2026-10'});
 assert.equal(packet.kpis.length,4);assert.equal(packet.kpis[0].value,100);assert.ok(packet.followers.points.every(p=>p.value===null));assert.ok(!JSON.stringify(packet).includes('PROVENANCE_SECRET'));
 assert.equal((await getInstagramDashboard(db,principal('b'),{...target,month:'2026-10'})).kpis[0].value,900);
 await db.prepare("UPDATE metrics SET timezone='America/Los_Angeles' WHERE tenant_id='a' AND id='followers'").run();
 const mismatch=await getInstagramDashboard(db,principal('a'),{...target,month:'2026-10'});assert.equal(mismatch.kpis[0].value,null);assert.equal(mismatch.kpis[0].reason,'timezone_mismatch');
 await db.prepare("UPDATE metrics SET timezone='UTC' WHERE tenant_id='a' AND id='followers'").run();
 await db.prepare("INSERT INTO metrics VALUES('a','c','duplicate','instagram.follower_count','Followers','test','count','higher','snapshot','UTC','{}','Synthetic','agent','2026-11-01')").run();
 await db.prepare("INSERT INTO project_metrics VALUES('a','c','p','duplicate')").run();
 await db.prepare(`UPDATE project_plugins SET metric_ids_json='["followers","duplicate"]' WHERE tenant_id='a' AND project_id='p'`).run();
 const ambiguous=await getInstagramDashboard(db,principal('a'),{...target,month:'2026-10'});assert.equal(ambiguous.kpis[0].value,null);assert.equal(ambiguous.kpis[0].reason,'ambiguous_metric');
 await db.prepare(`UPDATE project_plugins SET metric_ids_json='["followers"]' WHERE tenant_id='a' AND project_id='p'`).run();
 const identity={issuer:'https://clerk.example.test',subject:'viewer',sessionId:'session',email:'viewer@example.test'};
 const grant=async(tenant:string)=>db.prepare("INSERT INTO invitations(id,tenant_id,client_id,project_id,recipient_email,metric_ids_json,target_revision,preview_json,approval_digest,created_by,created_at,invite_expires_at,grant_expires_at,accepted_at,accepted_identity_issuer,accepted_identity_subject) VALUES(? ,?,'c','p',?,'[\"followers\"]',1,'{}','hash','agent','2026-11-01','2099-01-01','2099-01-01','2026-11-01',?,?)").bind('grant-'+tenant,tenant,identity.email,identity.issuer,identity.subject).run();
 await grant('a');
 const recipient=await recipientInstagramDashboard(db,identity,'c','p','2026-10');assert.equal(recipient.kpis[0].value,100);assert.ok(!JSON.stringify(recipient).includes('PRIVATE_'));assert.equal('tenantId' in recipient.target,false);
 await grant('b');await assert.rejects(recipientInstagramDashboard(db,identity,'c','p','2026-10'),/not available/);
 await db.prepare("UPDATE invitations SET revoked_at='now' WHERE id='grant-b'").run();
 // Revoke at the last permission read, after the observations were already loaded.
 let intercepted=false;
 const racingDb={prepare(sql:string){const statement=db.prepare(sql);if(sql.includes('CASE WHEN pp.enabled=1'))return {bind(...args:unknown[]){const bound=statement.bind(...args);return {async all(){intercepted=true;await db.prepare("UPDATE invitations SET revoked_at='now' WHERE id='grant-a'").run();return bound.all();}};}};return statement;}} as unknown as D1Database;
 await assert.rejects(recipientInstagramDashboard(racingDb,identity,'c','p','2026-10'),/not available/);assert.equal(intercepted,true);
 await db.prepare("UPDATE invitations SET revoked_at=NULL WHERE id='grant-a'").run();
 const mappingDb={prepare(sql:string){const statement=db.prepare(sql);if(sql.includes('CASE WHEN pp.enabled=1'))return {bind(...args:unknown[]){const bound=statement.bind(...args);return {async all(){await db.prepare("UPDATE project_plugins SET metric_ids_json='[]' WHERE tenant_id='a'").run();return bound.all();}};}};return statement;}} as unknown as D1Database;
 const removed=await recipientInstagramDashboard(mappingDb,identity,'c','p','2026-10');assert.equal(removed.kpis[0].value,null);assert.equal(removed.kpis[0].metricId,null);assert.ok(removed.followers.points.every(p=>p.value===null));
 const noRead={prepare(){throw new Error('Unauthorized database access');}} as unknown as D1Database;
 await assert.rejects(adminInstagramDashboard(noRead,null,{DB:noRead},'a','c','p'),/Administrator/);
 for(const contentUrl of ['javascript:alert(1)','http://instagram.com/p/x','https://user:pass@instagram.com/p/x','data:text/html,x'])assert.equal(upsertInstagramItemInput.safeParse({...input,status:'completed',contentUrl,evidence:'Synthetic evidence'}).success,false);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
