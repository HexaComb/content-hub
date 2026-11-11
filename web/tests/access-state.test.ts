import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {resolveWorkspaceAccess,sessionChangeGuard} from '../src/scripts/access-state.ts';
test('client/server mismatch stops before target reads, including repeated manual retries',async()=>{
 let targets=0;for(let i=0;i<3;i++)assert.deepEqual(await resolveWorkspaceAccess(()=> 'existing',()=>true,async()=>({authenticated:false}),async()=>{targets++;return [];}),{kind:'verification_failed'});assert.equal(targets,0);
});
test('signed-out state permits sign-in without reading protected targets',async()=>{
 assert.deepEqual(await resolveWorkspaceAccess(()=>null,()=>true,async()=>({authenticated:false}),async()=>{throw Error('must not read');}),{kind:'signed_out'});
});
test('verified identity with no grants remains a verified empty workspace',async()=>{
 assert.deepEqual(await resolveWorkspaceAccess(()=> 'existing',()=>true,async()=>({authenticated:true,email:'test@example.invalid'}),async()=>[]),{kind:'verified',email:'test@example.invalid',targets:[]});
});
test('session-end and superseded-request races discard results',async()=>{
 let session:string|null='initial';let reads=0;
 assert.deepEqual(await resolveWorkspaceAccess(()=>session,()=>true,async()=>{session=null;return {authenticated:true};},async()=>{reads++;return [];}),{kind:'stale'});assert.equal(reads,0);
 session='initial';assert.deepEqual(await resolveWorkspaceAccess(()=>session,()=>true,async()=>({authenticated:true}),async()=>{session='other';return ['private'];}),{kind:'stale'});
 assert.deepEqual(await resolveWorkspaceAccess(()=>session,()=>false,async()=>({authenticated:false}),async()=>[]),{kind:'stale'});
});
test('repeated session listener updates do not restart boot',()=>{
 let boots=0;const changed=sessionChangeGuard('one',()=>boots++);for(let i=0;i<10;i++)changed('one');assert.equal(boots,0);changed(null);changed(null);assert.equal(boots,1);changed('two');changed('two');assert.equal(boots,2);
});
test('SignIn is not mounted for an existing session or superseded asynchronous request',async()=>{
 const source=await readFile(new URL('../src/scripts/auth.ts',import.meta.url),'utf8');const mountSource=source.slice(source.indexOf('export async function mountSignIn'));
 const js=ts.transpileModule(`const getClerk=async()=>globalThis.__mountTestClerk;const location={origin:'https://example.invalid'};${mountSource}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const g=globalThis as typeof globalThis&{__mountTestClerk:any};let mounts=0;let unmounts=0;g.__mountTestClerk={session:{id:'one'},mountSignIn:()=>mounts++,unmountSignIn:()=>unmounts++};
 try{const {mountSignIn}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);assert.equal(await mountSignIn({},'/'),undefined);g.__mountTestClerk.session=null;assert.equal(await mountSignIn({},'/',()=>false),undefined);assert.equal(mounts,0);const cleanup=await mountSignIn({},'/');assert.equal(mounts,1);cleanup();assert.equal(unmounts,1);}finally{delete (g as Partial<typeof g>).__mountTestClerk;}
});

test('session 401/403 becomes safe verification recovery without exposing raw provider errors',async()=>{
 for(const status of [401,403]){
  let targetReads=0;
  assert.deepEqual(await resolveWorkspaceAccess(()=> 'existing',()=>true,async()=>{throw Object.assign(new Error('private provider detail'),{status});},async()=>{targetReads++;return [];}),{kind:'verification_failed'});
  assert.equal(targetReads,0);
 }
});
test('target authorization 401/403 is preserved rather than relabeled as session setup failure',async()=>{
 for(const status of [401,403]){
  const error=Object.assign(new Error('target access denied'),{status});
  await assert.rejects(resolveWorkspaceAccess(()=> 'existing',()=>true,async()=>({authenticated:true}),async()=>{throw error;}),e=>e===error);
 }
});
