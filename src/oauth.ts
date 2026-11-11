import { OAuthAuthorizationServer, OAuthResourceServer, OAuthError, AuthorizationError, CimdFetchError, insufficientScope } from '@cloudflare/workers-oauth-provider';
import { PublicError, type Principal } from './auth.ts';
import { getHumanIdentity, type HumanIdentity } from './humanAuth.ts';
import { getAdminSession, adminAccessEnabled } from './admin.ts';
import { appOrigin, type InvitationEnv } from './mail.ts';
import { sha256 } from './domain.ts';
import { OAUTH_SCOPES, OAUTH_SCOPE_LABELS, getOperator, operatorClients, resolveOAuthPrincipal, scopeArray, validateSelection, type OAuthProps } from './oauthAccess.ts';

export const OAUTH_ISSUER='https://content.unreelviews.com';
export const OAUTH_RESOURCE=OAUTH_ISSUER+'/mcp';
const ACCESS_TTL=900, GRANT_TTL=7*24*60*60;
export type OAuthEnv=InvitationEnv & {DB:D1Database;OAUTH_KV?:KVNamespace;MCP_OAUTH_ENABLED?:string;REQUEST_LIMITER?:{limit(options:{key:string}):Promise<{success:boolean}>}};
function enabled(env:OAuthEnv):boolean {
 return env.MCP_OAUTH_ENABLED==='true' && !!env.OAUTH_KV && !!env.DB && adminAccessEnabled(env) && appOrigin(env)===OAUTH_ISSUER;
}
function json(body:unknown,status=200,headers?:Headers):Response {
 const h=new Headers(headers);h.delete('Location');h.set('Content-Type','application/json');h.set('Cache-Control','no-store');h.set('X-Frame-Options','DENY');h.set('Referrer-Policy','no-referrer');h.set('X-Content-Type-Options','nosniff');
 return new Response(JSON.stringify(body),{status,headers:h});
}
// Construction declares protocol policy only; it performs no issuance or writes.
export const authorizationServer=new OAuthAuthorizationServer<OAuthEnv>({
 issuer:OAUTH_ISSUER,resources:[OAUTH_RESOURCE],scopesSupported:OAUTH_SCOPES,
 clientIdMetadataDocumentEnabled:true,allowTokenExchangeGrant:false,
 accessTokenTTL:ACCESS_TTL,refreshTokenTTL:0,
 // Log only protocol codes, never client-supplied descriptions or error internals.
 onError:({code,status})=>{console.warn(JSON.stringify({event:'oauth_protocol_error',code,status}));},
 tokenExchangeCallback:async options=>{
  if(!enabled(options.env))throw new OAuthError('invalid_grant', {description:'The approved connection is no longer valid.'});
  const principal=await resolveOAuthPrincipal(options.env.DB,options.props,options.clientId,options.userId,options.requestedScope);
  if(!principal || !principal.scopes.includes('mcp:connect') || options.requestedScope.some(s=>!principal.scopes.includes(s)))throw new OAuthError('invalid_grant', {description:'The approved connection is no longer valid.'});
  await options.env.DB.prepare('UPDATE oauth_delegations SET oauth_grant_id=? WHERE id=? AND (oauth_grant_id IS NULL OR oauth_grant_id=?)').bind(options.grantId,(options.props as OAuthProps).delegationId,options.grantId).run();
  return {refreshTokenTTL:principal.scopes.includes('offline_access')?GRANT_TTL:0};
 },
});
export function isOAuthPath(path:string):boolean {
 return path==='/authorize' || path==='/authorize/' || path==='/oauth/token' || path.startsWith('/.well-known/oauth-');
}
/** null means the existing Astro asset handler should serve the consent shell. */
export async function handleOAuthRoute(request:Request,env:OAuthEnv,ctx:ExecutionContext, authenticateHuman:typeof getHumanIdentity=getHumanIdentity):Promise<Response|null> {
 const url=new URL(request.url);
 // Normalize the directory-form page internally; never redirect a consent POST
 // or rebuild its query through URLSearchParams (state is opaque).
 if(url.pathname==='/authorize/'){url.pathname='/authorize';request=new Request(url,request);}
 if(url.pathname==='/authorize' && request.method==='GET' && !request.headers.get('Accept')?.includes('application/json'))return null;
 if(url.origin!==OAUTH_ISSUER)return json({error:'Use the canonical Content Hub origin.'},400);
 if(!enabled(env))return json({error:'MCP authorization is not enabled or configured.'},503);
 try {
  if(env.REQUEST_LIMITER && !(await env.REQUEST_LIMITER.limit({key:`oauth:${request.headers.get('CF-Connecting-IP')??'unknown'}`})).success)return json({error:'Too many authorization requests. Try again shortly.'},429);
  if(url.pathname!=='/authorize') {
   if(url.pathname==='/oauth/token' && request.method==='POST') {
    // Bound actual bytes before the provider calls formData(); Content-Length is
    // optional and untrusted. OAuth token/revocation requests use URL encoding.
    if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')return json({error:'Use a URL-encoded OAuth request.'},415);
    const bounded=await boundedTokenRequest(request);
    if(!bounded)return json({error:'OAuth request body is too large.'},413);
    request=bounded;
   }
   return await authorizationServer.fetch(request,env,ctx);
  }
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
  if(request.method==='POST' && request.headers.get('Origin')!==OAUTH_ISSUER)return json({error:'Forbidden origin.'},403);
  const identity=await authenticateHuman(request,env);
  if(!identity)return json({error:'Sign in to continue.'},401);
  if(!getAdminSession(identity,env))return json({error:'Operator access is not enabled for this account.'},403);
  const operator=await getOperator(env.DB,identity);
  if(!operator)return json({error:'This account has no approved workspace mapping.'},403);
  const oauth=authorizationServer.getOAuthApi(env);
  const ceiling=scopeArray(operator.scopes_json);
  const clients=await operatorClients(env.DB,operator);
  if(request.method==='GET') {
   const parsed=await oauth.parseAuthRequest(request);
   if(parsed.resource!==OAUTH_RESOURCE || !parsed.codeChallenge || parsed.codeChallengeMethod!=='S256')throw new PublicError('This connection requires S256 PKCE and the canonical MCP resource.');
   if(!parsed.scope.includes('mcp:connect') || parsed.scope.some(s=>!ceiling.includes(s)||!OAUTH_SCOPES.includes(s)))throw new PublicError('Requested permissions exceed the approved workspace mapping.');
   const details=await oauth.describeConsent(parsed);
   const consent=await oauth.beginConsent(parsed);
   const consentExpiresAt=new Date(Date.now()+600000).toISOString();
   await env.DB.prepare(`INSERT INTO oauth_pending_consents(handle_hash,operator_id,identity_issuer,identity_subject,oauth_client_id,requested_scopes_json,expires_at) VALUES(?,?,?,?,?,?,?)`).bind(await sha256(consent.handle),operator.id,identity.issuer,identity.subject,parsed.clientId,JSON.stringify(parsed.scope),consentExpiresAt).run();
   const offline=parsed.scope.includes('offline_access');
   return json({handle:consent.handle,client:{name:details.clientName,domain:details.clientDomain??null,redirectHost:new URL(details.redirectUri).host,isLoopback:details.redirectIsLoopback},tenant:{id:operator.tenant_id,name:operator.name},scopes:parsed.scope.map(id=>({id,label:OAUTH_SCOPE_LABELS[id as keyof typeof OAUTH_SCOPE_LABELS],selected:id==='mcp:connect'||id.endsWith(':read')})),clients:clients.map(c=>({...c,selected:false})),expiresAt:new Date(Math.min(Date.parse(operator.expires_at),Date.now()+(offline?GRANT_TTL:ACCESS_TTL)*1000)).toISOString(),consentExpiresAt,accessTokenExpiresInSeconds:ACCESS_TTL,refreshEnabled:offline},200,consent.headers);
  }
  const input=await readInput(request);
  const hash=await sha256(input.handle);
  const pending=await env.DB.prepare('SELECT * FROM oauth_pending_consents WHERE handle_hash=? AND consumed_at IS NULL').bind(hash).first<{operator_id:string;identity_issuer:string;identity_subject:string;oauth_client_id:string;requested_scopes_json:string;expires_at:string}>();
  if(!pending || pending.operator_id!==operator.id || pending.identity_issuer!==identity.issuer || pending.identity_subject!==identity.subject || !(Date.parse(pending.expires_at)>Date.now()))throw new PublicError('This consent expired, was already used, or belongs to another account. Restart authorization.');
  if(input.decision==='approve')validateSelection(scopeArray(pending.requested_scopes_json),ceiling,input.scopes,clients.map(c=>c.id),input.clientIds);
  // D1 atomic compare-and-set closes concurrent replay even across KV regions.
  const consumed=await env.DB.prepare('UPDATE oauth_pending_consents SET consumed_at=? WHERE handle_hash=? AND consumed_at IS NULL AND expires_at>?').bind(new Date().toISOString(),hash,new Date().toISOString()).run();
  if(consumed.meta.changes!==1)throw new PublicError('This consent was already used. Restart authorization.');
  if(input.decision==='deny') {
   const denied=await oauth.denyConsent(request,input.handle);
   return json({redirectTo:denied.redirectTo},200,denied.headers);
  }
  const approved=await oauth.approveConsent(request,input.handle,{scope:input.scopes});
  if(approved.request.clientId!==pending.oauth_client_id || approved.request.resource!==OAUTH_RESOURCE)throw new PublicError('The connection changed. Restart authorization.');
  // Re-read live identity/policy after the potentially asynchronous client lookup.
  await assertIdentityStillAuthorized(request,env,identity,operator.id,input.scopes,input.clientIds,authenticateHuman);
  const delegationId=crypto.randomUUID(),principalId=`oauth_${crypto.randomUUID().replaceAll('-','')}`;
  const now=new Date().toISOString();
  const expiresAt=new Date(Math.min(Date.parse(operator.expires_at),Date.now()+(input.scopes.includes('offline_access')?GRANT_TTL:ACCESS_TTL)*1000)).toISOString();
  const marker=('oauth:'+delegationId).padEnd(64,'_');
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json,auth_kind) VALUES(?,?,?,?,?,?,'oauth')`).bind(operator.tenant_id,principalId,'Approved MCP connection',marker,expiresAt,JSON.stringify(input.scopes)),
   env.DB.prepare('INSERT INTO oauth_delegations(id,tenant_id,operator_id,principal_id,oauth_client_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(delegationId,operator.tenant_id,operator.id,principalId,pending.oauth_client_id,now,expiresAt),
   ...input.clientIds.map(id=>env.DB.prepare('INSERT INTO client_grants(tenant_id,principal_id,client_id) VALUES(?,?,?)').bind(operator.tenant_id,principalId,id)),
  ]);
  try {
   const result=await oauth.completeAuthorization({request:approved.request,userId:operator.id,metadata:{delegationId},scope:input.scopes,props:{delegationId} satisfies OAuthProps});
   return json(result,200,approved.headers);
  }catch(error){
   await env.DB.prepare('UPDATE oauth_delegations SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),delegationId).run();
   throw error;
  }
 }catch(error){
  if(error instanceof PublicError)return json({error:error.message},403);
  if(error instanceof AuthorizationError || error instanceof CimdFetchError)return json({error:'The OAuth request or consent could not be verified. Restart the connection.'},400);
  // Never log request objects, token props, raw SDK errors or authorization URLs.
  console.error(JSON.stringify({event:'oauth_request_failed'}));
  return json({error:'Authorization is temporarily unavailable.'},503);
 }
}
async function assertIdentityStillAuthorized(request:Request,env:OAuthEnv,expected:HumanIdentity,operatorId:string,scopes:string[],clientIds:string[],authenticateHuman:typeof getHumanIdentity) {
 const actual=await authenticateHuman(request,env);
 if(!actual || actual.issuer!==expected.issuer || actual.subject!==expected.subject || !getAdminSession(actual,env))throw new PublicError('The signed-in account changed. Restart authorization.');
 const operator=await getOperator(env.DB,actual);
 if(!operator||operator.id!==operatorId)throw new PublicError('Workspace authorization changed. Restart authorization.');
 validateSelection(scopes,scopeArray(operator.scopes_json),scopes,(await operatorClients(env.DB,operator)).map(c=>c.id),clientIds);
}
async function readInput(request:Request):Promise<{handle:string;decision:'approve'|'deny';scopes:string[];clientIds:string[]}> {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new PublicError('JSON input is required.');
 const reader=request.body?.getReader(); if(!reader)throw new PublicError('Input is required.');
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>16384){await reader.cancel();throw new PublicError('Input is too large.');}chunks.push(next.value);}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 const body:unknown=JSON.parse(new TextDecoder().decode(all));
 if(!body||typeof body!=='object')throw new PublicError('Invalid consent input.');
 const v=body as Record<string,unknown>;
 if(typeof v.handle!=='string'||v.handle.length>512||!['approve','deny'].includes(String(v.decision)))throw new PublicError('Invalid consent input.');
 const scopes=v.scopes??[],clientIds=v.clientIds??[];
 if(!Array.isArray(scopes)||!Array.isArray(clientIds)||scopes.some(s=>typeof s!=='string')||clientIds.some(s=>typeof s!=='string'))throw new PublicError('Invalid consent input.');
 return {handle:v.handle,decision:v.decision as 'approve'|'deny',scopes,clientIds};
}
export function oauthMcpHandler(handler:(request:Request,env:OAuthEnv,ctx:ExecutionContext,principal:Principal)=>Promise<Response>) {
 const resource=new OAuthResourceServer<OAuthEnv,OAuthProps>({
  resourceMetadata:{resource:OAUTH_RESOURCE,authorization_servers:[OAUTH_ISSUER]},requiredScopes:['mcp:connect'],
  validateToken:env=>async (audience,token)=>{
   if(!enabled(env))return null;
   const validated=await authorizationServer.validateToken<OAuthProps>(audience,token,env);
   if(!validated)return null;
   const principal=await resolveOAuthPrincipal(env.DB,validated.props,validated.clientId,validated.userId,validated.scope);
   return principal?{...validated,scope:principal.scopes}:null;
  },
  handler:{async fetch(request,env,ctx){
   if(!ctx.auth.scope.includes('mcp:connect'))return insufficientScope(ctx.auth,['mcp:connect']);
   const principal=await resolveOAuthPrincipal(env.DB,ctx.props,ctx.auth.clientId,ctx.auth.userId,ctx.auth.scope);
   if(!principal)return json({error:'Connection revoked or expired.'},401);
   return handler(request,env,ctx,principal);
  }},
 });
 return {fetch(request:Request,env:OAuthEnv,ctx:ExecutionContext){
  if(!enabled(env))return Promise.resolve(json({error:'MCP authorization is not enabled or configured.'},503));
  return resource.fetch(request,env,ctx);
 }};
}

async function boundedTokenRequest(request:Request):Promise<Request|null> {
 const reader=request.body?.getReader();if(!reader)return request;
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>16384){await reader.cancel();return null;}chunks.push(next.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const headers=new Headers(request.headers);headers.delete('Content-Length');
 return new Request(request,{headers,body:bytes});
}
