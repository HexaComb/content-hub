import {post,message,ApiError} from './api';
import {getClerk,mountSignIn} from './auth';
declare global {interface Window {__inviteToken?:string|null}}
let token=window.__inviteToken;delete window.__inviteToken;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(`#${id}`)!;
let version=0;let unmount:(()=>void)|undefined;let unsubscribe:(()=>void)|undefined;let sessionId:string|null|undefined;
interface Preview {invitation:{target:{name:string;kind:string;platformAccountRef?:string|null};metricIds:string[];role:'metrics_viewer';grantExpiresAt:string}}
function failure(e:unknown){return e instanceof ApiError&&e.status===400?'This invitation is unavailable for this account. It may have expired, been revoked, or been sent to a different email address.':message(e);}
async function prepare(){const request=++version;$('accept-invite').hidden=true;$('invite-preview').hidden=true;$('retry-invite').hidden=true;$('switch-account').hidden=true;unmount?.();unmount=undefined;$('invite-sign-in').hidden=true;
 if(!token){$('invite-status').textContent='No invitation is available in this tab. If you just signed in, reopen the original email link. Otherwise request a new invitation.';return;}
 $('invite-status').textContent='Checking secure sign-in…';
 try{const clerk=await getClerk();if(request!==version)return;if(!unsubscribe){sessionId=clerk.session?.id??null;unsubscribe=clerk.addListener(({session})=>{const id=session?.id??null;if(id!==sessionId){sessionId=id;void prepare();}});}
 if(!clerk.session){$('invite-status').textContent='Sign in with your invited email address. You will review your access before accepting.';$('invite-sign-in').hidden=false;unmount=await mountSignIn($<HTMLDivElement>('invite-sign-in'),'/invite');return;}
 $('switch-account').hidden=false;$('invite-status').textContent='Checking the invitation for your signed-in account…';
 const data=await post<Preview>('/api/invitations/begin',{token});if(request!==version)return;const {invitation}=data;if(invitation.role!=='metrics_viewer')throw new Error('Unexpected invitation role');
 $('invite-target').textContent=invitation.target.name;$('invite-scope').textContent=`Read-only metrics access · ${invitation.target.kind==='instagram_account'?'Instagram account':'One-off project'}${invitation.target.platformAccountRef?` · ${invitation.target.platformAccountRef}`:''}. Metrics: ${invitation.metricIds.join(', ')||'None'}.`;
 $('invite-expiry').textContent=`Access expires ${new Date(invitation.grantExpiresAt).toLocaleString('en',{timeZone:'UTC'})} UTC.`;$('invite-preview').hidden=false;$('accept-invite').hidden=false;$('invite-status').textContent=`Signed in as ${clerk.user?.primaryEmailAddress?.emailAddress??'your verified account'}. Review the access above, then accept.`;
 }catch(e){if(request!==version)return;$('invite-status').textContent=failure(e);$('retry-invite').hidden=false;}}
$('retry-invite').addEventListener('click',()=>void prepare());
$('accept-invite').addEventListener('click',async()=>{const button=$<HTMLButtonElement>('accept-invite');if(!token||button.disabled)return;button.disabled=true;const request=version;$('invite-status').textContent='Accepting your read-only access…';try{await post('/api/invitations/accept',{token});if(request!==version)return;token=null;location.replace('/');}catch(e){if(request===version)$('invite-status').textContent=failure(e);}finally{button.disabled=false;}});
$('switch-account').addEventListener('click',async()=>{const button=$<HTMLButtonElement>('switch-account');if(button.disabled)return;button.disabled=true;version++;$('accept-invite').hidden=true;$('invite-preview').hidden=true;try{await (await getClerk()).signOut();await prepare();}catch(e){$('invite-status').textContent=message(e);}finally{button.disabled=false;}});
window.addEventListener('pagehide',()=>{version++;token=null;unsubscribe?.();unmount?.();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
void prepare();
