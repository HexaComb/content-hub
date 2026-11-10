import { sha256 } from "./domain.ts";
export type Principal = { tenantId: string; id: string; scopes: string[] };
export class PublicError extends Error {}

export async function authenticate(request: Request, db: D1Database): Promise<Principal | null> {
  const match = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/);
  if (!match) return null;
  const row = await db.prepare("SELECT tenant_id, id, scopes_json, expires_at FROM principals WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(await sha256(match[1])).first<{ tenant_id: string; id: string; scopes_json: string; expires_at: string }>();
  if (!row || !(Date.parse(row.expires_at) > Date.now())) return null;
  const scopes: unknown = JSON.parse(row.scopes_json);
  if (!Array.isArray(scopes) || scopes.some(s => typeof s !== "string")) return null;
  return { tenantId: row.tenant_id, id: row.id, scopes };
}

export async function authorize(db: D1Database, principal: Principal, clientId: string, scope: string) {
  if (!principal.scopes.includes(scope)) throw new PublicError("This credential lacks the required scope.");
  const grant = await db.prepare("SELECT 1 FROM client_grants WHERE tenant_id = ? AND principal_id = ? AND client_id = ?")
    .bind(principal.tenantId, principal.id, clientId).first();
  if (!grant) throw new PublicError("Client is not available to this credential.");
}
