import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {defaultPresentation,filterPresentation,presentationDocumentSchema,presentationMetricIds,savePresentationInput,selectPresentationInput,type PresentationDocument,type PresentationNode} from '../src/presentationSchema.ts';
import {getProjectPresentation,validateProjectPresentation,saveProjectPresentationDraft,publishProjectPresentation,restoreProjectPresentation,readPresentationState,readPublishedPresentation,handleAdminPresentationRequest,isAdminPresentationPath} from '../src/presentations.ts';
import {portalReport} from '../src/portal.ts';
import {adminReport} from '../src/adminReports.ts';
import {getHumanIdentity,type HumanAuthAdapter} from '../src/humanAuth.ts';
import {scopeArray} from '../src/oauthAccess.ts';
import {TOOL_SCOPES} from '../src/oauthTools.ts';
import type {InvitationEnv} from '../src/mail.ts';
import type {Principal} from '../src/auth.ts';

const target={clientId:'c',projectId:'p'};
const principal:Principal={tenantId:'a',id:'agent',scopes:['presentations:read','presentations:write','presentations:publish']};
const origin='https://reports.example.test';
const identity={issuer:'https://clerk.example.test',subject:'viewer',sessionId:'session_viewer',email:'viewer@example.test'};
const admin={...identity,subject:'admin',sessionId:'session_admin',email:'marco@hexacombllc.com'};
function doc(name='Private draft'):PresentationDocument{return {...defaultPresentation(),name};}
function graph(nodes:PresentationNode[],sections=[nodes[0].id]):PresentationDocument{return {...doc(),nodes,sections};}
function metricDocument():PresentationDocument{return graph([
 {id:'main',type:'stack',gap:'normal',align:'left',children:['visible','hidden','compare','all']},
 {id:'visible',type:'metric',metricId:'m',variant:'statement'},
 {id:'hidden',type:'metric',metricId:'secret-metric-id',variant:'stat'},
 {id:'compare',type:'comparison',metricIds:['m','secret-metric-id']},
 {id:'all',type:'metric_collection',variant:'stat'},
]);}
async function setup(t:TestContext){
 const mf=new Miniflare({workers:[{config:{name:'presentation-tests',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'presentation-tests'}}}}]});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let sql=(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
  const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[];for(const trigger of triggers)sql=sql.replace(trigger,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  for(const trigger of triggers)await db.prepare(trigger).run();
 }
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants VALUES(?,?)').bind(tenant,tenant).run();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES(?,'agent','Agent',?,'2099-01-01','[]')").bind(tenant,tenant.repeat(64)).run();
  for(const client of ['c','other']){
   await db.prepare("INSERT INTO clients VALUES(?,?,'Client','UTC')").bind(tenant,client).run();
   for(const project of ['p','sibling'])await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES(?,?,?,'Project','','active',1,'2026-11-01','2026-11-01')").bind(tenant,client,project).run();
   for(const metric of ['m','secret-metric-id','unlinked'])await db.prepare("INSERT INTO metrics VALUES(?,?,?,?,?,'test','count','higher','period_total','UTC','{}','Synthetic','agent','2026-11-01')").bind(tenant,client,client==='c'?metric:'other-'+metric,metric,metric==='secret-metric-id'?'Confidential metric':metric).run();
   for(const metric of ['m','secret-metric-id'])await db.prepare("INSERT INTO project_metrics VALUES(?,?,'p',?)").bind(tenant,client,client==='c'?metric:'other-'+metric).run();
  }
  await db.prepare("INSERT INTO client_grants VALUES(?,'agent','c')").bind(tenant).run();
  for(const metric of ['m','secret-metric-id'])for(const [month,end,value]of [['2026-10-01','2026-11-01',10],['2026-11-01','2026-12-01',20]] as const)await db.prepare("INSERT INTO observations VALUES(?,'c',?,?,?, ?,1,?,'complete','{\"internal\":\"PRIVATE PROVENANCE\"}','2026-11-11','2026-11-11','agent',?,'hash',NULL)").bind(tenant,metric+month,metric,month,end,value,metric+month).run();
 }
 const env:InvitationEnv={DB:db,APP_ORIGIN:origin,ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:identity.issuer,CLERK_PUBLISHABLE_KEY:'pk_test_'+Buffer.from('clerk.example.test$').toString('base64').replace(/=+$/,''),CLERK_SECRET_KEY:'sk_test_synthetic'};
 return {db,env};
}
async function grant(db:D1Database,key='grant',metricIds=['m'],tenant='a'){
 await db.prepare("INSERT INTO invitations(id,tenant_id,client_id,project_id,recipient_email,metric_ids_json,target_revision,preview_json,approval_digest,created_by,created_at,invite_expires_at,grant_expires_at,delivery_state,accepted_at,accepted_identity_issuer,accepted_identity_subject) VALUES(?,?,'c','p','viewer@example.test',?,1,'{}','synthetic','agent','2026-11-01','2099-01-01','2099-01-01','accepted','2026-11-01',?,'viewer')").bind(key,tenant,JSON.stringify(metricIds),identity.issuer).run();
}
async function counts(db:D1Database){return Promise.all(['presentation_revisions','presentation_events','project_presentations'].map(async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{n:number}>())!.n));}
async function businessSnapshot(db:D1Database){return Promise.all(['observations','metrics','project_metrics','projects','client_grants','invitations','invitation_audit','project_themes','theme_events'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results));}

