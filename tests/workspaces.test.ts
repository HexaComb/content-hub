import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { createClient, updateClient, createProject, updateProject, listProjects } from '../src/workspaces.ts';
import { createClientInput } from '../src/workspaceSchemas.ts';

test('workspace validation rejects malformed timezone and cross-tenant fields',()=>{
  const input={clientId:'c',name:'Name',timezone:'bad/timezone',expectedRevision:0,idempotencyKey:'abcdefgh'};
  assert.equal(createClientInput.safeParse(input).success,false);
  assert.equal(createClientInput.safeParse({...input,timezone:'UTC',tenantId:'evil'}).success,false);
});
test('workspace transactions, grants, revisions, audit and isolation',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'workspaces-test',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}},env:{DB:{type:'d1',name:'workspace-db'}}}}]});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of ['0001_initial.sql','0003_workspaces.sql','0004_target_types.sql']) {
   let sql=(await readFile(`migrations/${file}`,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
   const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g) ?? [];
   for (const trigger of triggers) sql=sql.replace(trigger,'');
   for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
   for (const trigger of triggers) await db.prepare(trigger).run();
 }
 for(const tenant of ['a','b']){
   await db.prepare('INSERT INTO tenants VALUES (?,?)').bind(tenant,tenant).run();
   await db.prepare('INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,revoked_at,scopes_json) VALUES (?,?,?,?,?,?,?)').bind(tenant,'agent','agent',tenant.repeat(64),'2099-01-01',null,'[]').run();
 }
 const p={tenantId:'a',id:'agent',scopes:['clients:write','projects:write','projects:read']};
 const client={clientId:'c',name:'Client',timezone:'UTC',expectedRevision:0 as const,idempotencyKey:'client-create'};
 await assert.rejects(()=>createClient(db,{...p,scopes:[]},client),/scope/);
 const first=await createClient(db,p,client);
 assert.equal(first.revision,1);
 assert.equal((await createClient(db,p,client)).replayed,true);
 await assert.rejects(()=>createClient(db,p,{...client,name:'Changed'}),/Idempotency/);
 assert.ok(await db.prepare("SELECT 1 FROM client_grants WHERE tenant_id='a' AND client_id='c'").first());
 await updateClient(db,p,{...client,name:'New',expectedRevision:1,idempotencyKey:'client-update'});
 await assert.rejects(()=>updateClient(db,p,{...client,expectedRevision:1,idempotencyKey:'client-stale'}),/revision/);
 assert.equal((await db.prepare("SELECT name FROM clients WHERE tenant_id='a' AND id='c'").first<{name:string}>())?.name,'New');
 await createClient(db,{...p,tenantId:'b'},client);
 const project={kind:'one_off_project' as const,clientId:'c',projectId:'project',name:'Project',description:'Test',status:'active' as const,metricIds:[],expectedRevision:0 as const,idempotencyKey:'project-create'};
 const writes=await Promise.all([createProject(db,p,project),createProject(db,p,project)]);
 assert.equal(writes.filter(r=>r.replayed).length,1);
 await assert.rejects(()=>updateProject(db,p,{...project,expectedRevision:1,metricIds:['wrong-metric'],idempotencyKey:'invalid-link'}),/membership/);
 const list=await listProjects(db,p,{clientId:'c',limit:50});
 assert.equal(list.items.length,1);
 assert.equal(list.items[0].revision,1);
 assert.equal((await listProjects(db,{...p,tenantId:'b'},{clientId:'c',limit:50})).items.length,0);
 await assert.rejects(()=>createProject(db,{...p,scopes:['projects:read']},project),/scope/);
 await db.prepare("INSERT INTO clients VALUES ('a','ungranted','Hidden','UTC')").run();
 await assert.rejects(()=>updateClient(db,p,{...client,clientId:'ungranted',expectedRevision:1}),/not available/);
 assert.equal((await db.prepare("SELECT count(*) n FROM workspace_events WHERE tenant_id='a'").first<{n:number}>())?.n,3);
 const instagram={...project,kind:'instagram_account' as const,projectId:'instagram',platformAccountRef:'@public.account',idempotencyKey:'instagram-create'};
 await assert.rejects(()=>createProject(db,p,{...instagram,platformAccountRef:undefined}),/public account reference/);
 await assert.rejects(()=>createProject(db,p,{...instagram,platformAccountRef:'https:\/\/example.com?token=secret'}));
 await createProject(db,p,instagram);
 await updateProject(db,p,{...instagram,name:'Updated display name',expectedRevision:1,idempotencyKey:'instagram-update'});
 await assert.rejects(()=>updateProject(db,p,{...instagram,platformAccountRef:'another_account',expectedRevision:2,idempotencyKey:'identity-change'}),/immutable target identity/);
 await assert.rejects(()=>updateProject(db,p,{...instagram,kind:'one_off_project',expectedRevision:2,idempotencyKey:'kind-change'}),/immutable target identity/);
 await assert.rejects(()=>db.prepare("UPDATE projects SET platform_account_ref='different' WHERE tenant_id='a' AND id='instagram'").run(),/immutable/);
 const targets=await listProjects(db,p,{clientId:'c',limit:50});
 assert.equal(targets.items[0].kind,'instagram_account');
 assert.equal(targets.items[0].platformAccountRef,'@public.account');
 assert.equal(targets.items[0].revision,2);
});
