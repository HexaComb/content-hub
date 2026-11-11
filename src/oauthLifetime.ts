import {PublicError} from './auth.ts';
export const ACCESS_TTL=900;
export const FIXED_REFRESH_TTL=7*24*60*60;
export const ONGOING_IDLE_TTL=30*24*60*60;
export type ConnectionMode='bounded'|'ongoing';
export function operatorActive(operator:{connection_mode?:string;expires_at:string},now=Date.now()):boolean {
 return operator.connection_mode==='ongoing'||Date.parse(operator.expires_at)>now;
}
export function proposedConnectionMode(operator:{connection_mode?:string},scopes:string[]):ConnectionMode {
 return operator.connection_mode==='ongoing'&&scopes.includes('offline_access')?'ongoing':'bounded';
}
export function connectionDeadline(operator:{connection_mode?:string;expires_at:string},mode:ConnectionMode,scopes:string[],now=Date.now()):string {
 const offline=scopes.includes('offline_access');
 if(mode==='ongoing'&&(!offline||operator.connection_mode!=='ongoing'))throw new PublicError('Ongoing access is not approved for this account. Restart authorization.');
 const seconds=offline?(mode==='ongoing'?ONGOING_IDLE_TTL:FIXED_REFRESH_TTL):ACCESS_TTL;
 const ceiling=operator.connection_mode==='ongoing'?Infinity:Date.parse(operator.expires_at);
 return new Date(Math.min(ceiling,now+seconds*1000)).toISOString();
}