// Deterministic domain tests do not require a Worker build or a browser.
test('presentation schema rejects code, assets, unbounded graphs and invalid references',()=>{
 assert.equal(presentationDocumentSchema.safeParse(defaultPresentation()).success,true);
 const bad:unknown[]=[{...doc(),script:'alert(1)'},{...doc(),css:'body{}'},{...doc(),html:'<iframe/>'},{...doc(),url:'https://tracker.test'},
  {...doc(),theme:{...doc().theme,brand:{...doc().theme.brand,logo:{dataUrl:'data:image/png;base64,AA==',alt:'logo'}}}},
  graph([{id:'a',type:'text',role:'title',text:'x'.repeat(1001)}]),
  {...doc(),sections:[]}, {...doc(),sections:Array(13).fill('intro')},
  graph([{id:'same',type:'text',role:'body',text:'a'},{id:'same',type:'text',role:'body',text:'b'}]),
  graph([{id:'root',type:'stack',gap:'normal',align:'left',children:['missing']}]),
  graph([{id:'root',type:'stack',gap:'normal',align:'left',children:['root']}]),
  graph([{id:'a',type:'stack',gap:'normal',align:'left',children:['b']},{id:'b',type:'stack',gap:'normal',align:'left',children:['a']}]),
  graph([{id:'a',type:'stack',gap:'normal',align:'left',children:['b','b']},{id:'b',type:'divider',style:'line'}]),
  graph([{id:'a',type:'divider',style:'line'},{id:'orphan',type:'divider',style:'line'}]),
  graph([{id:'a',type:'divider',style:'line'}],['a','a']),
  graph([{id:'a',type:'stack',gap:'normal',align:'left',children:['b']},{id:'b',type:'band',tone:'page',space:'normal',children:['c']},{id:'c',type:'divider',style:'line'}]),
  graph([{id:'a',type:'comparison',metricIds:['m','m']}]),
 ];
 for(const input of bad)assert.equal(presentationDocumentSchema.safeParse(input).success,false,JSON.stringify(input));
 for(const extra of [{src:'https://tracker.test'}, {onclick:'alert(1)'},{style:'display:none'},{value:999},{unit:'fake'},{children:[]}])assert.equal(presentationDocumentSchema.safeParse(graph([{id:'a',type:'text',role:'body',text:'Plain text',...extra} as PresentationNode])).success,false);
 for(const count of [6,7]){
  const nodes:PresentationNode[]=Array.from({length:count},(_,i)=>i===count-1?{id:`n${i}`,type:'divider',style:'line'}:{id:`n${i}`,type:'stack',gap:'normal',align:'left',children:[`n${i+1}`]});
  assert.equal(presentationDocumentSchema.safeParse(graph(nodes)).success,count===6);
 }
 const many=(n:number,text:string)=>graph([{id:'root',type:'stack',gap:'normal',align:'left',children:Array.from({length:Math.ceil(n/12)},(_,i)=>`g${i}`)},...Array.from({length:Math.ceil(n/12)},(_,i)=>({id:`g${i}`,type:'stack' as const,gap:'normal' as const,align:'left' as const,children:Array.from({length:Math.min(12,n-i*12)},(_,j)=>`text${i*12+j}`)})),...Array.from({length:n},(_,i)=>({id:`text${i}`,type:'text' as const,role:'body' as const,text}))]);
 assert.equal(presentationDocumentSchema.safeParse(many(72,'short')).success,true); // Exactly 79 nodes.
 assert.equal(presentationDocumentSchema.safeParse(many(73,'short')).success,false); // 81 nodes.
 assert.equal(presentationDocumentSchema.safeParse(many(45,'x'.repeat(1000))).success,false);
 assert.equal(presentationDocumentSchema.safeParse(many(30,'界'.repeat(800))).success,false); // UTF-8 byte budget, not character count.
 const eighty=many(72,'short');(eighty.nodes[0] as Extract<PresentationNode,{type:'stack'}>).children.push('extra');eighty.nodes.push({id:'extra',type:'divider',style:'line'});assert.equal(eighty.nodes.length,80);assert.equal(presentationDocumentSchema.safeParse(eighty).success,true);
 const collections=(n:number)=>graph([{id:'root',type:'stack',gap:'normal',align:'left',children:Array.from({length:n},(_,i)=>`collection${i}`)},...Array.from({length:n},(_,i)=>({id:`collection${i}`,type:'metric_collection' as const,variant:'stat' as const}))]);
 assert.equal(presentationDocumentSchema.safeParse(collections(2)).success,true);
 assert.equal(presentationDocumentSchema.safeParse(collections(3)).success,false);
 // Text that resembles HTML is accepted as data and must be escaped by the renderer.
 assert.equal(presentationDocumentSchema.safeParse(graph([{id:'text',type:'text',role:'body',text:'<script>" & </script>'}])).success,true);
 for(const revision of [-1,0.5,Number.MAX_SAFE_INTEGER,Infinity])assert.equal(savePresentationInput.safeParse({...target,document:doc(),expectedRevision:revision,idempotencyKey:'test-key'}).success,false);
 for(const sourceRevision of [0,-1,0.5,Number.MAX_SAFE_INTEGER])assert.equal(selectPresentationInput.safeParse({...target,sourceRevision,expectedRevision:0,idempotencyKey:'test-key'}).success,false);
 assert.equal(savePresentationInput.safeParse({...target,document:doc(),expectedRevision:0,idempotencyKey:'test-key',tenantId:'b'}).success,false);
});

