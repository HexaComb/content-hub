import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {sha256} from '../src/domain.ts';
import {defaultPresentation,presentationDocumentSchema,presentationMetricIds,type PresentationDocument} from '../src/presentationSchema.ts';
import {themePresets} from '../src/themeSchema.ts';
import {portalReport} from '../src/portal.ts';

// Writes exercise the actual built MCP transport and SQL transaction. Recipient
// projections use the same D1 fixture and a trusted synthetic identity, without
// bypassing or pretending to test a live Clerk session.
test('built Worker MCP publishes one shared design to both private plugin projections without widening browser access',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'shared-presentation-runtime',compatibilityDate:'2026-11-10',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:await readFile('.cloudflare/output/v0/workers/default/bundle/index.js','utf8')}}},env:{DB:{type:'d1',name:'shared-presentation-runtime'}}}}]});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let sql=(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
  const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[];for(const trigger of triggers)sql=sql.replace(trigger,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  for(const trigger of triggers)await db.prepare(trigger).run();
 }
 const token='synthetic_'+crypto.randomUUID().replaceAll('-','');
 await db.prepare("INSERT INTO tenants VALUES('a','Synthetic agency')").run();
 await db.prepare("INSERT INTO clients VALUES('a','c','Synthetic client','UTC')").run();
 await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES('a','c','p','Synthetic project','','active',1,'2026-11-11','2026-11-11')").run();
 const scopes=['presentations:read','presentations:write','presentations:publish'];
 await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES('a','agent','Synthetic MCP agent',?,'2099-01-01',?)").bind(await sha256(token),JSON.stringify(scopes)).run();
 await db.prepare("INSERT INTO client_grants VALUES('a','agent','c')").run();
 for(const [id,key,value]of [['seo-data','gsc.clicks',51419],['instagram-data','instagram.followers',61631]] as const){
  await db.prepare("INSERT INTO metrics VALUES('a','c',?,?,?,'test','count','higher','period_total','UTC','{}','Synthetic','agent','2026-11-01')").bind(id,key,id).run();
  await db.prepare("INSERT INTO project_metrics VALUES('a','c','p',?)").bind(id).run();
  await db.prepare("INSERT INTO observations(tenant_id,client_id,id,metric_id,period_start,period_end,revision,value,quality,source_json,collected_at,recorded_at,recorded_by,idempotency_key,payload_hash) VALUES('a','c',?,?,'2026-11-01','2026-12-01',1,?,'complete','{\"private\":\"MUST NOT RETURN PROVENANCE\"}','2026-11-11','2026-11-11','agent',?,'synthetic')").bind(id,id,value,id).run();
 }
 for(const key of ['seo','instagram'])await db.prepare("INSERT INTO project_plugins VALUES('a','c','p',?,1,1,'[\"seo-data\",\"instagram-data\"]','2026-11-11','synthetic')").bind(key).run();
 const identity={issuer:'https://clerk.example.test',subject:'viewer',sessionId:'synthetic-session',email:'viewer@example.test'};
 await db.prepare("INSERT INTO invitations(id,tenant_id,client_id,project_id,recipient_email,metric_ids_json,target_revision,preview_json,approval_digest,created_by,created_at,invite_expires_at,grant_expires_at,accepted_at,accepted_identity_issuer,accepted_identity_subject) VALUES('grant','a','c','p',?,'[\"seo-data\",\"instagram-data\"]',1,'{}','synthetic','agent','2026-11-01','2099-01-01','2099-01-01','2026-11-01',?,'viewer')").bind(identity.email,identity.issuer).run();
 const snapshot=()=>Promise.all(['principals','client_grants','project_plugins','project_metrics','metrics','observations','invitations','invitation_audit'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results));
 const before=await snapshot();
 const target={clientId:'c',projectId:'p'};
 const original:PresentationDocument={...defaultPresentation(themePresets.night),name:'Shared runtime design',sections:['brand','seo','instagram','metrics'],nodes:[
  {id:'brand',type:'text',role:'title',text:'SHARED BRAND'},
  {id:'seo',page:'seo',type:'text',role:'body',text:'SEO RUNTIME COPY'},
  {id:'instagram',page:'instagram',type:'text',role:'body',text:'INSTAGRAM RUNTIME COPY'},
  {id:'metrics',type:'comparison',metricIds:['seo-data','instagram-data']},
 ]};
 const rpc=async(method:string,params:Record<string,unknown>={})=>{
  const response=await mf.dispatchFetch('https://example.test/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal(response.status,200,await response.clone().text());const raw=await response.text();return JSON.parse(raw.startsWith('event:')?raw.split('\n').find(line=>line.startsWith('data: '))!.slice(6):raw);
 };
 const call=(name:string,args:Record<string,unknown>)=>rpc('tools/call',{name,arguments:args});
 const decode=(packet:any)=>{assert.equal(packet.error,undefined,JSON.stringify(packet));assert.notEqual(packet.result?.isError,true,JSON.stringify(packet));return JSON.parse(packet.result.content[0].text);};
 const denied=(packet:any)=>assert.ok(packet.error||packet.result?.isError,JSON.stringify(packet));
 const counts=()=>Promise.all(['project_presentations','presentation_revisions','presentation_events'].map(async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{n:number}>())!.n));
 async function checkPages(revision:number,document:PresentationDocument|null){
  for(const plugin of ['seo','instagram'] as const){
   const packet=await portalReport(db,identity,'c','p','2026-11',plugin,true),view=packet.presentation!;
   assert.equal(view.revision,revision);assert.equal(view.plugin,plugin);assert.deepEqual([...view.pages!].sort(),['instagram','seo']);
   assert.deepEqual(packet.metrics.map(m=>m.id),[plugin==='seo'?'seo-data':'instagram-data']);
   assert.equal(packet.metrics[0].current!.value,plugin==='seo'?51419:61631);
   assert.equal(JSON.stringify(packet).includes('MUST NOT RETURN PROVENANCE'),false);
   if(!document){assert.equal(view.document,null);assert.equal(view.mode,'default');continue;}
   assert.equal(view.mode,'published');assert.deepEqual(view.document!.theme,document.theme);assert.equal(view.document!.name,document.name);
   assert.equal(JSON.stringify(view.document).includes(plugin==='seo'?'INSTAGRAM RUNTIME COPY':'SEO RUNTIME COPY'),false);
   assert.deepEqual(presentationMetricIds(view.document!),[plugin==='seo'?'seo-data':'instagram-data']);
   assert.equal(presentationDocumentSchema.safeParse(view.document).success,true);
  }
 }
 await t.test('MCP schema and links expose page targeting but keep a single authoring document and scopes',async()=>{
  const list=await rpc('tools/list');const names=list.result.tools.map((tool:any)=>tool.name);
  assert.ok(names.includes('get_project_presentation'));assert.ok(names.includes('publish_project_presentation'));assert.equal(names.includes('set_project_plugin'),false);
  const state=decode(await call('get_project_presentation',target));assert.equal(state.sharedDesign,true);assert.equal(state.revision,0);
  assert.match(JSON.stringify(state.schema),/instagram/);assert.match(JSON.stringify(state.schema),/shared/);
  assert.equal(state.clientPath,'/client?client=c&project=p');
  for(const plugin of ['seo','instagram']){assert.equal(state.pagePaths[plugin].clientPath,'/client?client=c&project=p&plugin='+plugin);assert.equal(state.pagePaths[plugin].previewPath,null);}
  assert.equal(decode(await call('validate_project_presentation',{...target,document:original})).persisted,false);
  denied(await call('save_project_presentation_draft',{...target,document:original,plugin:'seo',expectedRevision:0,idempotencyKey:'invalid-page-head'}));
  denied(await call('validate_project_presentation',{...target,document:{...original,nodes:original.nodes.map(n=>n.id==='seo'?{...n,page:'facebook'}:n)}}));
  assert.deepEqual(await counts(),[0,0,0]);
 });
 await t.test('one MCP lifecycle propagates publish and restore to both projections; drafts never go live',async()=>{
  const save={...target,document:original,expectedRevision:0,idempotencyKey:'shared-runtime-save'};
  assert.equal(decode(await call('save_project_presentation_draft',save)).revision,1);assert.equal(decode(await call('save_project_presentation_draft',save)).replayed,true);
  await checkPages(0,null);assert.deepEqual(await counts(),[1,1,1]);
  assert.equal(decode(await call('publish_project_presentation',{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'shared-runtime-publish'})).revision,2);await checkPages(2,original);
  const replacement={...original,name:'Replacement runtime design',theme:themePresets.editorial};
  assert.equal(decode(await call('save_project_presentation_draft',{...target,document:replacement,expectedRevision:2,idempotencyKey:'shared-runtime-replacement'})).revision,3);await checkPages(2,original);
  denied(await call('publish_project_presentation',{...target,sourceRevision:1,expectedRevision:3,idempotencyKey:'shared-runtime-wrong-draft'}));await checkPages(2,original);
  assert.equal(decode(await call('publish_project_presentation',{...target,sourceRevision:3,expectedRevision:3,idempotencyKey:'shared-runtime-next-publish'})).revision,4);await checkPages(4,replacement);
  assert.equal(decode(await call('restore_project_presentation',{...target,sourceRevision:1,expectedRevision:4,idempotencyKey:'shared-runtime-restore'})).revision,5);await checkPages(4,replacement);
  assert.equal(decode(await call('publish_project_presentation',{...target,sourceRevision:5,expectedRevision:5,idempotencyKey:'shared-runtime-restore-publish'})).revision,6);await checkPages(6,original);
  const state=decode(await call('get_project_presentation',target));assert.deepEqual(state.draft,original);assert.deepEqual(state.published,original);assert.equal(state.publishedRevision,6);assert.equal(state.history.length,6);
  assert.deepEqual(await counts(),[1,6,6]);assert.deepEqual(await snapshot(),before);
 });
 await t.test('private page HTTP routes reject service tokens and forged roles for both plugins, draft previews and shared state',async()=>{
  const headers={Authorization:'Bearer '+token,'X-Role':'super_admin','X-User-Email':'marco@hexacombllc.com',Cookie:'__Host-ch_session='+'a'.repeat(43)};
  for(const plugin of ['seo','instagram'] as const)for(const path of [
   `/api/targets/c/p/presentation?plugin=${plugin}`,
   `/api/targets/c/p/presentation?plugin=${plugin}&revision=1`,
   `/api/targets/c/p/presentation?plugin=${plugin}&tenant=a`,
   `/api/targets/c/p/presentation?plugin=${plugin}&plugin=${plugin}`,
   `/api/admin/targets/a/c/p/presentation?plugin=${plugin}`,
   `/api/admin/targets/a/c/p/presentation?plugin=${plugin}&revision=1`,
   '/api/admin/targets/a/c/p/presentation-state',
  ]){
   const response=await mf.dispatchFetch('https://example.test'+path,{headers});assert.ok([401,403].includes(response.status),path+' '+response.status);
   assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
   const raw=await response.text();assert.equal(raw.includes('RUNTIME COPY'),false);assert.equal(raw.includes('Shared runtime design'),false);assert.equal(raw.includes('draftRevision'),false);
  }
  for(const action of ['publish','restore']){
   const response=await mf.dispatchFetch('https://example.test/api/admin/targets/a/c/p/presentation/'+action+'?plugin=instagram',{method:'POST',headers:{...headers,Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({sourceRevision:5,expectedRevision:6,idempotencyKey:'forged-shared-'+action,role:'super_admin'})});assert.ok([401,403].includes(response.status));
  }
  const legacy=await portalReport(db,identity,'c','p','2026-11',undefined,true);assert.equal(legacy.metrics.length,2);assert.equal(legacy.presentation!.plugin,null);assert.deepEqual(legacy.presentation!.document,original);
  assert.deepEqual(await counts(),[1,6,6]);assert.deepEqual(await snapshot(),before);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
});
