import { PublicError } from './auth.ts';
import { clerkAuthConfigured, type HumanIdentity } from './humanAuth.ts';
import type { InvitationEnv } from './mail.ts';

// Only server-verified primary emails qualify. Normalize case/outer whitespace;
// never strip aliases, dots, or rewrite domains. No signup/promotion APIs exist.
export const SUPER_ADMINS = ['christian@unreelviews.com', 'marco@hexacombllc.com'] as const;
export function isSuperAdminEmail(email: string): boolean {
 return SUPER_ADMINS.some(allowed => allowed === email.trim().toLowerCase());
}
export function adminAccessEnabled(env: InvitationEnv): boolean {
 return env.ADMIN_ACCESS_ENABLED === 'true' && clerkAuthConfigured(env);
}
export type AdminSession = {email:string;role:'super_admin'};
/** identity must come from getHumanIdentity for this request, never HTTP JSON. */
export function getAdminSession(identity:HumanIdentity|null,env:InvitationEnv):AdminSession|null {
 if(!adminAccessEnabled(env) || !identity || identity.issuer!==env.CLERK_ISSUER || !isSuperAdminEmail(identity.email))return null;
 return {email:identity.email.trim().toLowerCase(),role:'super_admin'};
}
export function requireSuperAdmin(identity:HumanIdentity|null,env:InvitationEnv):AdminSession {
 const session=getAdminSession(identity,env);
 if(!session)throw new PublicError('Administrator access is not available.');
 return session;
}
