import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {rolldown} from 'rolldown';
import {Miniflare} from 'miniflare';
import {validProposal} from '../web/src/scripts/oauth-state.ts';
const origin='https://content.unreelviews.com';

test('OAuth provider discovery, consent, PKCE, audience, replay and revocation',async t=>{
 const bundle=await rolldown({input:'tests/fixtures/oauth-worker.ts',external:['cloudflare:workers','node:async_hooks','node:process'],platform:'neutral',resolve:{mainFields:['module','main']}});
 const {output}=await bundle.generate({format:'esm'});await bundle.close();
 const code=output.find(o=>o.type==='chunk')!;assert.equal(code.type,'chunk');
 const mf=new Miniflare({workers:[{config:{name:'oauth-protocol-test',compatibilityDate:'2026-11-10',compatibilityFlags:['global_fetch_strictly_public','nodejs_compat'],manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:code.code}}},env:{DB:{type:'d1',name:'oauth-protocol'},OAUTH_KV:{type:'kv',id:'oauth-kv'},MCP_OAUTH_ENABLED:{type:'text',value:'true'},ADMIN_ACCESS_ENABLED:{type:'text',value:'true'},CLERK_AUTH_ENABLED:{type:'text',value:'true'},CLERK_SECRET_KEY:{type:'text',value:'synthetic-not-a-secret'},CLERK_PUBLISHABLE_KEY:{type:'text',value:'pk_test_'+Buffer.from('identity.test$').toString('base64')},CLERK_ISSUER:{type:'text',value:'https://identity.test'},APP_ORIGIN:{type:'text',value:origin}}}}]});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  let sql=(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
  const triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[];for(const trigger of triggers)sql=sql.replace(trigger,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();for(const trigger of triggers)await db.prepare(trigger).run();
 }
 await db.prepare("INSERT INTO tenants VALUES('a','Synthetic agency')").run();
 await db.prepare(`INSERT INTO oauth_operators VALUES('operator','a','https://identity.test','user_1','marco@hexacombllc.com','["mcp:connect","metrics:read","clients:write","offline_access"]','2099-01-01',NULL)`).run();
 const send=(path:string,init?:Parameters<typeof mf.dispatchFetch>[1])=>mf.dispatchFetch(path.startsWith('https:')?path:origin+path,init);
 const metadata=await send('/.well-known/oauth-authorization-server');assert.equal(metadata.status,200);assert.equal((await metadata.json() as any).issuer,origin);
 const anon=await send('/mcp');assert.equal(anon.status,401);assert.match(anon.headers.get('WWW-Authenticate')!,/oauth-protected-resource\/mcp/);
 const resource=await send('/.well-known/oauth-protected-resource/mcp');assert.equal((await resource.json() as any).resource,origin+'/mcp');
 for(const length of ['omit','lie']) {
  // Construct a stream inside workerd: Node's HTTP client correctly refuses to
  // transmit a false Content-Length before our Worker would see it.
  const oversized=await send('/test/oversized-token?length='+length);
  assert.equal(oversized.status,413);
 }
 assert.equal((await send('/oauth/token',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=test'},body:'x'})).status,415);
 const client=await (await send('/test/client')).json() as {clientId:string};assert.ok(client.clientId);
 const verifier='synthetic_verifier_'.padEnd(64,'x');const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const authorize=new URL(origin+'/authorize');authorize.search=new URLSearchParams({client_id:client.clientId,redirect_uri:'https://client.test/callback',response_type:'code',resource:origin+'/mcp',scope:'mcp:connect metrics:read offline_access',state:'state-value',code_challenge:challenge,code_challenge_method:'S256'}).toString();
 const headers={Accept:'application/json','X-Test-Identity':'owner'};
 assert.equal((await send(authorize.href,{headers:{Accept:'application/json'}})).status,401);
 const invalid=new URL(authorize);invalid.searchParams.set('redirect_uri','https://evil.test/callback');assert.equal((await send(invalid.href,{headers})).status,400);
 invalid.search=authorize.search;invalid.searchParams.set('resource','https://evil.test/mcp');assert.equal((await send(invalid.href,{headers})).status,400);
 invalid.search=authorize.search;invalid.searchParams.delete('code_challenge');assert.equal((await send(invalid.href,{headers})).status,400);
 const start=async()=>{const response=await send(authorize.href,{headers});assert.equal(response.status,200,await response.clone().text());return {proposal:await response.json() as any,cookie:response.headers.get('set-cookie')!.split(';')[0]};};
 const approve=async (consent:Awaited<ReturnType<typeof start>>, extra:Record<string,unknown>={},cookie=consent.cookie)=>send(authorize.href,{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify({handle:consent.proposal.handle,decision:'approve',scopes:['mcp:connect','metrics:read','offline_access'],clientIds:[],...extra})});
 // Directory-form requests reach the same canonical provider endpoint without redirects.
 const alias=new URL(authorize);alias.pathname='/authorize/';alias.searchParams.set('state','opaque+value with spaces&equals=1');
 const aliasProposal=await send(alias.href,{headers,redirect:'manual'});assert.equal(aliasProposal.status,200);assert.equal(aliasProposal.headers.get('Location'),null);
 const aliasData=await aliasProposal.json() as any;
 const aliasDeny=await send(alias.href,{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json',Cookie:aliasProposal.headers.get('set-cookie')!.split(';')[0]},body:JSON.stringify({handle:aliasData.handle,decision:'deny',scopes:[],clientIds:[]}),redirect:'manual'});
 assert.equal(aliasDeny.status,200);assert.equal(aliasDeny.headers.get('Location'),null);assert.equal(new URL((await aliasDeny.json() as any).redirectTo).searchParams.get('state'),'opaque+value with spaces&equals=1');
 let consent=await start();assert.equal(consent.proposal.client.redirectHost,'client.test');assert.equal(consent.proposal.refreshEnabled,true);
 assert.equal((await approve(consent,{scopes:['mcp:connect','clients:write']})).status,403);
 assert.equal((await approve(consent,{},'')).status,400);
 consent=await start();
 const denied=await approve(consent,{decision:'deny'});assert.equal(denied.status,200);assert.equal(new URL((await denied.json() as any).redirectTo).searchParams.get('error'),'access_denied');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM oauth_delegations').first<{n:number}>())?.n,0);
 consent=await start();
 const concurrent=await Promise.all([approve(consent),approve(consent)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,403]);
 consent=await start();const approval=await approve(consent);assert.equal(approval.status,200,await approval.clone().text());
 const redirect=new URL((await approval.json() as any).redirectTo);assert.equal(redirect.origin,'https://client.test');assert.equal(redirect.searchParams.get('state'),'state-value');assert.equal(redirect.searchParams.get('iss'),origin);
 assert.equal((await approve(consent)).status,403);
 const codeValue=redirect.searchParams.get('code')!;
 const exchange=async(extra:Record<string,string>={})=>send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.clientId,redirect_uri:'https://client.test/callback',code:codeValue,code_verifier:verifier,resource:origin+'/mcp',...extra}).toString()});
 assert.equal((await exchange({resource:'https://evil.test/mcp'})).status,400);
 assert.equal((await exchange({code_verifier:'wrong'})).status,400);
 const exchanged=await exchange();assert.equal(exchanged.status,200,await exchanged.clone().text());const token=await exchanged.json() as any;assert.ok(token.access_token);assert.ok(token.refresh_token);
 const authorized=await send('/mcp?testPrincipal',{headers:{Authorization:'Bearer '+token.access_token}});assert.equal(authorized.status,200);
 assert.deepEqual((await authorized.json() as any).principal.scopes,['mcp:connect','metrics:read','offline_access']);
 const refresh=()=>send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:client.clientId,refresh_token:token.refresh_token,resource:origin+'/mcp'}).toString()});
 assert.equal((await refresh()).status,200);
 await db.prepare("UPDATE oauth_delegations SET revoked_at='2026-01-01'").run();
 assert.equal((await send('/mcp?testPrincipal',{headers:{Authorization:'Bearer '+token.access_token}})).status,401);
 assert.equal((await refresh()).status,400);
 assert.equal((await exchange()).status,400);
 // No refresh token is issued when the person leaves persistent access unchecked.
 consent=await start();const shortApproval=await approve(consent,{scopes:['mcp:connect','metrics:read']});assert.equal(shortApproval.status,200);
 const shortCode=new URL((await shortApproval.json() as any).redirectTo).searchParams.get('code')!;
 const shortResponse=await exchange({code:shortCode});assert.equal(shortResponse.status,200);
 assert.equal((await shortResponse.json() as any).refresh_token,undefined);

 // Actual MCP tool discovery remains useful at baseline, with no business access.
 await db.prepare(`UPDATE oauth_operators SET scopes_json='["mcp:connect","clients:read","clients:write","metrics:read"]' WHERE id='operator'`).run();
 const grant=async(scopes:string[])=>{
  authorize.searchParams.set('scope',scopes.join(' '));const current=await start();
  const allowed=await approve(current,{scopes});assert.equal(allowed.status,200,await allowed.clone().text());
  const newCode=new URL((await allowed.json() as any).redirectTo).searchParams.get('code')!;
  const result=await exchange({code:newCode});assert.equal(result.status,200,await result.clone().text());return (await result.json() as any).access_token as string;
 };
 const mcp=async(accessToken:string,method:string,params:Record<string,unknown>={},forbidBusinessDb=false)=>{
  const result=await send('/mcp',{method:'POST',headers:{'X-Test-Forbid-Business-DB':String(forbidBusinessDb),Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal(result.status,200,await result.clone().text());
  const raw=await result.text();return JSON.parse(raw.startsWith('event:')?raw.split('\n').find(l=>l.startsWith('data: '))!.slice(6):raw);
 };
 const baseline=await grant(['mcp:connect']);
 const listed=(await mcp(baseline,'tools/list',{},true)).result.tools as any[];
 assert.ok(listed.some(tool=>tool.name==='create_client'));
 assert.ok(listed.some(tool=>tool.name==='list_clients'));
 assert.ok(!listed.some(tool=>tool.name==='define_metric'||tool.name==='send_invitation'));
 const descriptor=listed.find(tool=>tool.name==='create_client');
 assert.deepEqual(descriptor.securitySchemes,[{type:'oauth2',scopes:['mcp:connect','clients:write']}]);
 assert.deepEqual(descriptor._meta.securitySchemes,descriptor.securitySchemes);
 const input={clientId:'created-through-mcp',name:'Synthetic client',timezone:'UTC',expectedRevision:0,idempotencyKey:'oauth-mcp-create-key'};
 for(const [name,args] of [['list_clients',{}],['create_client',input]] as const){
  const deniedTool=(await mcp(baseline,'tools/call',{name,arguments:args},true)).result;
  assert.equal(deniedTool.isError,true);
  const challengeValue=deniedTool._meta['mcp/www_authenticate'][0] as string;
  assert.match(challengeValue,/error="insufficient_scope"/);assert.match(challengeValue,/error_description=/);
  assert.match(challengeValue,/resource_metadata="https:\/\/content.unreelviews.com\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.ok(!JSON.stringify(deniedTool).includes('Synthetic agency'));
 }
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM clients').first<{n:number}>())?.n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM workspace_events').first<{n:number}>())?.n,0);
 const reader=await grant(['mcp:connect','clients:read']);
 const empty=(await mcp(reader,'tools/call',{name:'list_clients',arguments:{}})).result;
 assert.notEqual(empty.isError,true);assert.deepEqual(JSON.parse(empty.content[0].text),[]);
 assert.equal((await mcp(reader,'tools/call',{name:'create_client',arguments:input})).result.isError,true);
 const writer=await grant(['mcp:connect','clients:read','clients:write']);
 const created=(await mcp(writer,'tools/call',{name:'create_client',arguments:input})).result;
 assert.notEqual(created.isError,true,JSON.stringify(created));
 const visible=(await mcp(writer,'tools/call',{name:'list_clients',arguments:{}})).result;
 assert.equal(JSON.parse(visible.content[0].text)[0].id,input.clientId);
 await db.prepare(`UPDATE oauth_operators SET scopes_json='["mcp:connect","clients:read"]' WHERE id='operator'`).run();
 assert.ok(!(await mcp(writer,'tools/list')).result.tools.some((tool:any)=>tool.name==='create_client'));
 assert.ok((await mcp(writer,'tools/call',{name:'create_client',arguments:{...input,clientId:'forbidden',idempotencyKey:'forbidden-create-key'}})).error);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM clients').first<{n:number}>())?.n,1);
 // ChatGPT can send Base scopes plus the same default checkbox scope. Duplicate
 // requested tokens are one permission, but duplicate selections stay invalid.
 authorize.searchParams.set('scope','mcp:connect mcp:connect');
 const duplicateConsent=await start();
 assert.equal(validProposal(duplicateConsent.proposal),true);
 assert.deepEqual(duplicateConsent.proposal.scopes.map((scope:{id:string})=>scope.id),['mcp:connect']);
 assert.equal(duplicateConsent.proposal.refreshEnabled,false);
 const pendingDuplicate=await db.prepare('SELECT requested_scopes_json FROM oauth_pending_consents WHERE oauth_client_id=? ORDER BY rowid DESC LIMIT 1').bind(client.clientId).first<{requested_scopes_json:string}>();
 assert.deepEqual(JSON.parse(pendingDuplicate!.requested_scopes_json),['mcp:connect']);
 assert.equal((await approve(duplicateConsent,{scopes:['mcp:connect','mcp:connect']})).status,403);
 const duplicateApproval=await approve(duplicateConsent,{scopes:['mcp:connect']});
 assert.equal(duplicateApproval.status,200);
 const duplicateCode=new URL((await duplicateApproval.json() as any).redirectTo).searchParams.get('code')!;
 const duplicateExchange=await exchange({code:duplicateCode});assert.equal(duplicateExchange.status,200);
 const duplicateToken=await duplicateExchange.json() as any;
 assert.equal(duplicateToken.scope,'mcp:connect');assert.equal(duplicateToken.refresh_token,undefined);
 const duplicatePrincipal=await send('/mcp?testPrincipal',{headers:{Authorization:'Bearer '+duplicateToken.access_token}});
 assert.equal(duplicatePrincipal.status,200);assert.deepEqual((await duplicatePrincipal.json() as any).principal.scopes,['mcp:connect']);


});
