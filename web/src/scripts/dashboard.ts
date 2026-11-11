import {resolveWorkspaceAccess,sessionChangeGuard,verificationMessage} from './access-state';
import {getClerk,mountSignIn} from './auth';
import {api,message,ApiError} from './api';
import {renderReport} from './render';
import type {Target,Report} from './types';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(`#${id}`)!;
let authGeneration=0;let stopAuth:(()=>void)|undefined;let unmount:(()=>void)|undefined;let signingOut=false;
let targets:Target[]=[];let controller:AbortController|undefined;let generation=0;
const month=$<HTMLInputElement>('month');const selector=$<HTMLSelectElement>('target');
month.value=new Date().toISOString().slice(0,7);
function status(text:string,retry?:()=>void){const box=$('status');box.replaceChildren(document.createTextNode(text));box.hidden=!text;if(retry){const button=document.createElement('button');button.textContent='Try again';button.className='text-button';button.onclick=retry;box.append(' ',button);}}
function clearReport(){for(const id of ['metrics','metric-rows','comparison-chart'])$(id).replaceChildren();$('comparison-label').textContent='';}
async function loadReport(){controller?.abort();controller=new AbortController();const request=++generation;const target=targets[Number(selector.value)];clearReport();if(!target)return;status('Loading this month’s report…');$('dashboard').setAttribute('aria-busy','true');$('target-name').textContent=target.name;$('target-detail').textContent=`${target.kind==='instagram_account'?'Instagram account':'One-off project'}${target.platformAccountRef?` · ${target.platformAccountRef}`:''}`;$('target-avatar').textContent=target.kind==='instagram_account'?'◎':'↗';$('target-status').textContent=target.status;
 try{const report=await api<Report>(`/api/targets/${encodeURIComponent(target.clientId)}/${encodeURIComponent(target.projectId)}/report?month=${encodeURIComponent(month.value)}`,{signal:controller.signal});if(request!==generation)return;renderReport(report);$('dashboard').hidden=false;status('');}
 catch(e){if(request!==generation||(e instanceof DOMException&&e.name==='AbortError'))return;status(message(e),()=>void loadReport());if(e instanceof ApiError&&[401,403,404].includes(e.status)){$('dashboard').hidden=true;if(e.status===401){$('welcome').hidden=true;status(verificationMessage,()=>void boot());}}}
 finally{if(request===generation)$('dashboard').removeAttribute('aria-busy');}
}
async function boot(){
 const authRequest=++authGeneration;
 controller?.abort();generation++;clearReport();targets=[];selector.replaceChildren();
 $('dashboard').hidden=true;$('welcome').hidden=true;unmount?.();unmount=undefined;
 status('Opening your workspace…');
 try{
  const clerk=await getClerk();if(authRequest!==authGeneration||signingOut)return;
  $('logout').hidden=!clerk.session;$('identity').textContent=clerk.session?'Signed in · checking access':'Private client portal';
  if(!stopAuth){const changed=sessionChangeGuard(clerk.session?.id??null,()=>{if(!signingOut)void boot();});stopAuth=clerk.addListener(({session})=>changed(session?.id??null));}
  const access=await resolveWorkspaceAccess<Target>(()=>clerk.session?.id??null,()=>authRequest===authGeneration&&!signingOut,()=>api('/api/session'),async()=>(await api<{targets:Target[]}>('/api/targets')).targets);
  if(authRequest!==authGeneration||signingOut||access.kind==='stale')return;
  if(access.kind==='verification_failed'){
   $('logout').hidden=!clerk.session;status(verificationMessage,()=>void boot());return;
  }
  if(access.kind==='signed_out'){
   $('welcome').hidden=false;$('logout').hidden=true;$('identity').textContent='Private client portal';
   unmount=await mountSignIn($<HTMLDivElement>('clerk-sign-in'),'/',()=>authRequest===authGeneration&&!signingOut);
   if(authRequest===authGeneration)status('');return;
  }
  $('identity').textContent=access.email??'Signed in';$('logout').hidden=false;targets=access.targets;
  if(!targets.length){status('You’re signed in, but no accounts or projects are shared with you yet. Ask your administrator to grant access.');return;}
  targets.forEach((t,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=t.name;selector.append(option);});
  $('dashboard').hidden=false;await loadReport();
 }catch(e){if(authRequest!==authGeneration||signingOut)return;status(message(e),()=>void boot());}
}
selector.addEventListener('change',()=>void loadReport());month.addEventListener('change',()=>{if(month.validity.valid&&month.value)void loadReport();});
for(const [id,step] of [['previous-month',-1],['next-month',1]] as const){$(id).addEventListener('click',()=>{const [y,m]=month.value.split('-').map(Number);const date=new Date(`${month.value}-01T00:00:00Z`);date.setUTCMonth(m-1+step);const next=date.toISOString().slice(0,7);if(y<1000||!/^\d{4}-\d{2}$/.test(next)||next<'1000-01')return;month.value=next;void loadReport();});}
$('logout').addEventListener('click',async()=>{const button=$<HTMLButtonElement>('logout');if(button.disabled)return;button.disabled=true;signingOut=true;authGeneration++;controller?.abort();generation++;clearReport();$('dashboard').hidden=true;$('welcome').hidden=true;unmount?.();unmount=undefined;try{await (await getClerk()).signOut();location.replace('/');}catch(e){signingOut=false;status(message(e),()=>button.click());button.disabled=false;}});
window.addEventListener('pagehide',()=>{controller?.abort();generation++;clearReport();authGeneration++;stopAuth?.();unmount?.();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
void boot();