test('recipient projection removes forbidden metric IDs without mutating published content',()=>{
 const original=metricDocument(),before=JSON.stringify(original),filtered=filterPresentation(original,new Set(['m']));
 assert.equal(JSON.stringify(original),before);
 assert.deepEqual(presentationMetricIds(filtered),['m']);
 assert.equal(JSON.stringify(filtered).includes('secret-metric-id'),false);
 assert.equal(presentationDocumentSchema.safeParse(filtered).success,true);
 assert.deepEqual(presentationMetricIds(filterPresentation(original,new Set())),[]);
});

test('presentation reads serialize the complete schema and keep scope/client/project/tenant boundaries',async t=>{
 const {db}=await setup(t);
 const read=await getProjectPresentation(db,principal,target);
 assert.equal(read.revision,0);assert.equal(read.draft,null);assert.equal(read.previewPath,null);assert.equal(read.schema.type,'object');
 assert.match(JSON.stringify(read.schema),/metric_collection/);assert.match(JSON.stringify(read.schema),/additionalProperties/);
 assert.equal(presentationDocumentSchema.safeParse(read.starter).success,true);
 assert.equal((await validateProjectPresentation(db,principal,{...target,document:metricDocument()})).persisted,false);
 assert.deepEqual(await counts(db),[0,0,0]);
 await assert.rejects(getProjectPresentation(db,{...principal,scopes:['presentations:write']},target),/scope/);
 await assert.rejects(validateProjectPresentation(db,{...principal,scopes:['presentations:write']},{...target,document:doc()}),/scope/);
 await assert.rejects(getProjectPresentation(db,principal,{...target,clientId:'other'}),/not available/);
 await assert.rejects(getProjectPresentation(db,principal,{...target,projectId:'missing'}),/not available/);
 await assert.rejects(getProjectPresentation(db,principal,{...target,revision:1}),/not available/);
 for(const metricId of ['unlinked','missing','other-m'])await assert.rejects(validateProjectPresentation(db,principal,{...target,document:graph([{id:'m',type:'metric',metricId,variant:'stat'}])}),/metric is not available/);
 await assert.rejects(validateProjectPresentation(db,principal,{clientId:'c',projectId:'sibling',document:metricDocument()}),/metric is not available/);
 const oauth={...principal,oauthOperatorId:'operator'};
 await assert.rejects(getProjectPresentation(db,oauth,target),/not available/);
 assert.deepEqual(scopeArray('["presentations:read","presentations:write","presentations:publish"]'),principal.scopes);
 assert.equal(TOOL_SCOPES.publish_project_presentation,'presentations:publish');assert.equal(TOOL_SCOPES.restore_project_presentation,'presentations:write');
});

