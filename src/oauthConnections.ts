import {PublicError} from './auth.ts';
import type {HumanIdentity} from './humanAuth.ts';
import {ONGOING_IDLE_TTL} from './oauthLifetime.ts';
import type {OAuthEnv} from './oauth.ts';
const origin='https://content.unreelviews.com';
export function isConnectionManagementPath(path:string):boolean{return path==='/api/oauth/connections'||/^\/api\/oauth\/connections\/[a-zA-Z0-9-]{1,80}\/revoke$/.test(path);}
function reply(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});}
/** Extends only a newly and explicitly approved ongoing connection. No tokens are stored here. */
export async function extendOngoingConnection(db:D1Database,delegationId:string,operatorId:string):Promise<string>{
 const now=new Date().toISOString(),expiry=new Date(Date.now()+ONGOING_IDLE_TTL*1000).toISOString();
 const results=await db.batch([
  db.prepare(`UPDATE oauth_delegations SET expires_at=? WHERE id=? AND operator_id=? AND connection_mode='ongoing' AND revoked_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM oauth_operators o WHERE o.id=oauth_delegations.operator_id AND o.tenant_id=oauth_delegations.tenant_id AND o.connection_mode='ongoing' AND o.revoked_at IS NULL AND EXISTS(SELECT 1 FROM json_each(o.scopes_json) WHERE value='offline_access') AND EXISTS(SELECT 1 FROM json_each(o.scopes_json) WHERE value='mcp:connect')) AND EXISTS(SELECT 1 FROM principals p WHERE p.tenant_id=oauth_delegations.tenant_id AND p.id=oauth_delegations.principal_id AND p.auth_kind='oauth' AND p.revoked_at IS NULL AND p.expires_at>? AND EXISTS(SELECT 1 FROM json_each(p.scopes_json) WHERE value='offline_access'))`).bind(expiry,delegationId,operatorId,now,now),
  db.prepare(`UPDATE principals SET expires_at=? WHERE auth_kind='oauth' AND revoked_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM oauth_delegations d WHERE d.id=? AND d.operator_id=? AND d.tenant_id=principals.tenant_id AND d.principal_id=principals.id AND d.connection_mode='ongoing' AND d.revoked_at IS NULL AND d.expires_at=?)`).bind(expiry,now,delegationId,operatorId,expiry),
  db.prepare(`INSERT INTO oauth_connection_events(id,tenant_id,operator_id,delegation_id,event,recorded_at,detail_json) SELECT CASE WHEN changes()=1 THEN ? ELSE NULL END,tenant_id,operator_id,id,'refresh_accepted',?,? FROM oauth_delegations WHERE id=? AND operator_id=?`).bind(crypto.randomUUID(),now,JSON.stringify({idleExpiresAt:expiry}),delegationId,operatorId),
 ]);
 if(results[0].meta.changes!==1||results[1].meta.changes!==1)throw new PublicError('This connection is no longer active.');
 return expiry;
}
export async function handleConnectionManagement(request:Request,env:OAuthEnv,authenticate:(r:Request,e:OAuthEnv)=>Promise<HumanIdentity|null>,revokeGrant:(grantId:string,operatorId:string)=>Promise<void>):Promise<Response>{
 const url=new URL(request.url);
 if(url.origin!==origin)return reply({error:'Use the canonical origin.'},400);
 if(request.method==='POST'&&request.headers.get('Origin')!==origin)return reply({error:'Forbidden origin.'},403);
 const identity=await authenticate(request,env);
 if(!identity)return reply({error:'Sign in to continue.'},401);
 // Expired/revoked operators may still inspect and disconnect their own apps.
 const ownership=`o.identity_issuer=? AND o.identity_subject=? AND o.verified_email=?`;
 const identityArgs=[identity.issuer,identity.subject,identity.email];
 if(url.pathname==='/api/oauth/connections'){
  if(request.method!=='GET')return reply({error:'Method not allowed.'},405);
  let cursor:[string,string]|undefined;
  if(url.searchParams.has('cursor')){try{const v=JSON.parse(url.searchParams.get('cursor')!);if(!Array.isArray(v)||v.length!==2||typeof v[0]!=='string'||!Number.isFinite(Date.parse(v[0]))||typeof v[1]!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v[1]))throw Error();cursor=v as [string,string];}catch{return reply({error:'Invalid connection cursor.'},400);}}
  const {results}=await env.DB.prepare(`SELECT d.id,d.client_name AS application,d.oauth_client_id AS clientId,d.connection_mode AS connectionMode,d.created_at AS createdAt,d.expires_at AS expiresAt,d.revoked_at AS revokedAt,(d.revoked_at IS NOT NULL AND d.provider_revoked_at IS NULL) AS cleanupPending,p.scopes_json AS scopesJson,p.expires_at AS principalExpiresAt,p.revoked_at AS principalRevokedAt,o.scopes_json AS ceilingJson,o.connection_mode AS operatorMode,o.expires_at AS operatorExpiresAt,o.revoked_at AS operatorRevokedAt,(SELECT json_group_array(c.name) FROM client_grants g JOIN clients c ON c.tenant_id=g.tenant_id AND c.id=g.client_id WHERE g.tenant_id=d.tenant_id AND g.principal_id=d.principal_id) AS clientsJson FROM oauth_delegations d JOIN oauth_operators o ON o.id=d.operator_id AND o.tenant_id=d.tenant_id JOIN principals p ON p.id=d.principal_id AND p.tenant_id=d.tenant_id WHERE ${ownership} AND (? IS NULL OR d.created_at<? OR (d.created_at=? AND d.id<?)) ORDER BY d.created_at DESC,d.id DESC LIMIT 101`).bind(...identityArgs,cursor?.[0]??null,cursor?.[0]??null,cursor?.[0]??null,cursor?.[1]??null).all<Record<string,unknown>>();
  return reply({nextCursor:results.length>100?JSON.stringify([results[99].createdAt,results[99].id]):null,connections:results.slice(0,100).map(({scopesJson,clientsJson,operatorMode,operatorExpiresAt,operatorRevokedAt,principalExpiresAt,principalRevokedAt,ceilingJson,...r})=>({...r,scopes:JSON.parse(String(scopesJson)),clients:JSON.parse(String(clientsJson)),authorizationActive:!r.revokedAt&&!operatorRevokedAt&&!principalRevokedAt&&Date.parse(String(principalExpiresAt))>Date.now()&&JSON.parse(String(scopesJson)).includes('mcp:connect')&&JSON.parse(String(ceilingJson)).includes('mcp:connect')&&Date.parse(String(r.expiresAt))>Date.now()&&(operatorMode==='ongoing'||Date.parse(String(operatorExpiresAt))>Date.now())&&(r.connectionMode!=='ongoing'||(operatorMode==='ongoing'&&JSON.parse(String(scopesJson)).includes('offline_access')&&JSON.parse(String(ceilingJson)).includes('offline_access')))}))});
 }
 if(request.method!=='POST')return reply({error:'Method not allowed.'},405);
 const id=url.pathname.split('/')[4];
 const row=await env.DB.prepare(`SELECT d.id,d.tenant_id,d.operator_id,d.principal_id,d.oauth_grant_id,d.revoked_at FROM oauth_delegations d JOIN oauth_operators o ON o.id=d.operator_id AND o.tenant_id=d.tenant_id WHERE d.id=? AND ${ownership}`).bind(id,...identityArgs).first<{id:string;tenant_id:string;operator_id:string;principal_id:string;oauth_grant_id:string|null;revoked_at:string|null}>();
 if(!row)return reply({error:'Connection not found.'},404);
 const now=new Date().toISOString();
 if(!row.revoked_at)await env.DB.batch([
  env.DB.prepare('UPDATE oauth_delegations SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(now,row.id),
  env.DB.prepare(`INSERT INTO oauth_connection_events(id,tenant_id,operator_id,delegation_id,event,recorded_at,detail_json) SELECT ?,?,?,?,'revoked',?,'{}' WHERE changes()=1`).bind(crypto.randomUUID(),row.tenant_id,row.operator_id,row.id,now),
  env.DB.prepare('UPDATE principals SET revoked_at=? WHERE tenant_id=? AND id=? AND revoked_at IS NULL').bind(now,row.tenant_id,row.principal_id),
 ]);
 let providerRevocationPending=false;
 try{if(row.oauth_grant_id)await revokeGrant(row.oauth_grant_id,row.operator_id);await env.DB.prepare('UPDATE oauth_delegations SET provider_revoked_at=? WHERE id=? AND revoked_at IS NOT NULL').bind(new Date().toISOString(),row.id).run();}catch{providerRevocationPending=true;}
 // D1 revocation is authoritative immediately even if provider cleanup fails.
 return reply({revoked:true,providerRevocationPending});
}
