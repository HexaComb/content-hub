import { PublicError } from './auth.ts';
import { appOrigin, type InvitationEnv } from './mail.ts';
import { getSession } from './portal.ts';

// Identity policy, not a signup list. Only independently email-verified sessions
// may reach these helpers. Normalize case/outer whitespace; never strip aliases,
// dots, or rewrite domains. No caller role, form email, or invitation sets a role.
const SUPER_ADMINS = ['christian@unreelviews.com', 'marco@hexacombllc.com'] as const;
export function isSuperAdminEmail(email: string): boolean {
  return SUPER_ADMINS.some(allowed => allowed === email.trim().toLowerCase());
}
export function adminAccessEnabled(env: InvitationEnv): boolean {
  if (env.ADMIN_ACCESS_ENABLED !== 'true' || env.INVITATIONS_ENABLED !== 'true' || !env.RESEND_FROM || !env.RESEND_API_KEY) return false;
  try { appOrigin(env); return true; } catch { return false; }
}
export type AdminSession = { email: string; role: 'super_admin' };
/** Revalidates the opaque session and live policy on every request. */
export async function getAdminSession(db: D1Database, request: Request, env: InvitationEnv): Promise<AdminSession | null> {
  if (!adminAccessEnabled(env)) return null;
  const session = await getSession(db, request);
  if (!session || !isSuperAdminEmail(session.email)) return null;
  return { email: session.email.trim().toLowerCase(), role: 'super_admin' };
}
export async function requireSuperAdmin(db: D1Database, request: Request, env: InvitationEnv): Promise<AdminSession> {
  const session = await getAdminSession(db, request, env);
  if (!session) throw new PublicError('Administrator access is not available.');
  return session;
}