test('draft/save/publish/restore is exact, atomic, isolated, append-only and leaves reports/access unchanged',async t=>{
 const {db,env}=await setup(t);await grant(db);
 const original=metricDocument(),saved={...target,document:original,expectedRevision:0,idempotencyKey:'initial-save'};
 const unchanged=await businessSnapshot(db),reportBefore=await adminReport(db,admin,env,'a','c','p','2026-11');
 await assert.rejects(saveProjectPresentationDraft(db,{...principal,scopes:['presentations:read']},saved),/scope/);
 const twins=await Promise.all([saveProjectPresentationDraft(db,principal,saved),saveProjectPresentationDraft(db,principal,saved)]);
 assert.deepEqual(twins.map(r=>r.replayed).sort(),[false,true]);assert.equal(twins[0].revision,1);assert.equal(twins[0].createdAt,twins[1].createdAt);
 assert.deepEqual(await counts(db),[1,1,1]);
 assert.deepEqual(await readPublishedPresentation(db,'a',target),{revision:0,document:null,mode:'default'});
 assert.equal((await portalReport(db,identity,'c','p','2026-11',undefined,true)).presentation!.document,null);
 assert.equal((await readPresentationState(db,'b',target)).revision,0);assert.equal((await readPresentationState(db,'a',{...target,projectId:'sibling'})).revision,0);
 await assert.rejects(saveProjectPresentationDraft(db,principal,{...saved,document:doc('Changed')}),/Idempotency/);
 await assert.rejects(saveProjectPresentationDraft(db,principal,{...saved,idempotencyKey:'stale-save'}),/changed/);
 await assert.rejects(saveProjectPresentationDraft(db,principal,{...saved,expectedRevision:999,idempotencyKey:'future-save'}),/changed/);
 assert.deepEqual(await counts(db),[1,1,1]);
 const publish={...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'initial-publish'};
 await assert.rejects(publishProjectPresentation(db,{...principal,scopes:['presentations:read','presentations:write']},publish),/scope/);
 assert.equal((await publishProjectPresentation(db,{...principal,scopes:['presentations:publish']},publish)).revision,2);
 assert.equal((await publishProjectPresentation(db,principal,publish)).replayed,true);
 assert.deepEqual((await readPublishedPresentation(db,'a',target)).document,original);
 const next={...saved,document:doc('Not visible to recipient'),expectedRevision:2,idempotencyKey:'second-draft'};
 assert.equal((await saveProjectPresentationDraft(db,principal,next)).revision,3);
 assert.equal((await readPublishedPresentation(db,'a',target)).document!.name,original.name);
 await assert.rejects(publishProjectPresentation(db,principal,{...publish,expectedRevision:3,idempotencyKey:'publish-old-draft'}),/current draft/);
 await assert.rejects(publishProjectPresentation(db,principal,{...publish,sourceRevision:2,expectedRevision:3,idempotencyKey:'publish-old-publication'}),/current draft/);
 assert.deepEqual(await counts(db),[3,3,1]);
 assert.equal((await publishProjectPresentation(db,principal,{...publish,sourceRevision:3,expectedRevision:3,idempotencyKey:'publish-second-draft'})).revision,4);
 const restore={...target,sourceRevision:1,expectedRevision:4,idempotencyKey:'restore-original'};
 assert.equal((await restoreProjectPresentation(db,principal,restore)).revision,5);
 assert.equal((await restoreProjectPresentation(db,principal,restore)).replayed,true);
 const restored=await readPresentationState(db,'a',target);
 assert.equal(restored.draftRevision,5);assert.equal(restored.publishedRevision,4);assert.deepEqual(restored.draft,original);assert.equal(restored.published!.name,'Not visible to recipient');
 assert.equal(restored.isDraftPublished,false);
 assert.equal((await publishProjectPresentation(db,principal,{...publish,sourceRevision:5,expectedRevision:5,idempotencyKey:'publish-restored'})).revision,6);
 const final=await getProjectPresentation(db,principal,{...target,revision:2});assert.deepEqual(final.selected,original);assert.equal(final.isDraftPublished,true);assert.equal(final.history.length,6);
 assert.deepEqual(await counts(db),[6,6,1]);
 assert.deepEqual(await businessSnapshot(db),unchanged);assert.deepEqual(await adminReport(db,admin,env,'a','c','p','2026-11'),reportBefore);
 for(const statement of ["UPDATE presentation_revisions SET document_json='{}'",'DELETE FROM presentation_revisions',"UPDATE presentation_events SET result_json='{}'",'DELETE FROM presentation_events'])await assert.rejects(db.prepare(statement).run(),/append-only/);
 await db.prepare("UPDATE projects SET status='archived' WHERE tenant_id='a' AND client_id='c' AND id='p'").run();
 await assert.rejects(saveProjectPresentationDraft(db,principal,{...next,expectedRevision:6,idempotencyKey:'archived-draft'}),/not available/);
 await assert.rejects(publishProjectPresentation(db,principal,{...publish,expectedRevision:6,sourceRevision:5,idempotencyKey:'archived-publish'}),/not available/);
 await db.prepare("UPDATE projects SET status='active' WHERE tenant_id='a' AND client_id='c' AND id='p'").run();
 await db.prepare("DELETE FROM client_grants WHERE tenant_id='a'").run();
 await assert.rejects(saveProjectPresentationDraft(db,principal,saved),/not available/); // A known idempotency key is not authorization.
 await assert.rejects(getProjectPresentation(db,principal,target),/not available/);
});

