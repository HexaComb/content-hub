import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {rolldown} from 'rolldown';
import {Miniflare} from 'miniflare';
import {handleConnectionManagement} from '../src/oauthConnections.ts';
import {operatorActive,connectionDeadline,proposedConnectionMode,ONGOING_IDLE_TTL} from '../src/oauthLifetime.ts';
const origin='https://content.unreelviews.com';
test('ongoing lifetime is explicit, bounded scopes never gain persistence',()=>{
 const now=Date.parse('2030-01-01T00:00:00Z'),expires_at='2030-01-01T01:00:00.000Z';
 assert.equal(operatorActive({expires_at:'2000-01-01',connection_mode:'bounded'},now),false);
 assert.equal(operatorActive({expires_at:'2000-01-01',connection_mode:'ongoing'},now),true);
 assert.equal(proposedConnectionMode({connection_mode:'ongoing'},['mcp:connect']),'bounded');
 assert.equal(proposedConnectionMode({connection_mode:'bounded'},['offline_access']),'bounded');
 assert.equal(connectionDeadline({expires_at,connection_mode:'bounded'},'bounded',['offline_access'],now),expires_at);
 assert.equal(connectionDeadline({expires_at,connection_mode:'ongoing'},'bounded',['mcp:connect'],now),'2030-01-01T00:15:00.000Z');
 assert.throws(()=>connectionDeadline({expires_at,connection_mode:'bounded'},'ongoing',['offline_access'],now));
 assert.throws(()=>connectionDeadline({expires_at,connection_mode:'ongoing'},'ongoing',['mcp:connect'],now));
});
test('ongoing consent, rotated refresh, idle expiry, isolation, bounded legacy and self-service revoke',async t=>{
 const bundle=await rolldown({input:'tests/fixtures/oauth-worker.ts',external:['cloudflare:workers','node:async_hooks','node:process'],platform:'neutral',resolve:{mainFields:['module','main']}});
 const {output}=await bundle.generate({format:'esm'});await bundle.close();const code=output.find(o=>o.type==='chunk')!;assert.equal(code.type,'chunk');
 const mf=new Miniflare({workers:[{config:{name:'ongoing-oauth-test',compatibilityDate:'2026-11-10',compatibilityFlags:['global_fetch_strictly_public','nodejs_compat'],manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:code.code}}},env:{DB:{type:'d1',name:'ongoing-oauth'},OAUTH_KV:{type:'kv',id:'ongoing-kv'},MCP_OAUTH_ENABLED:{type:'text',value:'true'},ADMIN_ACCESS_ENABLED:{type:'text',value:'true'},CLERK_AUTH_ENABLED:{type:'text',value:'true'},CLERK_SECRET_KEY:{type:'text',value:'synthetic-not-a-secret'},CLERK_PUBLISHABLE_KEY:{type:'text',value:'pk_test_'+Buffer.from('identity.test$').toString('base64')},CLERK_ISSUER:{type:'text',value:'https://identity.test'},APP_ORIGIN:{type:'text',value:origin}}}}]});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let sql=(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[];for(const trigger of triggers)sql=sql.replace(trigger,'');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();for(const trigger of triggers)await db.prepare(trigger).run();
 }
 await db.prepare("INSERT INTO tenants VALUES('a','Synthetic agency')").run();
 await db.prepare(`INSERT INTO oauth_operators(id,tenant_id,identity_issuer,identity_subject,verified_email,scopes_json,expires_at) VALUES('operator','a','https://identity.test','user_1','marco@hexacombllc.com','["mcp:connect","metrics:read","offline_access"]','2099-01-01')`).run();
 const send=(path:string,init?:Parameters<typeof mf.dispatchFetch>[1])=>mf.dispatchFetch(path.startsWith('https:')?path:origin+path,init);
 const client=await (await send('/test/client')).json() as any;
 const verifier='synthetic_verifier_'.padEnd(64,'x'),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const authorize=new URL(origin+'/authorize');authorize.search=new URLSearchParams({client_id:client.clientId,redirect_uri:'https://client.test/callback',response_type:'code',resource:origin+'/mcp',scope:'mcp:connect metrics:read offline_access',state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256'}).toString();
 const headers={Accept:'application/json','X-Test-Identity':'owner'};
 const start=async()=>{const r=await send(authorize.href,{headers});assert.equal(r.status,200,await r.clone().text());return {proposal:await r.json() as any,cookie:r.headers.get('set-cookie')!.split(';')[0]};};
 const approve=async(c:any,scopes=['mcp:connect','metrics:read','offline_access'],mode:string|undefined=c.proposal.connectionMode)=>send(authorize.href,{method:'POST',headers:{...headers,Origin:origin,Cookie:c.cookie,'Content-Type':'application/json'},body:JSON.stringify({handle:c.proposal.handle,decision:'approve',scopes,clientIds:[],...(mode===undefined?{}:{connectionMode:mode})})});
 const exchange=async(code:string)=>send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.clientId,redirect_uri:'https://client.test/callback',code,code_verifier:verifier,resource:origin+'/mcp'}).toString()});
 const grant=async(scopes?:string[])=>{const c=await start(),a=await approve(c,scopes);assert.equal(a.status,200,await a.clone().text());const redirect=new URL((await a.json() as any).redirectTo);const r=await exchange(redirect.searchParams.get('code')!);assert.equal(r.status,200,await r.clone().text());const token=await r.json() as any;const row=await db.prepare('SELECT * FROM oauth_delegations ORDER BY rowid DESC LIMIT 1').first<any>();return {c,token,row};};
 const refresh=(token:string,extra:Record<string,string>={},failDb=false)=>send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},...failDb?{headers:{'Content-Type':'application/x-www-form-urlencoded','X-Test-Fail-Refresh-DB':'true'}}:{},body:new URLSearchParams({grant_type:'refresh_token',client_id:client.clientId,refresh_token:token,resource:origin+'/mcp',...extra}).toString()});
 // Existing authorization is bounded. Switching operator policy never upgrades it.
 const bounded=await grant();assert.equal(bounded.row.connection_mode,'bounded');assert.ok(bounded.token.refresh_token);
 await db.prepare("UPDATE oauth_operators SET connection_mode='ongoing' WHERE id='operator'").run();
 const boundedRefresh=await refresh(bounded.token.refresh_token);assert.equal(boundedRefresh.status,200);
 assert.equal((await db.prepare('SELECT expires_at FROM oauth_delegations WHERE id=?').bind(bounded.row.id).first<any>()).expires_at,bounded.row.expires_at);
 await assert.rejects(db.prepare("UPDATE oauth_delegations SET connection_mode='ongoing' WHERE id=?").bind(bounded.row.id).run());
 // Legacy clients cannot accept ongoing duration without showing the new disclosure.
 let c=await start();assert.equal(c.proposal.connectionMode,'ongoing');assert.equal(c.proposal.idleTimeoutSeconds,ONGOING_IDLE_TTL);assert.equal(c.proposal.scopes.find((s:any)=>s.id==='offline_access').selected,false);
 assert.equal((await approve(c,undefined,'bounded')).status,403);
 // Omitting optional offline access remains a short, non-refreshable connection.
 const short=await grant(['mcp:connect','metrics:read']);assert.equal(short.row.connection_mode,'bounded');assert.equal(short.token.refresh_token,undefined);assert.ok(Date.parse(short.row.expires_at)<Date.now()+901000);
 const ongoing=await grant();assert.equal(ongoing.row.connection_mode,'ongoing');assert.ok(ongoing.token.refresh_token);assert.equal(ongoing.token.expires_in,900);
 await db.prepare('UPDATE oauth_delegations SET expires_at=? WHERE id=?').bind(new Date(Date.now()+120000).toISOString(),ongoing.row.id).run();await db.prepare('UPDATE principals SET expires_at=? WHERE id=?').bind(new Date(Date.now()+120000).toISOString(),ongoing.row.principal_id).run();
 assert.equal((await refresh(ongoing.token.refresh_token,{},true)).status,503);
 const r1=await refresh(ongoing.token.refresh_token);assert.equal(r1.status,200,await r1.clone().text());const t1=await r1.json() as any;assert.notEqual(t1.refresh_token,ongoing.token.refresh_token);
 const renewed=await db.prepare('SELECT expires_at FROM oauth_delegations WHERE id=?').bind(ongoing.row.id).first<any>();assert.ok(Date.parse(renewed.expires_at)>Date.now()+(ONGOING_IDLE_TTL-5)*1000);
 const r2=await refresh(t1.refresh_token);assert.equal(r2.status,200);const t2=await r2.json() as any;assert.notEqual(t2.refresh_token,t1.refresh_token);assert.equal((await refresh(ongoing.token.refresh_token)).status,400);
 // Read-only scopes, client boundaries and audience still apply.
 assert.equal((await refresh(t2.refresh_token,{resource:'https://evil.test/mcp'})).status,400);
 const principal=await send('/mcp?testPrincipal',{headers:{Authorization:'Bearer '+t2.access_token}});assert.equal(principal.status,200);assert.deepEqual((await principal.json() as any).principal.scopes,['mcp:connect','metrics:read','offline_access']);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM client_grants').first<any>()).n,0);
 assert.equal((await send('/api/oauth/connections')).status,401);
 const other=await send('/api/oauth/connections',{headers:{...headers,'X-Test-Identity':'other'}});assert.deepEqual((await other.json() as any).connections,[]);
 const revokedPath='/api/oauth/connections/'+ongoing.row.id+'/revoke';
 assert.equal((await send(revokedPath,{method:'POST',headers:{...headers,Origin:'https://evil.test'}})).status,403);
 assert.equal((await send(revokedPath,{method:'POST',headers:{...headers,Origin:origin,'X-Test-Identity':'other'}})).status,404);
 const revoked=await send(revokedPath,{method:'POST',headers:{...headers,Origin:origin}});assert.equal(revoked.status,200);assert.deepEqual(await revoked.json(),{revoked:true,providerRevocationPending:false});
 assert.equal((await send('/mcp?testPrincipal',{headers:{Authorization:'Bearer '+t2.access_token}})).status,401);assert.equal((await refresh(t2.refresh_token)).status,400);
 const count=await db.prepare("SELECT COUNT(*) n FROM oauth_connection_events WHERE event='revoked' AND delegation_id=?").bind(ongoing.row.id).first<any>();assert.equal(count.n,1);
 assert.equal((await send(revokedPath,{method:'POST',headers:{...headers,Origin:origin}})).status,200);assert.equal((await db.prepare("SELECT COUNT(*) n FROM oauth_connection_events WHERE event='revoked' AND delegation_id=?").bind(ongoing.row.id).first<any>()).n,1);
 // Scope revocation or idle expiration cannot be revived by refreshing.
 const scoped=await grant();await db.prepare(`UPDATE oauth_operators SET scopes_json='["mcp:connect","metrics:read"]' WHERE id='operator'`).run();assert.equal((await refresh(scoped.token.refresh_token)).status,400);
 await db.prepare(`UPDATE oauth_operators SET scopes_json='["mcp:connect","metrics:read","offline_access"]' WHERE id='operator'`).run();const idle=await grant();await db.prepare("UPDATE oauth_delegations SET expires_at='2000-01-01' WHERE id=?").bind(idle.row.id).run();assert.equal((await refresh(idle.token.refresh_token)).status,400);
 // A displayed finite maximum is retained if operator policy changes before approval.
 await db.prepare("UPDATE oauth_operators SET connection_mode='bounded',expires_at=? WHERE id='operator'").bind(new Date(Date.now()+3600000).toISOString()).run();c=await start();await db.prepare("UPDATE oauth_operators SET connection_mode='ongoing' WHERE id='operator'").run();const changed=await approve(c);assert.equal(changed.status,200);const changedRow=await db.prepare('SELECT * FROM oauth_delegations ORDER BY rowid DESC LIMIT 1').first<any>();assert.equal(changedRow.expires_at,c.proposal.expiresAt);assert.equal(changedRow.connection_mode,'bounded');
 // Cleanup failure leaves D1 revocation authoritative and can be retried by its owner.
 const cleanup=await grant();const identity=async()=>({issuer:'https://identity.test',subject:'user_1',sessionId:'synthetic',email:'marco@hexacombllc.com'});const request=new Request(origin+'/api/oauth/connections/'+cleanup.row.id+'/revoke',{method:'POST',headers:{Origin:origin}});let attempts=0;
 const failed=await handleConnectionManagement(request,{DB:db} as any,identity,async()=>{attempts++;throw Error('synthetic provider outage');});assert.deepEqual(await failed.json(),{revoked:true,providerRevocationPending:true});
 const listed=await send('/api/oauth/connections',{headers});const listedRow=(await listed.json() as any).connections.find((r:any)=>r.id===cleanup.row.id);assert.equal(listedRow.authorizationActive,false);assert.equal(listedRow.cleanupPending,1);
 await handleConnectionManagement(request,{DB:db} as any,identity,async()=>{attempts++;});assert.equal(attempts,2);
 for(let i=0;i<105;i++){
  const id='page-'+String(i).padStart(3,'0'),created=new Date(Date.now()+i*1000).toISOString();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json,auth_kind) VALUES('a',?,'Synthetic page',?,'2099-01-01','[]','oauth')").bind(id,('oauth:'+id).padEnd(64,'_')).run();
  await db.prepare("INSERT INTO oauth_delegations(id,tenant_id,operator_id,principal_id,oauth_client_id,created_at,expires_at) VALUES(?,'a','operator',?,?,?,'2099-01-01')").bind(id,id,client.clientId,created).run();
 }
 const firstPage=await (await send('/api/oauth/connections',{headers})).json() as any;assert.equal(firstPage.connections.length,100);assert.ok(firstPage.nextCursor);
 const nextPage=await (await send('/api/oauth/connections?'+new URLSearchParams({cursor:firstPage.nextCursor}),{headers})).json() as any;assert.ok(nextPage.connections.some((row:any)=>row.id===bounded.row.id));assert.equal(nextPage.nextCursor,null);
 assert.equal((await send('/api/oauth/connections?cursor=invalid',{headers})).status,400);
 await db.prepare("UPDATE oauth_operators SET revoked_at='2000-01-01' WHERE id='operator'").run();assert.equal((await send('/api/oauth/connections',{headers})).status,200);
 await assert.rejects(db.prepare("UPDATE oauth_connection_events SET event='revoked'").run());await assert.rejects(db.prepare('DELETE FROM oauth_operator_policy_events').run());
 const audit=JSON.stringify((await db.prepare('SELECT * FROM oauth_connection_events').all()).results);assert.ok(!audit.includes(ongoing.token.refresh_token));assert.ok(!audit.includes(ongoing.token.access_token));
});
