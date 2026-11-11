import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {rolldown} from 'rolldown';
import {Miniflare} from 'miniflare';
import {resolveOAuthPrincipal} from '../src/oauthAccess.ts';
import {authorize as authorizeClient} from '../src/auth.ts';
import {repository} from '../src/repository.ts';
const origin='https://content.unreelviews.com';
test('Muse app policy and explicit all-client consent preserve tenant, legacy, scope and revocation isolation',async t=>{
 const bundle=await rolldown({input:'tests/fixtures/oauth-worker.ts',external:['cloudflare:workers','node:async_hooks','node:process'],platform:'neutral',resolve:{mainFields:['module','main']}});
 const {output}=await bundle.generate({format:'esm'});await bundle.close();const code=output.find(o=>o.type==='chunk')!;assert.equal(code.type,'chunk');
 const mf=new Miniflare({workers:[{config:{name:'ongoing-oauth-test',compatibilityDate:'2026-11-10',compatibilityFlags:['global_fetch_strictly_public','nodejs_compat'],manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:code.code}}},env:{DB:{type:'d1',name:'ongoing-oauth'},OAUTH_KV:{type:'kv',id:'ongoing-kv'},MCP_OAUTH_ENABLED:{type:'text',value:'true'},ADMIN_ACCESS_ENABLED:{type:'text',value:'true'},CLERK_AUTH_ENABLED:{type:'text',value:'true'},CLERK_SECRET_KEY:{type:'text',value:'synthetic-not-a-secret'},CLERK_PUBLISHABLE_KEY:{type:'text',value:'pk_test_'+Buffer.from('identity.test$').toString('base64')},CLERK_ISSUER:{type:'text',value:'https://identity.test'},APP_ORIGIN:{type:'text',value:origin}}}}]});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let sql=(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[];for(const trigger of triggers)sql=sql.replace(trigger,'');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();for(const trigger of triggers)await db.prepare(trigger).run();
 }
 await db.prepare("INSERT INTO tenants VALUES('a','Synthetic agency')").run();
 await db.prepare(`INSERT INTO oauth_operators(id,tenant_id,identity_issuer,identity_subject,verified_email,scopes_json,expires_at) VALUES('operator','a','https://identity.test','user_1','marco@hexacombllc.com','["mcp:connect","clients:read","projects:read","projects:write","metrics:read","metrics:write","offline_access"]','2099-01-01')`).run();
 const send=(path:string,init?:Parameters<typeof mf.dispatchFetch>[1])=>mf.dispatchFetch(path.startsWith('https:')?path:origin+path,init);
 const client=await (await send('/test/client')).json() as any;
 const verifier='synthetic_verifier_'.padEnd(64,'x'),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const authorize=new URL(origin+'/authorize');authorize.search=new URLSearchParams({client_id:client.clientId,redirect_uri:'https://client.test/callback',response_type:'code',resource:origin+'/mcp',scope:'mcp:connect clients:read projects:read projects:write metrics:read metrics:write offline_access',state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256'}).toString();
 const headers={Accept:'application/json','X-Test-Identity':'owner'};
 const start=async()=>{const r=await send(authorize.href,{headers});assert.equal(r.status,200,await r.clone().text());return {proposal:await r.json() as any,cookie:r.headers.get('set-cookie')!.split(';')[0]};};
 const approve=async(c:any,scopes=['mcp:connect','metrics:read','offline_access'],mode:string|undefined=c.proposal.connectionMode)=>send(authorize.href,{method:'POST',headers:{...headers,Origin:origin,Cookie:c.cookie,'Content-Type':'application/json'},body:JSON.stringify({handle:c.proposal.handle,decision:'approve',scopes,clientIds:[],...(mode===undefined?{}:{connectionMode:mode})})});
 const exchange=async(code:string)=>send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.clientId,redirect_uri:'https://client.test/callback',code,code_verifier:verifier,resource:origin+'/mcp'}).toString()});
 const grant=async(scopes?:string[])=>{const c=await start(),a=await approve(c,scopes);assert.equal(a.status,200,await a.clone().text());const redirect=new URL((await a.json() as any).redirectTo);const r=await exchange(redirect.searchParams.get('code')!);assert.equal(r.status,200,await r.clone().text());const token=await r.json() as any;const row=await db.prepare('SELECT * FROM oauth_delegations ORDER BY rowid DESC LIMIT 1').first<any>();return {c,token,row};};
 const refresh=(token:string,extra:Record<string,string>={},failDb=false)=>send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},...failDb?{headers:{'Content-Type':'application/x-www-form-urlencoded','X-Test-Fail-Refresh-DB':'true'}}:{},body:new URLSearchParams({grant_type:'refresh_token',client_id:client.clientId,refresh_token:token,resource:origin+'/mcp',...extra}).toString()});

 const scopes=['mcp:connect','clients:read','projects:read','projects:write','metrics:read','metrics:write','offline_access'];
 // An old unbound grant must not inherit new per-app eligibility.
 const legacy=await grant();
 await db.prepare("UPDATE oauth_operators SET expires_at='2000-01-01' WHERE id='operator'").run();
 const policyId='policy-generation-one';
 await db.prepare("INSERT INTO oauth_operator_app_policies VALUES(?,'operator',?,'ongoing','all',?,'2026-01-01',NULL)").bind(policyId,client.clientId,JSON.stringify(scopes)).run();
 assert.equal((await refresh(legacy.token.refresh_token)).status,400);
 const otherClient=await (await send('/test/client')).json() as any;
 const otherUrl=new URL(authorize);otherUrl.searchParams.set('client_id',otherClient.clientId);
 assert.equal((await send(otherUrl.href,{headers})).status,403);
 const c=await start();assert.equal(c.proposal.connectionMode,'ongoing');assert.equal(c.proposal.allClientsAllowed,true);
 const approveAll=async(proposal:any,clientAccessMode='all',selectedClients:string[]=[])=>send(authorize.href,{method:'POST',headers:{...headers,Origin:origin,Cookie:proposal.cookie,'Content-Type':'application/json'},body:JSON.stringify({handle:proposal.proposal.handle,decision:'approve',scopes,clientIds:selectedClients,connectionMode:'ongoing',clientAccessMode})});
 assert.equal((await approveAll(c,'all',['unmapped'])).status,403);
 const grantAll=async()=>{const c=await start(),a=await approveAll(c);assert.equal(a.status,200,await a.clone().text());const redirect=new URL((await a.json() as any).redirectTo);const r=await exchange(redirect.searchParams.get('code')!);assert.equal(r.status,200,await r.clone().text());return {token:await r.json() as any,row:await db.prepare('SELECT * FROM oauth_delegations ORDER BY rowid DESC LIMIT 1').first<any>()};};
 // An offered all-client policy does not automatically select it.
 const selected=await grant(scopes);assert.equal(selected.row.client_access_mode,'selected');assert.equal(selected.row.app_policy_id,policyId);
 const all=await grantAll();assert.equal(all.row.client_access_mode,'all');assert.equal(all.row.app_policy_id,policyId);assert.ok(all.token.refresh_token);
 await assert.rejects(db.prepare("UPDATE oauth_delegations SET client_access_mode='all' WHERE id=?").bind(selected.row.id).run());
 await db.prepare("INSERT INTO tenants VALUES('b','Other agency')").run();
 const addClient=async(tenant:string,id:string)=>{await db.prepare("INSERT INTO clients VALUES(?,?,?,'UTC')").bind(tenant,id,'Synthetic '+id).run();};
 await addClient('a','future');await addClient('b','foreign');
 const p=await resolveOAuthPrincipal(db,{delegationId:all.row.id},client.clientId,'operator',scopes);assert.ok(p);assert.deepEqual(p.oauthEligibleScopes,scopes);
 await authorizeClient(db,p,'future','metrics:write');await assert.rejects(authorizeClient(db,p,'foreign','metrics:read'));
 const sp=await resolveOAuthPrincipal(db,{delegationId:selected.row.id},client.clientId,'operator',scopes);assert.ok(sp);await assert.rejects(authorizeClient(db,sp,'future','metrics:read'));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM client_grants').first<any>()).n,0);
 // No silent 100-client truncation: the optional cursor reaches every same-tenant client.
 for(let i=0;i<104;i++)await addClient('a','page-'+String(i).padStart(3,'0'));
 const first=await repository(db,p).listClients(),next=await repository(db,p).listClients(String(first.at(-1)!.id));assert.equal(first.length,100);assert.equal(next.length,5);assert.ok(![...first,...next].some(x=>x.id==='foreign'));
 const rr=await refresh(all.token.refresh_token);assert.equal(rr.status,200,await rr.clone().text());const renewed=await rr.json() as any;
 // Dynamic boundary remains exact in connection management and audit.
 const list=await (await send('/api/oauth/connections',{headers})).json() as any;const listed=list.connections.find((x:any)=>x.id===all.row.id);assert.equal(listed.clientAccessMode,'all');assert.equal(listed.authorizationActive,true);
 const audit=await db.prepare("SELECT detail_json FROM oauth_connection_events WHERE delegation_id=? AND event='consent_approved'").bind(all.row.id).first<any>();assert.equal(JSON.parse(audit.detail_json).clientAccessMode,'all');
 const mcp=async(token:string,method:string,params:any)=>{const response=await send('/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const txt=await response.text();const data=txt.startsWith('event:')?JSON.parse(txt.split('data: ')[1].split('\n')[0]):JSON.parse(txt);return data;};
 const tools=(await mcp(renewed.access_token,'tools/list',{})).result.tools;assert.ok(tools.some((x:any)=>x.name==='update_project'));assert.ok(!tools.some((x:any)=>/invitation|publish|schedule_content|create_content/.test(x.name)));
 // Removing the policy blocks live access and refresh; replacement never revives old grants.
 await db.prepare("UPDATE oauth_operator_app_policies SET revoked_at='2026-01-02' WHERE id=?").bind(policyId).run();
 assert.equal(await resolveOAuthPrincipal(db,{delegationId:all.row.id},client.clientId,'operator',scopes),null);await assert.rejects(authorizeClient(db,p,'future','metrics:read'));assert.equal((await refresh(renewed.refresh_token)).status,400);
 await assert.rejects(db.prepare('UPDATE oauth_operator_app_policies SET revoked_at=NULL WHERE id=?').bind(policyId).run());
 await db.prepare("INSERT INTO oauth_operator_app_policies VALUES('policy-two','operator',?,'ongoing','all',?,'2026-01-03',NULL)").bind(client.clientId,JSON.stringify(scopes)).run();assert.equal(await resolveOAuthPrincipal(db,{delegationId:all.row.id},client.clientId,'operator',scopes),null);
 const last=await grantAll();await db.prepare("UPDATE oauth_operators SET revoked_at='2026-01-04' WHERE id='operator'").run();assert.equal((await refresh(last.token.refresh_token)).status,400);
 await assert.rejects(db.prepare('DELETE FROM oauth_app_policy_events').run());
});
