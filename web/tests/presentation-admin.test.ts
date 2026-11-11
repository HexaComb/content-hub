import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {defaultPresentation} from '../../src/presentationSchema.ts';
import {clientPresentationBasePath,clientPresentationPagePath,presentationMutation,type PresentationReport,type PresentationState} from '../src/scripts/client-presentation-state.ts';
import {createTestDocument,TestElement,flush,deferred} from './presentation-dom.fixture.ts';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/scripts/client-presentation-admin.ts',import.meta.url),'utf8').replace(/^import .+;$/gm,'')).replace('export function mountPresentationAdmin','function mountPresentationAdmin')+'\nglobalThis.mount=mountPresentationAdmin;';
const report:PresentationReport={target:{clientId:'client',projectId:'project',name:'Test project',kind:'one_off_project',status:'active'},month:'2026-10',previousMonth:'2026-09',metrics:[],presentation:{revision:3,document:defaultPresentation(),mode:'preview',plugin:null,pages:['seo','instagram']}};
const state:PresentationState={revision:3,draftRevision:3,publishedRevision:null,isDraftPublished:false,draft:defaultPresentation(),published:null,history:[{revision:3,operation:'save',createdAt:'2026-11-01T00:00:00Z'},{revision:2,operation:'save',createdAt:'2026-10-31T00:00:00Z'}]};
function setup(options:{plugin?:'seo'|'instagram';preview?:number;published?:boolean;alreadyPublished?:boolean;api?:(path:string,init:any)=>Promise<any>}={}){
 const {document}=createTestDocument(),root=new TestElement('aside');let current=true,reloads=0,denied=0;const commits:any[]=[],requests:any[]=[];
 class ApiError extends Error{status:number;constructor(status:number){super();this.status=status;}}
 const context:any={document,AbortController,crypto,clientPresentationBasePath,clientPresentationPagePath,presentationMutation,ApiError,api:async(path:string,init:any)=>{requests.push({path,body:JSON.parse(init.body)});return options.api?options.api(path,init):{revision:4,operation:path.endsWith('/publish')?'publish':'restore'};}};
 runInNewContext(source,context);
 const dispose=context.mount(root,{clientId:'client',projectId:'project',tenantId:'tenant',...(options.plugin?{plugin:options.plugin}:{}),preview:options.preview??3,month:'2026-10'},{...report,presentation:{...report.presentation,revision:options.preview??3,mode:options.published?'published':'preview'}},{...state,isDraftPublished:options.alreadyPublished??false},()=>current,(...args:any[])=>commits.push(args),()=>reloads++,()=>denied++);
 const button=(text:string)=>root.walk().find(node=>node.tagName==='BUTTON'&&node.textContent===text)!;
 return {root,button,requests,commits,dispose,ApiError,setCurrent:(value:boolean)=>{current=value;},reloads:()=>reloads,denied:()=>denied};
}
test('only the exact current private draft enables publish, never history or published views',()=>{
 for(const options of [{preview:2},{published:true},{alreadyPublished:true}]){const s=setup(options);assert.equal(s.button('Publish exact draft').disabled,true);s.button('Publish exact draft').click();assert.equal(s.requests.length,0);}
 const s=setup();assert.equal(s.button('Publish exact draft').disabled,false);assert.match(s.root.textContent,/full project report/);assert.match(s.root.textContent,/only the metrics already approved/);
});
test('publication requires exact revision confirmation; duplicate clicks stay one request',async()=>{
 const pending=deferred<any>(),s=setup({api:()=>pending.promise});s.button('Publish exact draft').click();assert.equal(s.requests.length,0);assert.match(s.root.textContent,/Publish draft revision 3/);assert.match(s.root.textContent,/everyone already authorized/);
 s.button('Publish revision 3').click();s.button('Publish revision 3').click();assert.equal(s.requests.length,1);assert.equal(s.requests[0].body.sourceRevision,3);pending.resolve({revision:4,operation:'publish'});await flush();assert.deepEqual(s.commits,[['publish',4]]);
});
test('uncertain completion reuses exactly the original key, revision and payload',async()=>{
 let calls=0;const s=setup({api:async()=>{if(++calls===1)throw new Error('connection lost');return {revision:4,operation:'publish'};}});s.button('Publish exact draft').click();s.button('Publish revision 3').click();await flush();assert.match(s.root.textContent,/outcome is not confirmed/);assert.equal(s.button('Publish exact draft').disabled,true);s.button('Retry same action').click();await flush();assert.equal(s.requests.length,2);assert.deepEqual(s.requests[0],s.requests[1]);assert.deepEqual(s.commits,[['publish',4]]);
});
test('uncertain read-latest does not unlock stale controls or issue a new mutation',async()=>{
 const s=setup({api:async()=>{throw new Error('connection lost');}});s.button('Restore as draft').click();s.button('Restore revision 3').click();await flush();s.button('Read latest state').click();assert.equal(s.reloads(),1);assert.equal(s.requests.length,1);assert.equal(s.button('Restore as draft').disabled,true);assert.deepEqual(s.commits,[]);
});
test('restore confirms draft-only effect and returns the exact newly saved revision',async()=>{
 const s=setup();const selector=s.root.walk().find(node=>node.tagName==='SELECT')!;selector.value='2';selector.dispatchEvent(new Event('change'));s.button('Restore as draft').click();assert.match(s.root.textContent,/published client page will stay unchanged/);s.button('Restore revision 2').click();await flush();assert.equal(s.requests[0].body.sourceRevision,2);assert.deepEqual(s.commits,[['restore',4]]);
});
test('session loss and disposal discard late write replies and clear private controls',async()=>{
 const pending=deferred<any>(),s=setup({api:()=>pending.promise});s.button('Publish exact draft').click();s.button('Publish revision 3').click();s.setCurrent(false);s.dispose();pending.resolve({revision:4,operation:'publish'});await flush();assert.deepEqual(s.commits,[]);assert.equal(s.root.hidden,true);assert.equal(s.root.textContent,'');
});
test('cancel before sending makes no mutation and returns focus to originating control',()=>{
 const s=setup();s.button('Publish exact draft').click();s.button('Cancel').click();assert.equal(s.requests.length,0);assert.equal(s.button('Publish exact draft').disabled,false);assert.equal(s.button('Publish exact draft').focused,true);
});
test('both page previews use one project mutation, shared publication disclosure and revision-preserving links',async()=>{
 for(const plugin of ['seo','instagram'] as const){
  const s=setup({plugin});assert.match(s.root.textContent,/one shared design and revision/);assert.match(s.root.textContent,/Publishing changes BOTH the SEO and Instagram pages/);
  for(const link of s.root.walk().filter(node=>node.tagName==='A')){const url=new URL(link.href,'https://example.invalid');assert.equal(url.searchParams.get('plugin'),plugin);assert.equal(url.searchParams.get('month'),'2026-10');}
  s.button('Publish exact draft').click();assert.match(s.root.textContent,/BOTH the SEO and Instagram client pages/);s.button('Publish revision 3').click();await flush();
  assert.equal(s.requests[0].path,'/api/admin/targets/tenant/client/project/presentation/publish');assert.equal(s.requests[0].body.sourceRevision,3);
 }
});
