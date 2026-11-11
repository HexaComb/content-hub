import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {defaultPresentation,filterPresentation,presentationDocumentSchema,presentationMetricIds,savePresentationInput,type PresentationDocument,type PresentationNode,type PresentationPlugin} from '../src/presentationSchema.ts';
import {getProjectPresentation,saveProjectPresentationDraft,publishProjectPresentation,restoreProjectPresentation,readPresentationState,handleAdminPresentationRequest} from '../src/presentations.ts';
import {portalReport} from '../src/portal.ts';
import {themePresets} from '../src/themeSchema.ts';
import type {InvitationEnv} from '../src/mail.ts';
import type {Principal} from '../src/auth.ts';

const target={clientId:'c',projectId:'p'};
const principal:Principal={tenantId:'a',id:'agent',scopes:['presentations:read','presentations:write','presentations:publish']};
const origin='https://reports.example.test';
const viewer={issuer:'https://clerk.example.test',subject:'viewer',sessionId:'viewer-session',email:'viewer@example.test'};
const admin={...viewer,subject:'admin',sessionId:'admin-session',email:'marco@hexacombllc.com'};
const metricIds=['seo-main','seo-secret','ig-main','ig-secret','custom'];
const definitions=[['seo-main','gsc.clicks',731011],['seo-secret','seo.impressions',731012],['ig-main','instagram.followers',942021],['ig-secret','ig.views',942022],['custom','custom.conversions',853031]] as const;
const pageDocument=(name='Shared launch'):PresentationDocument=>({...defaultPresentation(themePresets.night),name,sections:['shared-copy','seo-band','instagram-band','shared-grid','both-comparison'],nodes:[
 {id:'shared-copy',type:'text',role:'title',text:'COMMON BRAND COPY'},
 {id:'seo-band',page:'seo',type:'band',tone:'surface',space:'normal',children:['seo-copy','seo-stat','seo-private']},
 {id:'seo-copy',page:'shared',type:'text',role:'body',text:'SEO-ONLY EDITORIAL COPY'},
 {id:'seo-stat',type:'metric',metricId:'seo-main',variant:'stat'},
 {id:'seo-private',type:'metric',metricId:'seo-secret',variant:'stat'},
 {id:'instagram-band',page:'instagram',type:'band',tone:'surface',space:'normal',children:['instagram-copy','instagram-stat','instagram-private']},
 {id:'instagram-copy',page:'shared',type:'text',role:'body',text:'INSTAGRAM-ONLY EDITORIAL COPY'},
 {id:'instagram-stat',type:'metric',metricId:'ig-main',variant:'stat'},
 {id:'instagram-private',type:'metric',metricId:'ig-secret',variant:'stat'},
 {id:'shared-grid',page:'shared',type:'grid',split:'wide-left',gap:'generous',children:['shared-seo','shared-instagram']},
 {id:'shared-seo',type:'metric',metricId:'seo-main',variant:'statement'},
 {id:'shared-instagram',type:'metric',metricId:'ig-main',variant:'statement'},
 {id:'both-comparison',type:'comparison',metricIds:[...metricIds]},
]});

