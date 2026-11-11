import { PublicError, type Principal } from './auth.ts';
import type { HumanIdentity } from './humanAuth.ts';

export const OAUTH_SCOPE_LABELS = {
 'mcp:connect': 'Connect to Content Hub',
 'clients:read': 'Read selected client names and settings',
 'projects:read': 'Read projects', 'projects:write': 'Create and update projects',
 'themes:read': 'Read project designs and validate proposed themes', 'themes:write': 'Change project branding and report presentation without changing report data',
 'presentations:read': 'Read private client page designs and validate drafts', 'presentations:write': 'Save and restore private client page drafts', 'presentations:publish': 'Publish client page designs to existing authorized recipients',
 'metrics:read': 'Read metrics and observations', 'metrics:write': 'Define metrics and record observations',
 'content:read': 'Read content', 'content:write': 'Create and edit content drafts',
 'clients:write': 'Create new clients and gain access to them; update selected clients',
 'offline_access': 'Keep this connection for up to seven days',
} as const;
export const OAUTH_SCOPES = Object.keys(OAUTH_SCOPE_LABELS);
export function scopeArray(value: string): string[] {
 const parsed: unknown = JSON.parse(value);
 if (!Array.isArray(parsed) || parsed.some(s => typeof s !== 'string' || !OAUTH_SCOPES.includes(s))) throw new PublicError('OAuth permissions are not configured correctly.');
 return [...new Set(parsed)];
}
export type Operator = {id:string;tenant_id:string;name:string;identity_issuer:string;identity_subject:string;verified_email:string;scopes_json:string;expires_at:string};
export async function getOperator(db:D1Database, identity:HumanIdentity):Promise<Operator|null> {
 const row=await db.prepare(`SELECT o.*,t.name FROM oauth_operators o JOIN tenants t ON t.id=o.tenant_id
 WHERE o.identity_issuer=? AND o.identity_subject=? AND o.verified_email=? AND o.revoked_at IS NULL`).bind(identity.issuer,identity.subject,identity.email).first<Operator>();
 return row && Date.parse(row.expires_at)>Date.now() ? row : null;
}
export async function operatorClients(db:D1Database, operator:Operator) {
 const {results}=await db.prepare(`SELECT c.id,c.name FROM oauth_operator_clients g JOIN clients c ON c.tenant_id=g.tenant_id AND c.id=g.client_id WHERE g.tenant_id=? AND g.operator_id=? ORDER BY c.id LIMIT 101`).bind(operator.tenant_id,operator.id).all<{id:string;name:string}>();
 if(results.length>100)throw new PublicError('This operator has too many clients for this consent flow.');
 return results;
}
export function validateSelection(requested:string[], ceiling:string[], selected:string[], allowedClients:string[], selectedClients:string[]) {
 if(selected.length>20 || selectedClients.length>100 || !selected.includes('mcp:connect') || new Set(selected).size!==selected.length || new Set(selectedClients).size!==selectedClients.length || selected.some(s=>!requested.includes(s)||!ceiling.includes(s)||!OAUTH_SCOPES.includes(s)) || selectedClients.some(id=>!allowedClients.includes(id)))throw new PublicError('The requested access is not permitted. Restart authorization.');
}
export type OAuthProps = {delegationId:string};
export async function resolveOAuthPrincipal(db:D1Database, props:unknown, oauthClientId:string|undefined, userId:string|undefined, tokenScopes:string[]):Promise<Principal|null> {
 if(!props || typeof props!=='object' || !('delegationId' in props) || typeof props.delegationId!=='string' || !oauthClientId || !userId)return null;
 const row=await db.prepare(`SELECT d.id,d.tenant_id,d.principal_id,d.expires_at AS delegation_expiry,p.expires_at AS principal_expiry,p.scopes_json,o.scopes_json AS ceiling,o.expires_at AS operator_expiry,o.id AS operator_id
 FROM oauth_delegations d JOIN principals p ON p.tenant_id=d.tenant_id AND p.id=d.principal_id
 JOIN oauth_operators o ON o.tenant_id=d.tenant_id AND o.id=d.operator_id
 WHERE d.id=? AND d.oauth_client_id=? AND o.id=? AND d.revoked_at IS NULL AND p.revoked_at IS NULL AND p.auth_kind='oauth' AND o.revoked_at IS NULL`)
 .bind(props.delegationId,oauthClientId,userId).first<{id:string;tenant_id:string;principal_id:string;delegation_expiry:string;principal_expiry:string;operator_expiry:string;scopes_json:string;ceiling:string;operator_id:string}>();
 if(!row || [row.delegation_expiry,row.principal_expiry,row.operator_expiry].some(t=>!(Date.parse(t)>Date.now())))return null;
 const ceiling=scopeArray(row.ceiling), granted=scopeArray(row.scopes_json);
 return {tenantId:row.tenant_id,id:row.principal_id,oauthOperatorId:row.operator_id,oauthEligibleScopes:ceiling,scopes:tokenScopes.filter(s=>granted.includes(s)&&ceiling.includes(s))};
}
