import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {resolveWorkspaceAccess,sessionChangeGuard,verificationMessage} from '../src/scripts/access-state.ts';
import {previousCompletedMonth} from '../src/scripts/project-state.ts';
import {readClientPresentationRoute,clientPresentationApiPath,clientPresentationBasePath,clientPresentationPagePath,presentationRequestGuard,validPresentationMonth} from '../src/scripts/client-presentation-state.ts';
import {createTestDocument,flush,deferred} from './presentation-dom.fixture.ts';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/scripts/client-presentation.ts',import.meta.url),'utf8').replace(/^import .+;$/gm,''));
function setup(options:{search?:string;authenticated?:boolean;localSession?:boolean;adminAllowed?:boolean;signOut?:()=>Promise<void>}={}){
 const {document}=createTestDocument(),window=new EventTarget(),calls:string[]=[],loads:{path:string;pending:ReturnType<typeof deferred<any>>}[]=[];let mounted=0,adminMounted=0;
 let listener:((event:{session:{id:string}|null})=>void)|undefined;
 const clerk={session:options.localSession===false?null:{id:'initial'},addListener:(callback:typeof listener)=>{listener=callback;return ()=>{listener=undefined;};},signOut:async()=>{await options.signOut?.();clerk.session=null;listener?.({session:null});}};
 const location={search:options.search??'?client=client&project=project&month=2026-10'};
 class ApiError extends Error{status:number;constructor(status:number){super('Request denied');this.status=status;}}
 const context={document,window,location,AbortController,Date,history:{pushState:(_a:unknown,_b:string,path:string)=>{location.search=new URL(path,'https://example.invalid').search;}},getClerk:async()=>clerk,mountSignIn:async()=>{mounted++;return ()=>{};},api:async(path:string)=>{
  calls.push(path);if(path==='/api/session')return {authenticated:options.authenticated??true,email:'test@example.invalid'};
  if(path==='/api/admin/session'){if(options.adminAllowed===false)throw new ApiError(403);return {authenticated:true,role:'super_admin'};}
  if(path.endsWith('/presentation-state'))return {revision:0,draftRevision:null,publishedRevision:null,isDraftPublished:false,draft:null,published:null,history:[]};
  const pending=deferred<any>();loads.push({path,pending});return pending.promise;
 },ApiError,message:(error:Error)=>error.message,resolveWorkspaceAccess,sessionChangeGuard,verificationMessage,previousCompletedMonth,readClientPresentationRoute,clientPresentationApiPath,clientPresentationBasePath,clientPresentationPagePath,presentationRequestGuard,validPresentationMonth,
 clearClientPresentation:(canvas:any,ledger:any)=>{canvas.replaceChildren();ledger.replaceChildren();},renderClientPresentation:(canvas:any,ledger:any,report:any)=>{canvas.textContent=report.target.name;ledger.textContent='Private metric values';},mountPresentationAdmin:(root:any)=>{adminMounted++;root.textContent='Private design controls';root.hidden=false;return ()=>{root.replaceChildren();root.hidden=true;};}};
 runInNewContext(source,context);
 const resolve=(index:number,name='Loaded project')=>{const load=loads[index],url=new URL(load.path,'https://example.invalid');load.pending.resolve({target:{clientId:'client',projectId:'project',name,kind:'one_off_project',status:'active'},month:url.searchParams.get('month'),previousMonth:'2026-09',metrics:[],presentation:{revision:url.searchParams.has('revision')?Number(url.searchParams.get('revision')):0,document:null,mode:url.searchParams.has('revision')?'preview':'default'}});};
 return {document,window,clerk,calls,loads,location,resolve,mounted:()=>mounted,adminMounted:()=>adminMounted,changeSession:(id:string|null)=>{clerk.session=id?{id}:null;listener?.({session:clerk.session});}};
}
test('recipient page verifies session but never probes administrator identity',async()=>{
 const s=setup();await flush();assert.equal(s.loads.length,1);assert.deepEqual(s.calls.slice(0,2),['/api/session','/api/targets/client/project/presentation?month=2026-10']);assert.ok(!s.calls.includes('/api/admin/session'));s.resolve(0);await flush();assert.equal(s.document.getElementById('client-report').hidden,false);assert.equal(s.adminMounted(),0);
});
test('admin URL requires server admin verification before protected report or state reads',async()=>{
 const denied=setup({search:'?client=client&project=project&tenant=tenant&preview=3',adminAllowed:false});await flush();assert.equal(denied.loads.length,0);assert.equal(denied.document.getElementById('client-report').hidden,true);assert.deepEqual(denied.calls,['/api/session','/api/admin/session']);
 const granted=setup({search:'?client=client&project=project&tenant=tenant&preview=3'});await flush();assert.match(granted.loads[0].path,/api\/admin\/targets\/tenant\/client\/project\/presentation.*revision=3/);granted.resolve(0);await flush();assert.equal(granted.adminMounted(),1);
});
test('signed-out and unverified sessions cannot read report data',async()=>{
 const out=setup({localSession:false,authenticated:false});await flush();assert.equal(out.loads.length,0);assert.equal(out.mounted(),1);assert.equal(out.document.getElementById('client-welcome').hidden,false);
 const failed=setup({authenticated:false});await flush();assert.equal(failed.loads.length,0);assert.equal(failed.mounted(),0);assert.equal(failed.document.getElementById('client-report').hidden,true);assert.match(failed.document.getElementById('client-status').textContent,/could not verify/);
});
test('session change immediately erases content and ignores stale identity responses',async()=>{
 const s=setup();await flush();s.resolve(0,'First private project');await flush();assert.equal(s.document.getElementById('client-canvas').textContent,'First private project');
 s.changeSession('replacement');assert.equal(s.document.getElementById('client-canvas').textContent,'');assert.equal(s.document.getElementById('client-report').hidden,true);await flush();assert.equal(s.loads.length,2);s.resolve(1,'Second private project');await flush();assert.equal(s.document.getElementById('client-canvas').textContent,'Second private project');
 s.changeSession(null);assert.equal(s.document.getElementById('client-canvas').textContent,'');await flush();assert.equal(s.document.getElementById('client-report').hidden,true);
});
test('fast month navigation cannot repaint a late prior report',async()=>{
 const s=setup();await flush();const input=s.document.getElementById('client-month');input.value='2026-09';input.dispatchEvent(new Event('change'));await flush();assert.equal(s.loads.length,2);s.resolve(1,'September report');await flush();s.resolve(0,'Late October report');await flush();assert.equal(s.document.getElementById('client-canvas').textContent,'September report');assert.match(s.location.search,/month=2026-09/);
});
test('Back/Forward and bfcache clear data before revalidation and discard previous requests',async()=>{
 const s=setup();await flush();s.window.dispatchEvent(new Event('pagehide'));assert.equal(s.document.getElementById('client-canvas').textContent,'');s.resolve(0,'Late hidden report');await flush();assert.equal(s.document.getElementById('client-canvas').textContent,'');
 s.window.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));await flush();assert.equal(s.loads.length,2);s.resolve(1,'Fresh report');await flush();assert.equal(s.document.getElementById('client-canvas').textContent,'Fresh report');
 s.location.search='?client=client&project=project&month=2026-08';s.window.dispatchEvent(new Event('popstate'));assert.equal(s.document.getElementById('client-canvas').textContent,'');await flush();assert.match(s.loads[2].path,/month=2026-08/);
});
test('sign-out clears private canvas, ledger and controls before the network completes',async()=>{
 const signOut=deferred<void>(),s=setup({signOut:()=>signOut.promise});await flush();s.resolve(0,'Private project');await flush();s.document.getElementById('client-logout').click();assert.equal(s.document.getElementById('client-canvas').textContent,'');assert.equal(s.document.getElementById('client-ledger').textContent,'');assert.equal(s.document.getElementById('client-report').hidden,true);signOut.resolve();await flush();assert.equal(s.document.getElementById('client-report').hidden,true);
});
test('invalid duplicate query fails before loading identity or protected resources',async()=>{
 const s=setup({search:'?client=client&project=project&project=other'});await flush();assert.deepEqual(s.calls,[]);assert.match(s.document.getElementById('client-status').textContent,/invalid or incomplete/);
});
