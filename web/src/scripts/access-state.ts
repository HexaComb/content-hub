export const verificationMessage='You’re signed in, but unreel content could not verify your session. This may be a session or sign-in setup issue. Try again once, or sign out and sign in again. If it continues, ask your workspace administrator to check the setup. You do not need to create a Clerk project.';
export type SessionResult={authenticated:boolean;email?:string};
export type AccessState<T>={kind:'stale'}|{kind:'signed_out'}|{kind:'verification_failed'}|{kind:'verified';email?:string;targets:T[]};
/** The server remains authoritative. A client session alone never unlocks a workspace. */
export async function resolveWorkspaceAccess<T>(currentSession:()=>string|null,isCurrent:()=>boolean,readSession:()=>Promise<SessionResult>,readTargets:()=>Promise<T[]>):Promise<AccessState<T>>{
 const before=currentSession();let session:SessionResult;
 try{session=await readSession();}catch(error){
  if(!isCurrent()||before!==currentSession())return {kind:'stale'};
  // Only identity-verification failures are translated here. Target authorization
  // failures below keep their original status and normal access-denied wording.
  const status=typeof error==='object'&&error!==null&&'status' in error?error.status:undefined;
  if(status===401||status===403)return {kind:'verification_failed'};
  throw error;
 }
 if(!isCurrent()||before!==currentSession())return {kind:'stale'};
 if(!session.authenticated)return {kind:before?'verification_failed':'signed_out'};
 // Do not expose a response arriving after the browser session ended.
 if(!before)return {kind:'verification_failed'};
 const targets=await readTargets();
 if(!isCurrent()||before!==currentSession())return {kind:'stale'};
 return {kind:'verified',email:session.email,targets};
}
/** Repeated token/resource updates for the same session must not restart sign-in. */
export function sessionChangeGuard(initial:string|null,onChange:()=>void){let previous=initial;return (next:string|null)=>{if(next===previous)return;previous=next;onChange();};}
