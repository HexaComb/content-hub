import {getClerk,mountSignIn} from './auth';
import {message,ApiError} from './api';
import {sessionChangeGuard} from './access-state';
import {consentFailureMessage} from './oauth-errors';
import {safeSignInReturn,validProposal,consentRedirect,defaultScopeSelected,type ConsentProposal} from './oauth-state';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(`#${id}`)!;
// Preserve the OAuth request, never a user-provided post-login destination or fragment.
const requestUrl=safeSignInReturn(location.pathname+location.search,location.origin);
let proposal:ConsentProposal|undefined;let revision=0;let sessionId:string|null=null;let busy=false;let signingOut=false;
let dispose:(()=>void)|undefined;let stop:(()=>void)|undefined;let timer:ReturnType<typeof setTimeout>|undefined;let pending:AbortController|undefined;
function clear(){proposal=undefined;clearTimeout(timer);$('consent-form').hidden=true;$('consent-scopes').replaceChildren();$('consent-clients').replaceChildren();$('consent-approve').removeAttribute('disabled');$('consent-deny').removeAttribute('disabled');}
function status(text:string){$('consent-status').textContent=text;}
function failure(error:unknown){return error instanceof ApiError ? consentFailureMessage(error.status)??message(error) : message(error);}
async function request<T>(method:'GET'|'POST',body?:unknown,signal?:AbortSignal):Promise<T>{
 const clerk=await getClerk();const token=await clerk.session?.getToken();if(!token)throw new ApiError(401);
 const response=await fetch(requestUrl,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw new ApiError(response.status);return response.json();
}
function choice(container:HTMLElement,id:string,label:string,checked:boolean,kind:'scope'|'client'|'boundary',note?:string){
 const wrapper=document.createElement('label');wrapper.className='consent-choice';const input=document.createElement('input');input.type='checkbox';input.value=id;input.name=kind;input.checked=checked;
 const text=document.createElement('span');const title=document.createElement('strong');title.textContent=label;text.append(title);if(note){const small=document.createElement('span');small.className='small';small.textContent=note;text.append(small);}wrapper.append(input,text);container.append(wrapper);
}
function show(value:ConsentProposal){
 $('consent-app').textContent=value.client.name;$('consent-domain').textContent=value.client.domain?`Application domain: ${value.client.domain}`:'Application name is self-declared; verify the callback host carefully.';
 $('consent-redirect').textContent=`Returns to: ${value.client.redirectHost}${value.client.isLoopback?' (local application on this device)':''}`;
 $('consent-tenant').textContent=`Workspace: ${value.tenant.name} (${value.tenant.id})`;
 const date=(s:string)=>new Date(s).toLocaleString('en',{timeZone:'UTC'})+' UTC';
 $('consent-expiry').textContent=value.connectionMode==='ongoing'?`If you select Keep connected, this application can refresh access until you disconnect it or your administrator revokes authorization. It expires after 30 days without a token refresh. Access tokens still last 15 minutes. Without selecting it, access lasts only 15 minutes. Review this request by ${date(value.consentExpiresAt)}.`:`Maximum access expiry: ${date(value.expiresAt)}. This consent request expires ${date(value.consentExpiresAt)}.${value.accessTokenExpiresInSeconds?` Access tokens last ${Math.round(value.accessTokenExpiresInSeconds/60)} minutes.`:''}${value.refreshEnabled===true?' Without selecting Keep this connection, access lasts only 15 minutes. Selecting it allows refresh until the maximum expiry or revocation.':''}`;
 for(const scope of value.scopes){const create=scope.id==='clients:write';const write=scope.id.endsWith(':write');choice($('consent-scopes'),scope.id,scope.label,defaultScopeSelected(scope),'scope',create?'Separate write permission: create new business clients, gain access to each new client, and update selected existing clients. This permission alone does not grant all existing clients. Choose a broader client boundary separately if offered. Optional and unchecked.':scope.id==='offline_access'?(value.connectionMode==='ongoing'?'OPTIONAL ONGOING ACCESS · Starts unchecked. Rotating refresh until revoked, with a 30-day inactivity limit. Disconnect at Connected apps.':'OPTIONAL PERSISTENT ACCESS · Starts unchecked. Allows refresh for up to seven days.'):`${write?'WRITE':scope.id.endsWith(':read')?'READ':'CONNECT'} · ${scope.id}`);}
 if(value.allClientsAllowed)choice($('consent-clients'),'all','All current and future clients in this workspace',false,'boundary','Individual choices below show at most 100 mapped clients. Broad access covers every current client and clients added later, including all their current and future projects. Your selected action permissions still apply. Optional and unchecked.');
 for(const client of value.clients)choice($('consent-clients'),client.id,client.name,false,'client',client.id);
 if(!value.clients.length&&!value.allClientsAllowed){$('consent-clients').textContent='No existing clients are available for this request.';}
 $('consent-form').hidden=false;
 const remaining=Date.parse(value.consentExpiresAt)-Date.now();if(remaining<=0){clear();status('This consent request has expired. Start a new connection from the requesting application.');return;}
 timer=setTimeout(()=>{const submitting=busy;revision++;pending?.abort();clear();busy=false;$<HTMLButtonElement>('consent-signout').disabled=false;status(submitting?'This consent request expired while submission was in progress. The outcome may be uncertain. Check the requesting application before starting a new connection.':'This consent request has expired. Start a new connection from the requesting application.');},Math.min(remaining,2147483647));
}
async function prepare(){const turn=++revision;pending?.abort();pending=new AbortController();clear();busy=false;dispose?.();dispose=undefined;$('consent-login').hidden=true;$('consent-retry').hidden=true;$('consent-signout').hidden=true;status('Checking secure sign-in…');
 try{const clerk=await getClerk();if(turn!==revision||signingOut)return;sessionId=clerk.session?.id??null;if(!stop){const changed=sessionChangeGuard(sessionId,()=>{revision++;pending?.abort();clear();if(!signingOut)void prepare();});stop=clerk.addListener(({session})=>changed(session?.id??null));}
 if(!sessionId){$('consent-login').hidden=false;status('Sign in to review this request. Signing in does not approve access.');dispose=await mountSignIn($<HTMLDivElement>('consent-sign-in'),requestUrl,()=>turn===revision&&!signingOut);return;}
 $('consent-signout').hidden=false;status('Loading the application’s requested access…');const value=await request<ConsentProposal>('GET',undefined,pending.signal);
 if(turn!==revision||clerk.session?.id!==sessionId)return;if(!validProposal(value))throw new ApiError(400);proposal=value;show(value);if(proposal)status('Review the application, workspace and permissions carefully. Nothing has been approved yet.');
 }catch(error){if(turn!==revision)return;clear();status(failure(error));$('consent-retry').hidden=false;}}
async function decide(decision:'approve'|'deny'){
 if(busy||!proposal)return;const current=proposal;const turn=revision;
 if(Date.parse(current.consentExpiresAt)<=Date.now()){clear();status('This request has expired. Start a new connection.');return;}
 let clerk;try{clerk=await getClerk();}catch(error){if(turn===revision){clear();status(failure(error));}return;}if(turn!==revision||clerk.session?.id!==sessionId||busy||proposal!==current)return;
 const checked=(name:string)=>Array.from(document.querySelectorAll<HTMLInputElement>(`#consent-form input[name="${name}"]:checked`)).map(input=>input.value);
 const scopes=decision==='approve'?checked('scope'):[];const clientAccessMode=decision==='approve'&&checked('boundary').includes('all')?'all':'selected';const clientIds=decision==='approve'&&clientAccessMode==='selected'?checked('client'):[];
 if(clientAccessMode==='all'&&!current.allClientsAllowed){clear();status('The client boundary changed. Restart authorization.');return;}
 if(scopes.some(id=>!current.scopes.some(scope=>scope.id===id))||clientIds.some(id=>!current.clients.some(client=>client.id===id))){clear();status('The request changed. Please start a new connection.');return;}
 busy=true;$<HTMLButtonElement>('consent-approve').disabled=true;$<HTMLButtonElement>('consent-deny').disabled=true;$<HTMLButtonElement>('consent-signout').disabled=true;status(decision==='approve'?'Submitting your selected permissions…':'Denying this connection…');
 try{const result=await request<{redirectTo:string}>('POST',{handle:current.handle,decision,scopes,clientIds,clientAccessMode,connectionMode:current.connectionMode??'bounded'},pending?.signal);if(turn!==revision||clerk.session?.id!==sessionId)return;const destination=consentRedirect(result.redirectTo,current);clear();location.replace(destination);}
 catch(error){if(turn!==revision)return;clear();status(`${failure(error)} If submission was interrupted, its outcome may be uncertain. Check the requesting application before starting a new connection.`);}
 finally{busy=false;$<HTMLButtonElement>('consent-signout').disabled=false;}
}
$('consent-form').addEventListener('submit',event=>{event.preventDefault();void decide('approve');});$('consent-deny').addEventListener('click',()=>void decide('deny'));$('consent-retry').addEventListener('click',()=>void prepare());
$('consent-signout').addEventListener('click',async()=>{if(busy||signingOut)return;signingOut=true;revision++;pending?.abort();clear();dispose?.();try{await(await getClerk()).signOut();signingOut=false;await prepare();}catch(error){status(failure(error));}finally{signingOut=false;}});
window.addEventListener('pagehide',()=>{revision++;pending?.abort();clear();dispose?.();stop?.();});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
void prepare();
