import { sha256 } from "./domain.ts";
export type Principal = { tenantId: string; id: string; scopes: string[]; oauthEligibleScopes?: string[]; oauthOperatorId?: string; oauthConnectionMode?: 'bounded'|'ongoing'; oauthExpiresAt?: string; oauthClientAccessMode?:'selected'|'all';oauthClientId?:string;oauthAppPolicyId?:string|null };
export class PublicError extends Error {}

export async function authenticate(request: Request, db: D1Database): Promise<Principal | null> {
  const match = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/);
  if (!match) return null;
  const row = await db.prepare("SELECT tenant_id, id, scopes_json, expires_at FROM principals WHERE token_hash = ? AND auth_kind = 'service' AND revoked_at IS NULL")
    .bind(await sha256(match[1])).first<{ tenant_id: string; id: string; scopes_json: string; expires_at: string }>();
  if (!row || !(Date.parse(row.expires_at) > Date.now())) return null;
  const scopes: unknown = JSON.parse(row.scopes_json);
  if (!Array.isArray(scopes) || scopes.some(s => typeof s !== "string")) return null;
  return { tenantId: row.tenant_id, id: row.id, scopes };
}

export async function authorize(db: D1Database, principal: Principal, clientId: string, scope: string) {
  if (!principal.scopes.includes(scope)) throw new PublicError("This credential lacks the required scope.");
  if (principal.oauthClientAccessMode==='all') {
    if(!await hasAllClientAccess(db,principal))throw new PublicError('All-client access is no longer authorized.');
    const client=await db.prepare('SELECT 1 FROM clients WHERE tenant_id=? AND id=?').bind(principal.tenantId,clientId).first();
    if(!client)throw new PublicError('Client is not available to this connection.');
    return;
  }
  const grant = await db.prepare("SELECT 1 FROM client_grants WHERE tenant_id = ? AND principal_id = ? AND client_id = ?")
    .bind(principal.tenantId, principal.id, clientId).first();
  if (principal.oauthOperatorId) {
    const allowed = await db.prepare('SELECT 1 FROM oauth_operator_clients WHERE tenant_id=? AND operator_id=? AND client_id=?').bind(principal.tenantId, principal.oauthOperatorId, clientId).first();
    if (!allowed) throw new PublicError('Client is not available to this connection.');
  }
  if (!grant) throw new PublicError("Client is not available to this credential.");
}

/** Defense in depth for the dynamic boundary, including policy revocation after token validation. */
export async function hasAllClientAccess(db:D1Database,p:Principal):Promise<boolean>{
 if(p.oauthClientAccessMode!=='all'||!p.oauthAppPolicyId||!p.oauthOperatorId||!p.oauthClientId)return false;
 const row=await db.prepare(`SELECT 1 FROM oauth_delegations d JOIN oauth_operator_app_policies a ON a.id=d.app_policy_id AND a.operator_id=d.operator_id AND a.oauth_client_id=d.oauth_client_id JOIN oauth_operators o ON o.id=d.operator_id AND o.tenant_id=d.tenant_id JOIN principals p ON p.id=d.principal_id AND p.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.principal_id=? AND d.operator_id=? AND d.oauth_client_id=? AND d.app_policy_id=? AND d.client_access_mode='all' AND a.client_access_mode='all' AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND o.revoked_at IS NULL AND p.revoked_at IS NULL AND p.auth_kind='oauth' AND d.expires_at>? AND p.expires_at>? AND (a.connection_mode='ongoing' OR o.expires_at>?)`).bind(p.tenantId,p.id,p.oauthOperatorId,p.oauthClientId,p.oauthAppPolicyId,new Date().toISOString(),new Date().toISOString(),new Date().toISOString()).first();
 return Boolean(row);
}