test('conflicting concurrent writers/publishers cannot leave orphan snapshots or audit gaps',async t=>{
 const {db}=await setup(t);const input={...target,document:doc(),expectedRevision:0,idempotencyKey:'race-first'};
 let results=await Promise.allSettled([saveProjectPresentationDraft(db,principal,input),saveProjectPresentationDraft(db,principal,{...input,idempotencyKey:'race-second'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(await counts(db),[1,1,1]);
 const publish={...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'race-publish'};
 results=await Promise.allSettled([publishProjectPresentation(db,principal,publish),saveProjectPresentationDraft(db,principal,{...input,document:doc('Concurrent draft'),expectedRevision:1,idempotencyKey:'race-next-save'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(await counts(db),[2,2,1]);
 const state=await readPresentationState(db,'a',target);assert.equal(state.revision,2);
 assert.deepEqual((await db.prepare('SELECT revision FROM presentation_revisions ORDER BY revision').all()).results,[{revision:1},{revision:2}]);
 assert.deepEqual((await db.prepare('SELECT revision FROM presentation_events ORDER BY revision').all()).results,[{revision:1},{revision:2}]);
 // Inject a failure in the final receipt to prove the preceding snapshot/head roll back together.
 await db.prepare("CREATE TRIGGER test_reject_presentation_receipt BEFORE INSERT ON presentation_events BEGIN SELECT RAISE(ABORT,'Synthetic receipt failure'); END").run();
 await assert.rejects(saveProjectPresentationDraft(db,principal,{...input,expectedRevision:2,idempotencyKey:'receipt-failure'}),/changed|receipt failure/);
 assert.deepEqual(await counts(db),[2,2,1]);assert.equal((await readPresentationState(db,'a',target)).revision,2);
});

test('recipient design projects only current authorized metrics and rechecks permissions after publication read',async t=>{
 const {db,env}=await setup(t);await grant(db);
 const input={...target,document:metricDocument(),expectedRevision:0,idempotencyKey:'projection-save'};
 await saveProjectPresentationDraft(db,principal,input);await publishProjectPresentation(db,principal,{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'projection-publish'});
 const report=await portalReport(db,identity,'c','p','2026-11',undefined,true);
 assert.deepEqual(report.metrics.map(m=>m.id),['m']);assert.equal(report.metrics[0].current!.value,20);assert.equal(report.metrics[0].delta,10);assert.equal(report.metrics[0].relativePercent,100);
 assert.deepEqual(presentationMetricIds(report.presentation!.document!),['m']);assert.equal(report.presentation!.revision,2);
 for(const secret of ['secret-metric-id','Confidential metric','PRIVATE PROVENANCE','draftRevision','history','actor_id'])assert.equal(JSON.stringify(report).includes(secret),false,secret);
 assert.equal((await adminReport(db,admin,env,'a','c','p','2026-11')).metrics.length,2);
 await assert.rejects(portalReport(db,{...identity,subject:'someone-else'},'c','p','2026-11',undefined,true),/not available/);
 await assert.rejects(portalReport(db,admin,'c','p','2026-11',undefined,true),/not available/);
 await grant(db,'secret-only',['secret-metric-id']);
 let changed=false,revokeKey='secret-only';
 const wrapped=new Proxy(db,{get(target,key){if(key==='prepare')return(sql:string)=>{
  const statement=target.prepare(sql);
  if(!sql.includes('JOIN presentation_revisions r'))return statement;
  const wrap=(s:D1PreparedStatement):D1PreparedStatement=>new Proxy(s,{get(stmt,prop){if(prop==='bind')return(...args:unknown[])=>wrap(stmt.bind(...args));if(prop==='first')return async()=>{const value=await stmt.first();if(!changed){changed=true;await db.prepare("UPDATE invitations SET revoked_at='2026-11-11' WHERE id=?").bind(revokeKey).run();}return value;};const value=Reflect.get(stmt,prop);return typeof value==='function'?value.bind(stmt):value;}});
  return wrap(statement);
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const raced=await portalReport(wrapped,identity,'c','p','2026-11',undefined,true);assert.equal(changed,true);
 assert.deepEqual(raced.metrics.map(m=>m.id),['m']);assert.deepEqual(presentationMetricIds(raced.presentation!.document!),['m']);
 revokeKey='grant';changed=false;await assert.rejects(portalReport(wrapped,identity,'c','p','2026-11',undefined,true),/not available/);
 await db.prepare("UPDATE invitations SET revoked_at=NULL WHERE id='grant'").run();
 await db.prepare("UPDATE invitations SET metric_ids_json='[]' WHERE id='grant'").run();
 const empty=await portalReport(db,identity,'c','p','2026-11',undefined,true);assert.deepEqual(empty.metrics,[]);assert.deepEqual(presentationMetricIds(empty.presentation!.document!),[]);
 await grant(db,'ambiguous',['m'],'b');await assert.rejects(portalReport(db,identity,'c','p','2026-11',undefined,true),/not available/);
 await db.prepare("UPDATE invitations SET revoked_at='2026-11-11' WHERE id='ambiguous'").run();
 await db.prepare("UPDATE invitations SET grant_expires_at='2000-01-01' WHERE id='grant'").run();await assert.rejects(portalReport(db,identity,'c','p','2026-11',undefined,true),/not available/);
});

test('invalid persisted presentation falls back and old revisions stay private/exact-target',async t=>{
 const {db}=await setup(t);
 await db.prepare("INSERT INTO presentation_revisions VALUES('a','c','p',1,'publish',NULL,'{\"script\":\"secret\"}','2026-11-11','synthetic')").run();
 await db.prepare("INSERT INTO project_presentations VALUES('a','c','p',1,1,1)").run();
 assert.deepEqual(await readPublishedPresentation(db,'a',target),{revision:0,document:null,mode:'default'});
 assert.equal((await readPresentationState(db,'a',target)).draft,null);
 await assert.rejects(restoreProjectPresentation(db,principal,{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'invalid-restore'}),/not available/);
 await assert.rejects(getProjectPresentation(db,{...principal,tenantId:'b'},{...target,revision:1}),/not available/);
});

test('admin routes require verified admin, exact-origin JSON and fresh session; preview/restore do not publish',async t=>{
 const {db,env}=await setup(t);
 const base=origin+'/api/admin/targets/a/c/p/presentation';
 const stateRequest=()=>new Request(base+'-state');
 const noRead={prepare(){throw Error('Unauthorized request accessed database');}} as unknown as D1Database;
 for(const who of [null,identity,{...admin,issuer:'https://evil.test'},{...admin,email:'marco+admin@hexacombllc.com'},{...identity,role:'super_admin'}])await assert.rejects(handleAdminPresentationRequest(stateRequest(),{...env,DB:noRead},who),/Administrator access/);
 await assert.rejects(handleAdminPresentationRequest(stateRequest(),{...env,DB:noRead,ADMIN_ACCESS_ENABLED:'false'},admin),/Administrator access/);
 assert.equal(isAdminPresentationPath(new URL(base).pathname),true);
 assert.equal((await handleAdminPresentationRequest(new Request(base,{method:'POST'}),env,admin)).status,405);
 assert.equal((await handleAdminPresentationRequest(new Request(base+'-state/publish',{method:'POST'}),env,admin)).status,405);
 const saved={...target,document:doc('Draft visible only to admin'),expectedRevision:0,idempotencyKey:'admin-save'};
 await saveProjectPresentationDraft(db,principal,saved);
 const body={sourceRevision:1,expectedRevision:1,idempotencyKey:'admin-publish'};
 const post=(headers:Record<string,string>={},payload:unknown=body,path=base+'/publish')=>new Request(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:typeof payload==='string'?payload:JSON.stringify(payload)});
 for(const headers of [{Origin:''},{Origin:'https://evil.test'},{Origin:origin+'/'},{Origin:origin+'.evil.test'},{'Sec-Fetch-Site':'cross-site'},{'Content-Type':'text/plain'},{'Content-Type':'application/x-www-form-urlencoded'}] as Record<string,string>[])assert.equal((await handleAdminPresentationRequest(post(headers),{...env,DB:noRead},admin)).status,403);
 await assert.rejects(handleAdminPresentationRequest(post({},'x'.repeat(4097)),env,admin),/too large/);
 await assert.rejects(handleAdminPresentationRequest(post({},'{bad-json'),env,admin));
 await assert.rejects(handleAdminPresentationRequest(post({},{...body,tenantId:'b'}),env,admin));
 const preview=await (await handleAdminPresentationRequest(new Request(base+'?revision=1&month=2026-11'),env,admin)).json() as any;
 assert.equal(preview.presentation.mode,'preview');assert.equal(preview.presentation.document.name,'Draft visible only to admin');assert.equal(preview.metrics.length,2);
 assert.equal((await (await handleAdminPresentationRequest(new Request(base+'?month=2026-11'),env,admin)).json() as any).presentation.mode,'default');
 for(const query of ['revision=0','revision=-1','revision=1.0','revision=01','revision=1&revision=2','revision=9007199254740991'])await assert.rejects(handleAdminPresentationRequest(new Request(base+'?'+query),env,admin));
 const published=await handleAdminPresentationRequest(post(),env,admin);assert.equal(published.status,200);assert.equal((await published.json() as any).revision,2);
 assert.equal((await (await handleAdminPresentationRequest(post(),env,admin)).json() as any).replayed,true);
 await saveProjectPresentationDraft(db,principal,{...saved,document:doc('New draft'),expectedRevision:2,idempotencyKey:'admin-next-save'});
 assert.equal((await handleAdminPresentationRequest(post({},{sourceRevision:1,expectedRevision:3,idempotencyKey:'admin-stale-publish'}),env,admin)).status,409);
 assert.equal((await readPresentationState(db,'a',target)).revision,3);
 const restored=await handleAdminPresentationRequest(post({},{sourceRevision:1,expectedRevision:3,idempotencyKey:'admin-restore'},base+'/restore'),env,admin);
 assert.equal((await restored.json() as any).revision,4);assert.equal((await readPresentationState(db,'a',target)).publishedRevision,2);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM presentation_events WHERE actor_id LIKE 'browser:%'").first<{n:number}>())!.n,2);
 // Match the route's real authentication pipeline with an explicit test adapter, not forged signed credentials.
 let liveStatus='active',email=admin.email;
 const adapter:HumanAuthAdapter={async authenticate(){return {isAuthenticated:true,status:'signed-in',toAuth:()=>({userId:admin.subject,sessionId:admin.sessionId,sessionClaims:{iss:admin.issuer}})};},async getSession(){return {id:admin.sessionId,userId:admin.subject,status:liveStatus,expireAt:Date.now()+60000,abandonAt:Date.now()+60000};},async getUser(){return {id:admin.subject,banned:false,locked:false,primaryEmailAddress:{emailAddress:email,verification:{status:'verified'}}};}};
 assert.equal((await handleAdminPresentationRequest(stateRequest(),env,await getHumanIdentity(stateRequest(),env,adapter))).status,200);
 liveStatus='revoked';await assert.rejects(handleAdminPresentationRequest(stateRequest(),env,await getHumanIdentity(stateRequest(),env,adapter)),/Administrator access/);
 liveStatus='active';email=identity.email;await assert.rejects(handleAdminPresentationRequest(stateRequest(),env,await getHumanIdentity(stateRequest(),env,adapter)),/Administrator access/);
});

test('reference validation rejects newly unlinked metrics and project report bounds; storage FKs are exact-target',async t=>{
 const {db}=await setup(t);
 await saveProjectPresentationDraft(db,principal,{...target,document:metricDocument(),expectedRevision:0,idempotencyKey:'mapping-save'});
 for(const statement of [
  "INSERT INTO presentation_revisions VALUES('b','c','p',2,'restore',1,'{}','2026-11-11','synthetic')",
  "INSERT INTO project_presentations VALUES('b','c','p',1,1,1)",
  "INSERT INTO presentation_events VALUES('b','mcp:agent','invalid-scope','c','p',1,'hash','{}','2026-11-11')",
  "INSERT INTO presentation_revisions VALUES('a','other','p',2,'restore',1,'{}','2026-11-11','synthetic')",
 ])await assert.rejects(db.prepare(statement).run(),/FOREIGN KEY/);
 await db.prepare("DELETE FROM project_metrics WHERE tenant_id='a' AND client_id='c' AND project_id='p' AND metric_id='secret-metric-id'").run();
 await assert.rejects(publishProjectPresentation(db,principal,{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'mapping-publish'}),/metric is not available/);
 await assert.rejects(restoreProjectPresentation(db,principal,{...target,sourceRevision:1,expectedRevision:1,idempotencyKey:'mapping-restore'}),/metric is not available/);
 assert.deepEqual(await counts(db),[1,1,1]);
 const statements:D1PreparedStatement[]=[];
 for(let i=0;i<200;i++){
  const id='extra-'+i;
  statements.push(db.prepare("INSERT INTO metrics VALUES('a','c',?,?,?,'test','count','higher','period_total','UTC','{}','Synthetic','agent','2026-11-01')").bind(id,id,id),db.prepare("INSERT INTO project_metrics VALUES('a','c','p',?)").bind(id));
 }
 await db.batch(statements);
 await assert.rejects(validateProjectPresentation(db,principal,{...target,document:doc()}),/supported report size/);
 await assert.rejects(saveProjectPresentationDraft(db,principal,{...target,document:doc(),expectedRevision:1,idempotencyKey:'large-project-save'}),/supported report size/);
 assert.deepEqual(await counts(db),[1,1,1]);
});

test('history remains bounded while exact historical revisions remain retrievable',async t=>{
 const {db}=await setup(t);
 for(let i=0;i<52;i++)await saveProjectPresentationDraft(db,principal,{...target,document:doc('Draft '+i),expectedRevision:i,idempotencyKey:'history-save-'+i});
 const state=await getProjectPresentation(db,principal,{...target,revision:1});
 assert.equal(state.history.length,50);assert.equal(state.history[0].revision,52);assert.equal(state.history.at(-1)!.revision,3);assert.equal(state.selected!.name,'Draft 0');
 assert.equal(state.published,null);assert.equal(state.draftRevision,52);assert.deepEqual(await counts(db),[52,52,1]);
});
