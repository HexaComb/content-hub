import {getClerk,mountSignIn} from './auth';
import {api,message} from './api';
import {sessionChangeGuard} from './access-state';
type Connection={clientAccessMode?:'selected'|'all';id:string;application:string;clientId:string;connectionMode:'bounded'|'ongoing';createdAt:string;expiresAt:string;revokedAt:string|null;cleanupPending:boolean;scopes:string[];clients:string[];authorizationActive:boolean};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let cursor:string|null=null;
let epoch=0,alive=true,busy=false,dispose:(()=>void)|undefined,stop:(()=>void)|undefined;
const status=(text:string)=>{$('connections-status').textContent=text;};
function text(tag:string,value:string,className?:string){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
function clear(){ $('connections-list').replaceChildren();cursor=null;$('connections-more').hidden=true;dispose?.();dispose=undefined;$('connections-login').hidden=true;$('connections-signout').hidden=true;$('connections-reload').hidden=true; }
function render(connection:Connection,turn:number){
 const card=document.createElement('section');card.className='connection-card';card.append(text('h2',connection.application),text('p',connection.authorizationActive?'Authorized here; app connection not verified':connection.revokedAt?'Disconnected':'Expired or no longer authorized','connection-state'));
 card.append(text('p',`Application ID: ${connection.clientId}`),text('p',`Clients: ${connection.clientAccessMode==='all'?'All current and future clients and projects in this workspace':connection.clients.length?connection.clients.join(', '):'No client data selected'}`),text('p',`Permissions: ${connection.scopes.join(', ')}`));
 const expiry=new Date(connection.expiresAt).toLocaleString();
 card.append(text('p',connection.connectionMode==='ongoing'?`Ongoing connection with rotating refresh. Disconnect any time. Inactivity deadline: ${expiry}; each successful refresh moves it 30 days ahead.`:`Fixed access expiry: ${expiry}. This connection is not silently extended.`));
 if(!connection.revokedAt||connection.cleanupPending){
  const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=connection.revokedAt?'Retry token cleanup':'Disconnect';
  button.addEventListener('click',()=>{
   if(busy||!alive||turn!==epoch)return;
   const confirm=document.createElement('div');confirm.className='connection-confirm';confirm.append(text('p',connection.revokedAt?'Workspace access is already blocked. Retry removal of the remaining provider tokens?':`Disconnect ${connection.application}? It will stop being able to access this workspace. This does not undo data it already read or changed.`));
   const yes=document.createElement('button'),no=document.createElement('button');yes.type=no.type='button';yes.className=no.className='text-button';yes.textContent=connection.revokedAt?'Retry cleanup':'Yes, disconnect';no.textContent='Keep connection';confirm.append(yes,no);button.hidden=true;card.append(confirm);
   no.addEventListener('click',()=>{if(!busy){confirm.remove();button.hidden=false;}});
   yes.addEventListener('click',async()=>{
    if(busy||!alive||turn!==epoch)return;busy=true;yes.disabled=no.disabled=true;$<HTMLButtonElement>('connections-signout').disabled=true;
    try{const result=await api<{revoked:boolean;providerRevocationPending:boolean}>(`/api/oauth/connections/${encodeURIComponent(connection.id)}/revoke`,{method:'POST',body:'{}'});if(!alive||turn!==epoch)return;await load();status(result.providerRevocationPending?'Workspace access is blocked. Provider token cleanup is pending; refresh this page before retrying cleanup.':'Connection disconnected. Workspace access is blocked.');}
    catch{if(alive&&turn===epoch)status('Could not confirm the disconnect result. Refresh connections before retrying.');}
    finally{busy=false;$<HTMLButtonElement>('connections-signout').disabled=false;}
   });
  });card.append(button);
 }
 $('connections-list').append(card);
}
async function load(more=false){const turn=more?epoch:++epoch;if(!more)clear();status(more?'Loading more connections…':'Checking secure sign-in…');
 try{const clerk=await getClerk();if(!alive||turn!==epoch)return;
  if(!stop){const changed=sessionChangeGuard(clerk.session?.id??null,()=>{epoch++;clear();void load();});stop=clerk.addListener(({session})=>changed(session?.id??null));}
  if(!clerk.session){$('connections-login').hidden=false;status('Sign in to see only the apps you authorized.');dispose=await mountSignIn($('connections-sign-in'),'/connections',()=>alive&&turn===epoch);return;}
  $('connections-signout').hidden=false;
  const sessionId=clerk.session.id;const result=await api<{connections:Connection[];nextCursor:string|null}>('/api/oauth/connections'+(more&&cursor?'?'+new URLSearchParams({cursor}).toString():''));if(!alive||turn!==epoch||clerk.session?.id!==sessionId)return;
  cursor=result.nextCursor;$('connections-more').hidden=!cursor;for(const connection of result.connections)render(connection,turn);status(result.connections.length?'Only your connections are shown. Disconnecting does not change other people’s access.':'You have no connections to this workspace.');
 }catch(error){if(alive&&turn===epoch)status(message(error));}finally{if(alive&&turn===epoch)$('connections-reload').hidden=false;}
}
$('connections-more').addEventListener('click',async()=>{if(busy||!cursor)return;busy=true;try{await load(true);}finally{busy=false;}});
$('connections-reload').addEventListener('click',()=>{if(!busy)void load();});
$('connections-signout').addEventListener('click',async()=>{if(busy)return;busy=true;epoch++;clear();try{await(await getClerk()).signOut();await load();}catch{status('Sign-out could not be confirmed. Try again.');}finally{busy=false;}});
window.addEventListener('pagehide',()=>{alive=false;epoch++;clear();stop?.();});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});void load();
