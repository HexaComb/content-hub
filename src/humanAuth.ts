import { createClerkClient } from '@clerk/backend';
import { parsePublishableKey } from '@clerk/shared/keys';
import { PublicError } from './auth.ts';
import { appOrigin, type InvitationEnv } from './mail.ts';

/** Trusted internal result, never deserialize this object from HTTP input. */
export type HumanIdentity = Readonly<{ issuer: string; subject: string; sessionId: string; email: string }>;
export type HumanAuthAdapter = {
 authenticate(request: Request, options: { acceptsToken: 'session_token'; authorizedParties: string[]; issuer: string }): Promise<{
  isAuthenticated: boolean; status: string;
  toAuth(): { userId?: string | null; sessionId?: string | null; sessionStatus?: string | null; sessionClaims?: { iss?: string; act?: unknown } | null; actor?: unknown } | null;
 }>;
 getSession(id: string): Promise<{ id: string; userId: string; status: string; expireAt: number; abandonAt: number; actor?: unknown }>;
 getUser(id: string): Promise<{ id: string; banned: boolean; locked: boolean; primaryEmailAddress: { emailAddress: string; verification: { status: string } | null } | null }>;
};
export function clerkConfiguration(env: InvitationEnv): {publishableKey:string;issuer:string;appOrigin:string}|null {
 if(env.CLERK_AUTH_ENABLED !== 'true' || !env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY || !env.CLERK_ISSUER) return null;
 try {
  const origin=appOrigin(env), issuer=new URL(env.CLERK_ISSUER);
  const key=parsePublishableKey(env.CLERK_PUBLISHABLE_KEY);
  if(issuer.protocol!=='https:' || issuer.origin!==env.CLERK_ISSUER || issuer.username || issuer.password || !key || key.frontendApi!==issuer.host)return null;
  return {publishableKey:env.CLERK_PUBLISHABLE_KEY,issuer:env.CLERK_ISSUER,appOrigin:origin};
 } catch { return null; }
}
export function clerkAuthConfigured(env: InvitationEnv): boolean {return clerkConfiguration(env)!==null;}
function clerkAdapter(env: InvitationEnv): HumanAuthAdapter {
 const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY!, publishableKey: env.CLERK_PUBLISHABLE_KEY! });
 return {
  authenticate: (request,options) => client.authenticateRequest(request,options),
  getSession: id => client.sessions.getSession(id),
  getUser: id => client.users.getUser(id),
 };
}
/** Clerk exclusively authenticates humans. Never fall back to legacy cookies. */
export async function getHumanIdentity(request: Request, env: InvitationEnv, adapter?: HumanAuthAdapter): Promise<HumanIdentity | null> {
 if(env.CLERK_AUTH_ENABLED !== 'true') return null;
 if(!clerkAuthConfigured(env)) throw new PublicError('Authentication unavailable.');
 try {
  const verifier = adapter ?? clerkAdapter(env);
  const state = await verifier.authenticate(request,{acceptsToken:'session_token', authorizedParties:[appOrigin(env)], issuer:env.CLERK_ISSUER!});
  if(!state.isAuthenticated || state.status !== 'signed-in')return null;
  const auth=state.toAuth();
  // Clerk's optional JWT `sts` claim becomes null when omitted. Its absence is
  // not a pending session: require the live session below to be active instead.
  // Explicit pending/non-active token statuses remain denied before any reads.
  if(!auth || !auth.userId || !auth.sessionId || (auth.sessionStatus!=null && auth.sessionStatus!=='active') || auth.sessionClaims?.iss!==env.CLERK_ISSUER || auth.actor || auth.sessionClaims?.act)return null;
  // Fetch current server-side state on every request, not just JWT expiry. A
  // valid signature must not keep a revoked session or unverified email alive.
  const session=await verifier.getSession(auth.sessionId);
  if(session.id!==auth.sessionId || session.userId!==auth.userId || session.status!=='active' || session.actor || !(session.expireAt>Date.now()) || !(session.abandonAt>Date.now()))return null;
  const user=await verifier.getUser(auth.userId);
  const primary=user.primaryEmailAddress;
  if(user.id!==auth.userId || user.banned || user.locked || !primary || primary.verification?.status!=='verified')return null;
  const email=primary.emailAddress.trim().toLowerCase();
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return null;
  return Object.freeze({issuer:env.CLERK_ISSUER!,subject:auth.userId,sessionId:auth.sessionId,email});
 } catch { throw new PublicError('Authentication unavailable.'); }
}
