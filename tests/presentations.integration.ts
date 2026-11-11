import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {defaultPresentation,presentationDocumentSchema} from '../src/presentationSchema.ts';
import {sha256} from '../src/domain.ts';

test('built Worker presentation MCP tools enforce scopes, exact publication, isolation and private HTTP boundaries',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'presentation-runtime',compatibilityDate:'2026-11-10',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:await readFile('.cloudflare/output/v0/workers/default/bundle/index.js','utf8')}}},env:{DB:{type:'d1',name:'presentation-runtime'}}}}]});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let sql=(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
  const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[];for(const trigger of triggers)sql=sql.replace(trigger,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();for(const trigger of triggers)await db.prepare(trigger).run();
 }
 const tokens:Record<string,string>={};
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants VALUES(?,?)').bind(tenant,'Synthetic agency '+tenant).run();
  await db.prepare("INSERT INTO clients VALUES(?,'c','Synthetic client','UTC')").bind(tenant).run();
  await db.prepare("INSERT INTO clients VALUES(?,'other','Ungranted client','UTC')").bind(tenant).run();
  for(const client of ['c','other'])await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES(?,?,'p','Synthetic project','','active',1,'2026-11-11','2026-11-11')").bind(tenant,client).run();
  for(const [id,scopes]of Object.entries({agent:['presentations:read','presentations:write','presentations:publish'],reader:['presentations:read'],writer:['presentations:write'],publisher:['presentations:publish'],nogrant:['presentations:read','presentations:write','presentations:publish']})){
   const token='synthetic_'+crypto.randomUUID().replaceAll('-','');tokens[tenant+id]=token;
   await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES(?,?,'Synthetic test',?,'2099-01-01',?)").bind(tenant,id,await sha256(token),JSON.stringify(scopes)).run();
   if(id!=='nogrant')await db.prepare("INSERT INTO client_grants VALUES(?,?,'c')").bind(tenant,id).run();
  }
 }
 const target={clientId:'c',projectId:'p'},document={...defaultPresentation(),name:'Private runtime draft'};
 const rpc=async(method:string,params:Record<string,unknown>={},key='aagent')=>{
  const response=await mf.dispatchFetch('https://example.test/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens[key],'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal(response.status,200,await response.clone().text());
  const raw=await response.text();return JSON.parse(raw.startsWith('event:')?raw.split('\n').find(line=>line.startsWith('data: '))!.slice(6):raw);
 };
 const call=async(name:string,args:Record<string,unknown>,key='aagent')=>rpc('tools/call',{name,arguments:args},key);
 const decode=(packet:any)=>{assert.equal(packet.error,undefined,JSON.stringify(packet));assert.notEqual(packet.result?.isError,true,JSON.stringify(packet));return JSON.parse(packet.result.content[0].text);};
 const denied=(packet:any)=>assert.ok(packet.error||packet.result?.isError,JSON.stringify(packet));
 const counts=async()=>Promise.all(['presentation_revisions','presentation_events','project_presentations'].map(async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{n:number}>())!.n));
 const before=await Promise.all(['projects','metrics','observations','client_grants','invitations','invitation_audit'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results));
 await t.test('tool discovery exposes three separate permission classes',async()=>{
  const expected:Record<string,string[]>={areader:['get_project_presentation','validate_project_presentation'],awriter:['restore_project_presentation','save_project_presentation_draft'],apublisher:['publish_project_presentation']};
  for(const [key,names]of Object.entries(expected)){
   const packet=await rpc('tools/list',{},key);assert.equal(packet.error,undefined,JSON.stringify(packet));
   assert.deepEqual(packet.result.tools.filter((tool:any)=>tool.name.includes('presentation')).map((tool:any)=>tool.name).sort(),names.sort());
  }
  const state=decode(await call('get_project_presentation',target,'areader'));
  assert.equal(state.revision,0);assert.equal(state.schema.type,'object');assert.match(JSON.stringify(state.schema),/metric_collection/);assert.equal(presentationDocumentSchema.safeParse(state.starter).success,true);
  assert.equal(decode(await call('validate_project_presentation',{...target,document},'areader')).persisted,false);
  denied(await call('publish_project_presentation',{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'blocked-publish'},'awriter'));
  denied(await call('save_project_presentation_draft',{...target,document,expectedRevision:0,idempotencyKey:'blocked-save'},'areader'));
  denied(await call('get_project_presentation',target,'apublisher'));
  assert.deepEqual(await counts(),[0,0,0]);
 });
 await t.test('MCP retries are atomic and no tenant or grant boundary is widened',async()=>{
  const save={...target,document,expectedRevision:0,idempotencyKey:'runtime-save'};
  const results=(await Promise.all([call('save_project_presentation_draft',save),call('save_project_presentation_draft',save)])).map(decode);
  assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);assert.deepEqual(await counts(),[1,1,1]);
  denied(await call('save_project_presentation_draft',{...save,document:{...document,name:'Changed payload'}}));
  denied(await call('save_project_presentation_draft',{...save,idempotencyKey:'runtime-stale'}));
  denied(await call('save_project_presentation_draft',{...save,tenantId:'b'}));
  denied(await call('get_project_presentation',target,'anogrant'));
  denied(await call('get_project_presentation',{...target,clientId:'other'}));
  denied(await call('get_project_presentation',{...target,projectId:'missing'}));
  assert.equal(decode(await call('get_project_presentation',target,'bagent')).revision,0);
  denied(await call('get_project_presentation',{...target,revision:1},'bagent'));
  assert.equal(decode(await call('get_project_presentation',target,'areader')).published,null);
  assert.deepEqual(await counts(),[1,1,1]);
 });
 await t.test('publish chooses only the exact draft and restore remains private until a second publish',async()=>{
  const publish={...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'runtime-publish'};
  assert.equal(decode(await call('publish_project_presentation',publish,'apublisher')).revision,2);
  assert.equal(decode(await call('publish_project_presentation',publish,'apublisher')).replayed,true);
  assert.equal(decode(await call('save_project_presentation_draft',{...target,document:{...document,name:'Unpublished replacement'},expectedRevision:2,idempotencyKey:'runtime-next-save'},'awriter')).revision,3);
  denied(await call('publish_project_presentation',{...publish,expectedRevision:3,idempotencyKey:'runtime-old-draft'},'apublisher'));
  assert.deepEqual(await counts(),[3,3,1]);
  let state=decode(await call('get_project_presentation',target,'areader'));assert.equal(state.published.name,'Private runtime draft');assert.equal(state.draft.name,'Unpublished replacement');
  assert.equal(decode(await call('restore_project_presentation',{...target,sourceRevision:1,expectedRevision:3,idempotencyKey:'runtime-restore'},'awriter')).revision,4);
  state=decode(await call('get_project_presentation',target,'areader'));assert.equal(state.publishedRevision,2);assert.equal(state.draftRevision,4);
  assert.equal(decode(await call('publish_project_presentation',{...target,sourceRevision:4,expectedRevision:4,idempotencyKey:'runtime-publish-restored'},'apublisher')).revision,5);
  state=decode(await call('get_project_presentation',target,'areader'));assert.equal(state.publishedRevision,5);assert.equal(state.isDraftPublished,true);
  assert.deepEqual(await counts(),[5,5,1]);
  const after=await Promise.all(['projects','metrics','observations','client_grants','invitations','invitation_audit'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results));assert.deepEqual(after,before);
 });
 await t.test('HTTP pages never grant access through URLs, service credentials, role headers or legacy cookies',async()=>{
  for(const path of ['/api/targets/c/p/presentation','/api/targets/c/p/presentation?revision=1','/api/targets/c/p/presentation?preview=1','/api/targets/c/p/presentation?tenant=a','/api/admin/targets/a/c/p/presentation-state','/api/admin/targets/a/c/p/presentation?revision=1']){
   const response=await mf.dispatchFetch('https://example.test'+path,{headers:{Authorization:'Bearer '+tokens.aagent,'X-User-Email':'marco@hexacombllc.com','X-Role':'super_admin',Cookie:'__Host-ch_session='+'a'.repeat(43)}});
   assert.ok([401,403].includes(response.status),path+' '+response.status);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.match(response.headers.get('Content-Security-Policy')!,/frame-ancestors 'none'/);
   const body=await response.text();assert.ok(!body.includes('runtime draft')&&!body.includes('draftRevision'),body);
  }
  for(const action of ['publish','restore']){
   const response=await mf.dispatchFetch('https://example.test/api/admin/targets/a/c/p/presentation/'+action,{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',Authorization:'Bearer '+tokens.aagent},body:JSON.stringify({sourceRevision:4,expectedRevision:5,idempotencyKey:'forged-admin-'+action,email:'marco@hexacombllc.com',role:'super_admin'})});assert.ok([401,403].includes(response.status));
  }
  assert.equal((await mf.dispatchFetch('https://example.test/mcp',{headers:{Origin:'https://evil.test',Authorization:'Bearer '+tokens.aagent}})).status,403);
  assert.deepEqual(await counts(),[5,5,1]);
 });
 await t.test('revoked clients and credentials cannot reuse old receipts',async()=>{
  await db.prepare("DELETE FROM client_grants WHERE tenant_id='a' AND principal_id='publisher'").run();
  denied(await call('publish_project_presentation',{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'runtime-publish'},'apublisher'));
  await db.prepare("UPDATE principals SET revoked_at='2026-11-11' WHERE tenant_id='a' AND id='agent'").run();
  assert.equal((await mf.dispatchFetch('https://example.test/mcp',{headers:{Authorization:'Bearer '+tokens.aagent}})).status,401);
  assert.deepEqual(await counts(),[5,5,1]);
 });
});
