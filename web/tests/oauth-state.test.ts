import {readFile} from 'node:fs/promises';
import {OAUTH_SCOPE_LABELS} from '../../src/oauthAccess.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeSignInReturn,validProposal,consentRedirect,defaultScopeSelected,type ConsentProposal} from '../src/scripts/oauth-state.ts';
const origin='https://content.example.invalid';
const proposal:ConsentProposal={handle:'test-only',client:{name:'Test app',domain:'app.example.invalid',redirectHost:'app.example.invalid',isLoopback:false},tenant:{id:'tenant-test',name:'Test workspace'},scopes:[{id:'mcp:connect',label:'Connect',selected:true}],clients:[{id:'client-test',name:'Test client',selected:false}],expiresAt:'2030-01-01T00:00:00Z',consentExpiresAt:'2029-01-01T00:10:00Z'};
test('Clerk return preserves OAuth query only on fixed same-origin authorize page',()=>{
 const path='/authorize?client_id=test&state=abc&code_challenge=xyz&redirect_uri=https%3A%2F%2Fapp.example.invalid%2Fcallback';assert.equal(safeSignInReturn(path,origin),origin+path);assert.equal(safeSignInReturn('/invite',origin),origin+'/invite');
 for(const path of ['//attacker.invalid/authorize','https://attacker.invalid/authorize','/other','/invite?token=secret','/authorize#token=secret','javascript:alert(1)'])assert.throws(()=>safeSignInReturn(path,origin));
});
test('proposal requires supported scopes and both grant and consent deadlines',()=>{
 assert.equal(validProposal(proposal),true);assert.equal(validProposal({...proposal,consentExpiresAt:''}),false);assert.equal(validProposal({...proposal,scopes:[{id:'invitations:write',label:'Invite',selected:true}]}),false);assert.equal(validProposal({...proposal,scopes:[{id:'content:schedule',label:'Publish',selected:true}]}),false);assert.equal(validProposal({...proposal,clients:[...proposal.clients,...proposal.clients]}),false);
});
test('new-client creation and every write permission start unchecked',()=>{
 for(const id of ['clients:write','projects:write','metrics:write','content:write','offline_access'])assert.equal(defaultScopeSelected({id,selected:true}),false);
 assert.equal(defaultScopeSelected({id:'metrics:read',selected:true}),true);assert.equal(defaultScopeSelected({id:'mcp:connect',selected:true}),true);assert.equal(defaultScopeSelected({id:'metrics:read',selected:false}),false);
});
test('only verified redirect host and HTTPS or genuine loopback HTTP can receive return',()=>{
 assert.equal(consentRedirect('https://app.example.invalid/callback?code=test',proposal),'https://app.example.invalid/callback?code=test');
 for(const url of ['javascript:alert(1)','https://attacker.invalid/','http://app.example.invalid/callback','https://user@app.example.invalid/callback'])assert.throws(()=>consentRedirect(url,proposal));
 const local={...proposal,client:{...proposal.client,redirectHost:'127.0.0.1:5000',isLoopback:true}};assert.equal(consentRedirect('http://127.0.0.1:5000/callback',local),'http://127.0.0.1:5000/callback');assert.throws(()=>consentRedirect('http://127.0.0.1:5001/callback',local));assert.throws(()=>consentRedirect('http://app.example.invalid/callback',{...proposal,client:{...proposal.client,isLoopback:true}}));
});

test('proposal accepts explicit read and optional persistence and labels unverified client domains',()=>{
 assert.equal(validProposal({...proposal,client:{...proposal.client,domain:null},scopes:[...proposal.scopes,{id:'clients:read',label:'Read clients',selected:true},{id:'offline_access',label:'Keep this connection',selected:false}]}),true);
});

test('complete backend-shaped proposal supports every real scope and preserves safe defaults',()=>{
 const backendProposal:ConsentProposal={...proposal,client:{...proposal.client,domain:null},scopes:Object.entries(OAUTH_SCOPE_LABELS).map(([id,label])=>({id,label,selected:id==='mcp:connect'||id.endsWith(':read')})),accessTokenExpiresInSeconds:900,refreshEnabled:true};
 assert.equal(validProposal(backendProposal),true);
 for(const scope of backendProposal.scopes)assert.equal(defaultScopeSelected(scope),scope.id==='mcp:connect'||scope.id.endsWith(':read'));
 assert.equal(validProposal({...backendProposal,scopes:[...backendProposal.scopes,{id:'admin:write',label:'Unknown scope',selected:false}]}),false);
});
test('consent renders the full server label and discloses client creation, access and opt-in refresh',async()=>{
 const ui=await readFile(new URL('../src/scripts/authorize.ts',import.meta.url),'utf8');
 assert.match(ui,/choice\(\$\('consent-scopes'\),scope.id,scope.label,/);
 assert.match(ui,/gain access to each new client, and update selected existing clients/);
 assert.match(ui,/Without selecting Keep this connection, access lasts only 15 minutes/);
 assert.match(ui,/Selecting it allows refresh until the maximum expiry or revocation/);
 assert.match(ui,/OPTIONAL PERSISTENT ACCESS · Starts unchecked/);
});

test('directory-form consent navigation normalizes only its path and preserves opaque query',()=>{
 const query='?client_id=test&state=opaque%2Bvalue%20with+spaces&code_challenge=xyz&redirect_uri=https%3A%2F%2Fapp.example.invalid%2Fcallback%3Fx%3D1';
 assert.equal(safeSignInReturn('/authorize/'+query,origin),origin+'/authorize'+query);
 assert.equal(safeSignInReturn('/authorize'+query,origin),origin+'/authorize'+query);
 assert.throws(()=>safeSignInReturn('/authorize//'+query,origin));
});


test('ongoing consent requires refresh, exact inactivity disclosure and an unchecked offline choice',()=>{
 const ongoing:ConsentProposal={...proposal,connectionMode:'ongoing',refreshEnabled:true,idleTimeoutSeconds:2592000,scopes:[...proposal.scopes,{id:'offline_access',label:'Keep connected until I revoke access',selected:false}]};
 assert.equal(validProposal(ongoing),true);
 assert.equal(defaultScopeSelected(ongoing.scopes[1]),false);
 for(const change of [{refreshEnabled:false},{idleTimeoutSeconds:900},{scopes:proposal.scopes},{scopes:{}},{connectionMode:'forever'}])assert.equal(validProposal({...ongoing,...change} as ConsentProposal),false);
 assert.equal(validProposal({...proposal,connectionMode:'bounded'}),true);
});
test('connected apps sign-in return permits only the fixed local route',()=>{
 assert.equal(safeSignInReturn('/connections',origin),origin+'/connections');
 assert.equal(safeSignInReturn('/connections/',origin),origin+'/connections');
 for(const path of ['/connections?redirect=https://attacker.invalid','/connections#id','//attacker.invalid/connections','/connections/other'])assert.throws(()=>safeSignInReturn(path,origin));
});