async function setup(t:TestContext){
 const mf=new Miniflare({workers:[{config:{name:'shared-presentations',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'shared-presentations'}}}}]});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let sql=(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
  const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[];for(const trigger of triggers)sql=sql.replace(trigger,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  for(const trigger of triggers)await db.prepare(trigger).run();
 }
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants VALUES(?,?)').bind(tenant,tenant).run();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES(?,'agent','Synthetic',?,'2099-01-01','[]')").bind(tenant,tenant.repeat(64)).run();
  for(const client of ['c','other']){
   await db.prepare("INSERT INTO clients VALUES(?,?,'Synthetic client','UTC')").bind(tenant,client).run();
   for(const project of ['p','sibling'])await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES(?,?,?,'Synthetic project','','active',1,'2026-11-01','2026-11-01')").bind(tenant,client,project).run();
  }
  await db.prepare("INSERT INTO client_grants VALUES(?,'agent','c')").bind(tenant).run();
  for(const [id,key,value]of definitions){
   await db.prepare("INSERT INTO metrics VALUES(?,'c',?,?,?,'synthetic','count','higher','period_total','UTC','{}','Synthetic','agent','2026-11-01')").bind(tenant,id,key,id+' label').run();
   await db.prepare("INSERT INTO project_metrics VALUES(?,'c','p',?)").bind(tenant,id).run();
   for(const [start,end,factor]of [['2026-10-01','2026-11-01',1],['2026-11-01','2026-12-01',2]] as const)await db.prepare("INSERT INTO observations(tenant_id,client_id,id,metric_id,period_start,period_end,revision,value,quality,source_json,collected_at,recorded_at,recorded_by,idempotency_key,payload_hash) VALUES(?,'c',?,?,?,?,1,?,'complete','{\"secret\":\"PRIVATE PROVENANCE\"}','2026-11-11','2026-11-11','agent',?,'synthetic')").bind(tenant,id+start,id,start,end,value*factor*(tenant==='a'?1:100),id+start).run();
  }
  // Intentionally seed legacy bad namespace mappings: the read boundary must
  // still exclude a metric from the wrong plugin, even for an administrator.
  await db.prepare("INSERT INTO project_plugins VALUES(?,'c','p','seo',1,1,?,'2026-11-11','synthetic')").bind(tenant,JSON.stringify(['seo-main','seo-secret','ig-main','custom'])).run();
  await db.prepare("INSERT INTO project_plugins VALUES(?,'c','p','instagram',1,1,?,'2026-11-11','synthetic')").bind(tenant,JSON.stringify(['ig-main','ig-secret','seo-main','custom'])).run();
 }
 await grant(db);
 const env:InvitationEnv={DB:db,APP_ORIGIN:origin,ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:viewer.issuer,CLERK_PUBLISHABLE_KEY:'pk_test_'+Buffer.from('clerk.example.test$').toString('base64').replace(/=+$/,''),CLERK_SECRET_KEY:'sk_test_synthetic'};
 return {db,env};
}
async function grant(db:D1Database,tenant='a',ids=metricIds,key='grant-'+tenant){
 await db.prepare("INSERT INTO invitations(id,tenant_id,client_id,project_id,recipient_email,metric_ids_json,target_revision,preview_json,approval_digest,created_by,created_at,invite_expires_at,grant_expires_at,accepted_at,accepted_identity_issuer,accepted_identity_subject) VALUES(?,?,'c','p',?,?,1,'{}','synthetic','agent','2026-11-01','2099-01-01','2099-01-01','2026-11-01',?,'viewer')").bind(key,tenant,viewer.email,JSON.stringify(ids),viewer.issuer).run();
}
async function published(db:D1Database,document=pageDocument()){
 await saveProjectPresentationDraft(db,principal,{...target,document,expectedRevision:0,idempotencyKey:'shared-initial-save'});
 await publishProjectPresentation(db,principal,{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'shared-initial-publish'});
}
const readPage=(db:D1Database,plugin?:PresentationPlugin)=>portalReport(db,viewer,'c','p','2026-11',plugin,true);
const counts=(db:D1Database)=>Promise.all(['project_presentations','presentation_revisions','presentation_events'].map(async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{n:number}>())!.n));
const business=(db:D1Database)=>Promise.all(['principals','client_grants','invitations','projects','project_metrics','project_plugins','metrics','observations','theme_events'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results));
function validProjection(document:PresentationDocument,allowed:Set<string>,plugin:PresentationPlugin){
 const result=filterPresentation(document,allowed,plugin),parsed=presentationDocumentSchema.safeParse(result);
 assert.equal(parsed.success,true,parsed.success?'':parsed.error.message);
 assert.ok(presentationMetricIds(result).every(id=>allowed.has(id)));
 assert.ok(result.nodes.every(n=>!n.page||n.page==='shared'||n.page===plugin));
 assert.deepEqual(result.theme,document.theme);
 assert.equal(result.width,document.width);
 return result;
}

