import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {validateAuthConfig} from '../src/scripts/auth-config.ts';
const config={provider:'clerk' as const,publishableKey:`pk_test_${btoa('identity.example.invalid$')}`,frontendApiUrl:'https://identity.example.invalid'};
test('runtime Clerk configuration requires exact HTTPS issuer/key match',()=>{
 assert.equal(validateAuthConfig(config),config);
 for(const frontendApiUrl of ['http://identity.example.invalid','https://other.example.invalid','https://identity.example.invalid/path','https://identity.example.invalid?query=1','https://user@identity.example.invalid','https://identity.example.invalid:8443'])assert.throws(()=>validateAuthConfig({...config,frontendApiUrl}));
 assert.throws(()=>validateAuthConfig({...config,publishableKey:'sk_test_not_public'}));
});
test('API obtains a fresh session token for each call, refuses non-local routes and does not persist tokens',async()=>{
 const source=(await readFile(new URL('../src/scripts/api.ts',import.meta.url),'utf8')).replace("import {getClerk,AuthUnavailable} from './auth';",`class AuthUnavailable extends Error {}\nconst getClerk=async()=>globalThis.__testClerk;`);
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 let calls=0;const headers:string[]=[];const g=globalThis as typeof globalThis&{__testClerk:unknown};g.__testClerk={session:{getToken:async()=>`synthetic-${++calls}`}};const original=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{headers.push(new Headers(options?.headers).get('Authorization')??'');return Response.json({ok:true});};
 try{const {api}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);await api('/api/session');await api('/api/targets');assert.deepEqual(headers,['Bearer synthetic-1','Bearer synthetic-2']);await assert.rejects(api('https://example.invalid/api'));await assert.rejects(api('//example.invalid/api'));assert.equal(calls,2);g.__testClerk={session:null};await api('/api/session');assert.equal(headers[2],'');}finally{globalThis.fetch=original;delete (g as Partial<typeof g>).__testClerk;}
});
test('active UI has no legacy OTP endpoints, tokens remain out of browser storage',async()=>{
 const names=['api.ts','auth.ts','invite.ts','dashboard.ts'];for(const name of names){const source=await readFile(new URL(`../src/scripts/${name}`,import.meta.url),'utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|\/api\/login\/|\/api\/logout|code-form/);}
 const invite=await readFile(new URL('../src/pages/invite.astro',import.meta.url),'utf8');assert.match(invite,/history.replaceState/);assert.doesNotMatch(invite,/Verification code|code-form/);
});
