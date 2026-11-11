import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientPresentationApiPath,clientPresentationBasePath,clientPresentationPagePath,presentationMutation,presentationRequestGuard,readClientPresentationRoute,validPresentationMonth,type PresentationState} from '../src/scripts/client-presentation-state.ts';
import {safeSignInReturn,defaultScopeSelected,validProposal,type ConsentProposal} from '../src/scripts/oauth-state.ts';
const route={clientId:'client-one',projectId:'project.one'};
test('client routes reject unknown, repeated, malformed and overlong target coordinates',()=>{
 assert.deepEqual(readClientPresentationRoute('?client=client-one&project=project.one'),route);
 const admin={...route,tenantId:'tenant:one',preview:42,month:'2026-10'};
 assert.deepEqual(readClientPresentationRoute(clientPresentationPagePath(admin).split('?')[1]),admin);
 for(const query of ['','?client=c','?client=c&project=p&preview=1','?client=c&project=p&tenant=','?client=c&project=p&foo=bar','?client=c&project=p&project=p','?client=c&project=p&month=2026-13','?client=c&project=p&month=0000-01','?client=c&project=p&tenant=t&preview=0','?client=c&project=p&tenant=t&preview=01','?client=c&project=p&tenant=t&preview=1.5','?client=c&project=p&tenant=t&preview=9007199254740992','?client=c&project=%2Fadmin','?client=c&project=p&tenant=t&tenant=t','?client='+('c'.repeat(101))+'&project=p','?client=c&project=p&month=2026-10&month=2026-10','?client=c&project=p&'+('x'.repeat(2048))])assert.equal(readClientPresentationRoute(query),null,query);
 assert.equal(validPresentationMonth('1000-01'),true);assert.equal(validPresentationMonth('9999-12'),true);
});
test('tenant URLs cannot authorize admin APIs and preview only uses exact admin revision',()=>{
 assert.equal(clientPresentationApiPath(route,'2026-10',false),'/api/targets/client-one/project.one/presentation?month=2026-10');
 const admin={...route,tenantId:'tenant:one',preview:42};
 assert.throws(()=>clientPresentationApiPath(admin,'2026-10',false));
 assert.equal(clientPresentationApiPath(admin,'2026-10',true),'/api/admin/targets/tenant%3Aone/client-one/project.one/presentation?month=2026-10&revision=42');
 assert.throws(()=>clientPresentationApiPath({...route,preview:2},'2026-10',true));
 assert.throws(()=>clientPresentationApiPath(route,'2026-20',false));
 assert.equal(clientPresentationBasePath(route,true),'/api/targets/client-one/project.one');
});
test('client sign-in return is bounded, local and preserves an exact valid preview',()=>{
 const origin='https://content.example.invalid',path='/client?client=c&project=p&tenant=t&preview=12&month=2026-10';
 assert.equal(safeSignInReturn(path,origin),origin+path);assert.equal(safeSignInReturn(path.replace('/client?','/client/?'),origin),origin+path);
 for(const path of ['/client','/client?client=c&project=p&next=https://bad.invalid','/client?client=c&project=p#fragment','/client?client=c&project=p&preview=1','https://user@content.example.invalid/client?client=c&project=p','//content.example.invalid/client?client=c&project=p','/client?client=c&project=p\n','/client?client=c&project=p\\','/client?client=c&project=p&'+('a'.repeat(9000))])assert.throws(()=>safeSignInReturn(path,origin));
});
test('mutation snapshots require exact draft and retain the same immutable replay body',()=>{
 const state:PresentationState={revision:7,draftRevision:6,publishedRevision:4,isDraftPublished:false,draft:null,published:null,history:[{revision:3,operation:'save',createdAt:'2026-10-01T00:00:00Z'}]};
 const mutation=presentationMutation('publish',state,6,'test-idempotency');
 assert.deepEqual(mutation.body,{expectedRevision:7,sourceRevision:6,idempotencyKey:'test-idempotency'});assert.ok(Object.isFrozen(mutation.body));
 state.revision=9;assert.equal(mutation.body.expectedRevision,7);assert.throws(()=>presentationMutation('publish',state,3,'test-key'));
 assert.equal(presentationMutation('restore',state,3,'restore-key').body.sourceRevision,3);assert.throws(()=>presentationMutation('restore',state,1,'restore-key'));
});
test('stale request tickets are rejected on session end, superseding loads and history changes',()=>{
 const guard=presentationRequestGuard(),first=guard.begin();assert.ok(guard.current(first));const next=guard.begin();assert.ok(!guard.current(first));assert.ok(guard.current(next));guard.invalidate();assert.ok(!guard.current(next));assert.ok(!guard.current(first));
});
test('presentation scopes are recognized but write and publication never default on',()=>{
 const proposal:ConsentProposal={handle:'test',client:{name:'test',domain:null,redirectHost:'example.invalid',isLoopback:false},tenant:{id:'t',name:'t'},scopes:[{id:'presentations:read',label:'Read designs',selected:true},{id:'presentations:write',label:'Edit drafts',selected:true},{id:'presentations:publish',label:'Publish designs',selected:true}],clients:[],expiresAt:'2027-01-01T00:00:00Z',consentExpiresAt:'2027-01-01T00:00:00Z'};
 assert.equal(validProposal(proposal),true);assert.deepEqual(proposal.scopes.map(defaultScopeSelected),[true,false,false]);
});
test('standalone page has no dashboard assets and only the trusted external script entry',()=>{
 const page=readFileSync(new URL('../src/pages/client.astro',import.meta.url),'utf8');assert.doesNotMatch(page,/Shell|Workspace|Dashboard|images\/|https:\/\//);assert.match(page,/name="robots" content="noindex, nofollow, noarchive"/);assert.match(page,/scripts\/client-presentation/);
 const renderer=readFileSync(new URL('../src/scripts/client-presentation-render.ts',import.meta.url),'utf8');assert.doesNotMatch(renderer,/innerHTML|insertAdjacentHTML|eval\(|new Function|fetch\(|\.src\s*=/);assert.match(renderer,/renderLedger\(ledger,report\)/);
});