test('shared page schema is backwards compatible and page selection cannot create an independent design',()=>{
 assert.equal(presentationDocumentSchema.safeParse(defaultPresentation()).success,true);
 assert.equal(presentationDocumentSchema.safeParse(pageDocument()).success,true);
 const forms:PresentationNode[]=[{id:'leaf',type:'text',role:'body',text:'Text'},{id:'leaf',type:'divider',style:'line'},{id:'leaf',type:'metric',metricId:'seo-main',variant:'stat'},{id:'leaf',type:'comparison',metricIds:[]},{id:'leaf',type:'metric_collection',variant:'stat'}];
 for(const node of forms)for(const page of [undefined,'shared','seo','instagram'] as const)assert.equal(presentationDocumentSchema.safeParse({...defaultPresentation(),sections:['leaf'],nodes:[{...node,page}]}).success,true);
 for(const page of ['facebook','',null,{},['seo']])assert.equal(presentationDocumentSchema.safeParse({...defaultPresentation(),sections:['leaf'],nodes:[{...forms[0],page}]}).success,false);
 assert.equal(savePresentationInput.safeParse({...target,document:pageDocument(),expectedRevision:0,idempotencyKey:'shared-save',plugin:'seo'}).success,false);
});

test('page projection prunes whole excluded subtrees and repairs every metric-subset graph without modifying the shared source',()=>{
 const original=pageDocument(),before=JSON.stringify(original);
 for(const plugin of ['seo','instagram'] as const)for(let mask=0;mask<32;mask++){
  const allowed=new Set(metricIds.filter((_,i)=>mask&(1<<i)));
  const result=validProjection(original,allowed,plugin),raw=JSON.stringify(result);
  assert.ok(raw.includes('COMMON BRAND COPY'));
  assert.equal(raw.includes('SEO-ONLY EDITORIAL COPY'),plugin==='seo');
  assert.equal(raw.includes('INSTAGRAM-ONLY EDITORIAL COPY'),plugin==='instagram');
  const kept=Number(allowed.has('seo-main'))+Number(allowed.has('ig-main'));
  const grid=result.nodes.find(n=>n.id==='shared-grid');
  assert.equal(grid?.type,kept===0?undefined:kept===1?'stack':'grid');
 }
 assert.equal(JSON.stringify(original),before);
 const onlySeo:PresentationDocument={...original,sections:['private'],nodes:[{id:'private',page:'seo',type:'stack',gap:'normal',align:'left',children:['nested']},{id:'nested',page:'shared',type:'text',role:'body',text:'MUST NOT ESCAPE EXCLUDED PARENT'}]};
 const empty=validProjection(onlySeo,new Set(),'instagram');
 assert.equal(JSON.stringify(empty).includes('MUST NOT ESCAPE'),false);
 assert.deepEqual(presentationMetricIds(empty),[]);assert.equal(empty.nodes.length,1);
 const pluginless=filterPresentation(original,new Set(['seo-main']));
 assert.deepEqual(presentationMetricIds(pluginless),['seo-main']);assert.equal(presentationDocumentSchema.safeParse(pluginless).success,true);
 assert.ok(JSON.stringify(pluginless).includes('SEO-ONLY EDITORIAL COPY'));assert.ok(JSON.stringify(pluginless).includes('INSTAGRAM-ONLY EDITORIAL COPY'));
 const legacy=defaultPresentation();for(const plugin of ['seo','instagram'] as const){const projected=validProjection(legacy,new Set(),plugin);assert.deepEqual(projected.sections,legacy.sections);assert.deepEqual([...projected.nodes].sort((a,b)=>a.id.localeCompare(b.id)),[...legacy.nodes].sort((a,b)=>a.id.localeCompare(b.id)));}
});

test('one shared draft/publish/restore changes both plugin pages together and never duplicates the project head or changes permissions',async t=>{
 const {db}=await setup(t),before=await business(db),original=pageDocument();
 await saveProjectPresentationDraft(db,principal,{...target,document:original,expectedRevision:0,idempotencyKey:'lifecycle-save-one'});
 for(const plugin of ['seo','instagram'] as const){const packet=await readPage(db,plugin);assert.equal(packet.presentation!.mode,'default');assert.equal(packet.presentation!.revision,0);assert.equal(packet.presentation!.document,null);}
 await publishProjectPresentation(db,principal,{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'lifecycle-publish-one'});
 const both=await Promise.all(['seo','instagram'].map(plugin=>readPage(db,plugin as PresentationPlugin)));
 assert.deepEqual(both.map(r=>r.presentation!.revision),[2,2]);assert.deepEqual(both[0].presentation!.document!.theme,both[1].presentation!.document!.theme);
 const next={...pageDocument('Private replacement'),theme:themePresets.editorial};
 await saveProjectPresentationDraft(db,principal,{...target,document:next,expectedRevision:2,idempotencyKey:'lifecycle-save-two'});
 for(const plugin of ['seo','instagram'] as const){const view=(await readPage(db,plugin)).presentation!;assert.equal(view.revision,2);assert.equal(view.document!.name,original.name);assert.deepEqual(view.document!.theme,original.theme);}
 await publishProjectPresentation(db,principal,{...target,sourceRevision:3,expectedRevision:3,idempotencyKey:'lifecycle-publish-two'});
 for(const plugin of ['seo','instagram'] as const){const view=(await readPage(db,plugin)).presentation!;assert.equal(view.revision,4);assert.deepEqual(view.document!.theme,themePresets.editorial);}
 await restoreProjectPresentation(db,principal,{...target,sourceRevision:1,expectedRevision:4,idempotencyKey:'lifecycle-restore-one'});
 for(const plugin of ['seo','instagram'] as const){const view=(await readPage(db,plugin)).presentation!;assert.equal(view.revision,4);assert.deepEqual(view.document!.theme,themePresets.editorial);}
 await publishProjectPresentation(db,principal,{...target,sourceRevision:5,expectedRevision:5,idempotencyKey:'lifecycle-publish-restore'});
 for(const plugin of ['seo','instagram'] as const){const view=(await readPage(db,plugin)).presentation!;assert.equal(view.revision,6);assert.deepEqual(view.document!.theme,original.theme);}
 assert.deepEqual(await counts(db),[1,6,6]);assert.deepEqual(await business(db),before);
 assert.equal((await readPresentationState(db,'b',target)).revision,0);assert.equal((await readPresentationState(db,'a',{clientId:'other',projectId:'p'})).revision,0);assert.equal((await readPresentationState(db,'a',{clientId:'c',projectId:'sibling'})).revision,0);
 const state=await getProjectPresentation(db,principal,target);assert.equal(state.sharedDesign,true);assert.deepEqual(state.draft,original);assert.deepEqual(state.published,original);
 assert.match(state.clientPath,/^\/client\?client=c&project=p$/);
 for(const plugin of ['seo','instagram']){assert.match(state.pagePaths[plugin].clientPath,new RegExp('plugin='+plugin));assert.match(state.pagePaths[plugin].previewPath!,new RegExp('plugin='+plugin+'&preview=5'));}
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('recipient pages isolate copy, metric identifiers and values despite legacy incompatible plugin mappings and subset grants',async t=>{
 const {db}=await setup(t);await published(db);
 const expected={seo:['custom','seo-main','seo-secret'],instagram:['custom','ig-main','ig-secret']};
 for(const plugin of ['seo','instagram'] as const){
  const packet=await readPage(db,plugin),raw=JSON.stringify(packet),opposite=plugin==='seo'?'ig-':'seo-';
  assert.deepEqual(packet.metrics.map(m=>m.id).sort(),expected[plugin]);assert.equal(packet.presentation!.plugin,plugin);assert.deepEqual([...packet.presentation!.pages!].sort(),['instagram','seo']);
  assert.equal(raw.includes(opposite+'main'),false);assert.equal(raw.includes(opposite+'secret'),false);assert.equal(raw.includes('PRIVATE PROVENANCE'),false);
  assert.equal(raw.includes(plugin==='seo'?'INSTAGRAM-ONLY EDITORIAL COPY':'SEO-ONLY EDITORIAL COPY'),false);
  for(const [id,,value]of definitions){if(id.startsWith(opposite)){assert.equal(raw.includes(String(value)),false);assert.equal(raw.includes(String(value*2)),false);}}
  assert.ok(presentationMetricIds(packet.presentation!.document!).every(id=>expected[plugin].includes(id)));
  assert.equal(presentationDocumentSchema.safeParse(packet.presentation!.document).success,true);
  assert.equal('draftRevision'in packet.presentation!,false);assert.equal('history'in packet.presentation!,false);assert.equal('tenantId'in packet.target,false);
 }
 await db.prepare("UPDATE invitations SET metric_ids_json='[\"ig-main\",\"seo-main\"]' WHERE id='grant-a'").run();
 for(const plugin of ['seo','instagram'] as const){const packet=await readPage(db,plugin),ids=plugin==='seo'?['seo-main']:['ig-main'];assert.deepEqual(packet.metrics.map(m=>m.id),ids);assert.deepEqual(presentationMetricIds(packet.presentation!.document!),ids);assert.equal(JSON.stringify(packet).includes('-secret'),false);}
 await db.prepare("UPDATE invitations SET metric_ids_json='[]' WHERE id='grant-a'").run();
 for(const plugin of ['seo','instagram'] as const){const packet=await readPage(db,plugin);assert.deepEqual(packet.metrics,[]);assert.deepEqual(presentationMetricIds(packet.presentation!.document!),[]);assert.equal(presentationDocumentSchema.safeParse(packet.presentation!.document).success,true);}
});

test('legacy pluginless views remain readable and explicit pages fail closed for disabled, uninstalled, ambiguous or unavailable targets',async t=>{
 const {db}=await setup(t);await published(db);
 const packet=await readPage(db);assert.deepEqual(packet.metrics.map(m=>m.id).sort(),[...metricIds].sort());assert.equal(packet.presentation!.plugin,null);assert.ok(JSON.stringify(packet).includes('SEO-ONLY'));assert.ok(JSON.stringify(packet).includes('INSTAGRAM-ONLY'));
 await db.prepare("UPDATE project_plugins SET enabled=0 WHERE tenant_id='a' AND key='seo'").run();await assert.rejects(readPage(db,'seo'),/not enabled/);
 assert.deepEqual((await readPage(db)).presentation!.pages,['instagram']);assert.equal((await readPage(db)).metrics.length,5);
 await db.prepare("DELETE FROM project_plugins WHERE tenant_id='a' AND key='instagram'").run();await assert.rejects(readPage(db,'instagram'),/not enabled/);
 assert.deepEqual((await readPage(db)).presentation!.pages,[]);
 await assert.rejects(portalReport(db,viewer,'c','sibling','2026-11','seo',true),/not available/);
 await assert.rejects(portalReport(db,viewer,'other','p','2026-11','seo',true),/not available/);
 await grant(db,'b');await assert.rejects(readPage(db),/not available/);
 await db.prepare("UPDATE invitations SET revoked_at='2026-11-11' WHERE id='grant-b'").run();
 await db.prepare("UPDATE invitations SET grant_expires_at='2000-01-01' WHERE id='grant-a'").run();await assert.rejects(readPage(db),/not available/);
});

// Inject a concurrent change after the published document has been read. The
// response must be based on the final permission snapshot and do no later reads.
function changeAfterPresentation(db:D1Database,change:()=>Promise<unknown>){
 let changed=false,finished=false;const queries:string[]=[];
 const wrapped={prepare(sql:string){assert.equal(finished,false,'A database query followed the final authorization snapshot');queries.push(sql);const statement=db.prepare(sql);
  if(sql.includes("r.operation='publish'"))return {bind(...args:unknown[]){const bound=statement.bind(...args);return {async first(){const result=await bound.first();assert.equal(changed,false);changed=true;await change();return result;}};}};
  if(sql.includes('pp.key AS plugin_key'))return {bind(...args:unknown[]){const bound=statement.bind(...args);return {async all(){const result=await bound.all();finished=true;return result;}};}};
  return statement;
 }} as unknown as D1Database;
 return {db:wrapped,check(){assert.equal(changed,true);assert.equal(finished,true);assert.match(queries.at(-1)!,/pp.key AS plugin_key/);}};
}

test('final recipient snapshot rejects plugin disable/uninstall after presentation reads',async t=>{
 const {db}=await setup(t);await published(db);
 for(const action of ["UPDATE project_plugins SET enabled=0 WHERE tenant_id='a' AND key='instagram'","DELETE FROM project_plugins WHERE tenant_id='a' AND key='instagram'"]){
  await db.prepare("UPDATE project_plugins SET enabled=1 WHERE tenant_id='a' AND key='instagram'").run();
  const racing=changeAfterPresentation(db,()=>db.prepare(action).run());await assert.rejects(readPage(racing.db,'instagram'),/not enabled/);racing.check();
 }
});

test('final recipient snapshot intersects current plugin mapping, project mapping and surviving grants and returns fresh page links',async t=>{
 const {db}=await setup(t);await published(db);
 const originalPlugins=await db.prepare("SELECT key,metric_ids_json FROM project_plugins WHERE tenant_id='a'").all<{key:string;metric_ids_json:string}>();
 for(const [change,expected]of [
  ["UPDATE project_plugins SET metric_ids_json='[\"ig-main\"]' WHERE tenant_id='a' AND key='instagram'",['ig-main']],
  ["UPDATE project_plugins SET metric_ids_json='[\"seo-main\"]' WHERE tenant_id='a' AND key='instagram'",[]],
  ["UPDATE invitations SET metric_ids_json='[\"ig-main\"]' WHERE id='grant-a'",['ig-main']],
 ] as const){
  for(const plugin of originalPlugins.results)await db.prepare("UPDATE project_plugins SET metric_ids_json=? WHERE tenant_id='a' AND key=?").bind(plugin.metric_ids_json,plugin.key).run();
  await db.prepare("UPDATE invitations SET metric_ids_json=? WHERE id='grant-a'").bind(JSON.stringify(metricIds)).run();
  const racing=changeAfterPresentation(db,()=>db.prepare(change).run()),packet=await readPage(racing.db,'instagram');racing.check();
  assert.deepEqual(packet.metrics.map(m=>m.id).sort(),[...expected].sort());assert.deepEqual(presentationMetricIds(packet.presentation!.document!).sort(),[...expected].sort());assert.equal(JSON.stringify(packet).includes('seo-main'),false);
 }
 for(const plugin of originalPlugins.results)await db.prepare("UPDATE project_plugins SET metric_ids_json=? WHERE tenant_id='a' AND key=?").bind(plugin.metric_ids_json,plugin.key).run();
 const removed=changeAfterPresentation(db,()=>db.prepare("DELETE FROM project_metrics WHERE tenant_id='a' AND metric_id='ig-main'").run());
 const packet=await readPage(removed.db,'instagram');removed.check();assert.deepEqual(packet.metrics,[]);assert.deepEqual(presentationMetricIds(packet.presentation!.document!),[]);
 const links=changeAfterPresentation(db,()=>db.prepare("UPDATE project_plugins SET enabled=0 WHERE tenant_id='a' AND key='seo'").run());assert.deepEqual((await readPage(links.db,'instagram')).presentation!.pages,['instagram']);links.check();
 const revoked=changeAfterPresentation(db,()=>db.prepare("UPDATE invitations SET revoked_at='2026-11-11' WHERE id='grant-a'").run());await assert.rejects(readPage(revoked.db,'instagram'),/not available/);revoked.check();
});

test('administrator page projections remain isolated, while shared draft/history state requires verified administrator access',async t=>{
 const {db,env}=await setup(t);await published(db);
 await saveProjectPresentationDraft(db,principal,{...target,document:{...pageDocument('PRIVATE DRAFT'),theme:themePresets.editorial},expectedRevision:2,idempotencyKey:'admin-private-draft'});
 const base=origin+'/api/admin/targets/a/c/p/presentation';
 for(const plugin of ['seo','instagram'] as const)for(const revision of ['', '&revision=3']){
  const packet=await(await handleAdminPresentationRequest(new Request(base+'?month=2026-11&plugin='+plugin+revision),env,admin)).json() as any;
  const ids=plugin==='seo'?['custom','seo-main','seo-secret']:['custom','ig-main','ig-secret'];
  assert.deepEqual(packet.metrics.map((m:any)=>m.id).sort(),ids);assert.ok(presentationMetricIds(packet.presentation.document).every(id=>ids.includes(id)));
  assert.equal(JSON.stringify(packet).includes(plugin==='seo'?'INSTAGRAM-ONLY':'SEO-ONLY'),false);assert.equal(packet.presentation.revision,revision?3:2);
  assert.equal(packet.presentation.mode,revision?'preview':'published');assert.equal(presentationDocumentSchema.safeParse(packet.presentation.document).success,true);
 }
 const state=await(await handleAdminPresentationRequest(new Request(base+'-state'),env,admin)).json() as any;assert.equal(state.revision,3);assert.equal(state.draft.name,'PRIVATE DRAFT');assert.ok(JSON.stringify(state.draft).includes('SEO-ONLY'));assert.ok(JSON.stringify(state.draft).includes('INSTAGRAM-ONLY'));
 const legacy=await(await handleAdminPresentationRequest(new Request(base+'?month=2026-11'),env,admin)).json() as any;assert.equal(legacy.metrics.length,5);assert.equal(legacy.presentation.plugin,null);
 for(const query of ['plugin=seo&plugin=instagram','plugin=seo&plugin=seo','plugin=','plugin=SEO','plugin=facebook','plugin=null','plugin=seo%00','plugin=seo&month=2026-11&month=2026-10','plugin=seo&revision=2&revision=3','plugin=seo&tenant=b','plugin=seo&preview=3'])await assert.rejects(handleAdminPresentationRequest(new Request(base+'?'+query),env,admin));
 const noRead={prepare(){throw Error('Unauthorized query before admin check');}} as unknown as D1Database;
 for(const who of [null,viewer,{...viewer,role:'super_admin'},{...admin,issuer:'https://evil.test'},{...admin,email:'marco+admin@hexacombllc.com'}])for(const suffix of ['?plugin=seo','?plugin=instagram&revision=3','-state'])await assert.rejects(handleAdminPresentationRequest(new Request(base+suffix),{...env,DB:noRead},who),/Administrator access/);
 await assert.rejects(handleAdminPresentationRequest(new Request(base+'?plugin=seo'),{...env,DB:noRead,ADMIN_ACCESS_ENABLED:'false'},admin),/Administrator access/);
 await db.prepare("UPDATE project_plugins SET enabled=0 WHERE tenant_id='a' AND key='seo'").run();await assert.rejects(handleAdminPresentationRequest(new Request(base+'?plugin=seo'),env,admin),/not enabled/);
 await db.prepare("DELETE FROM project_plugins WHERE tenant_id='a' AND key='instagram'").run();await assert.rejects(handleAdminPresentationRequest(new Request(base+'?plugin=instagram&revision=3'),env,admin),/not enabled/);
 assert.deepEqual(await counts(db),[1,3,3]);
});
