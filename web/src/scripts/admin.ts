import { clearProjectTheme } from './theme';
import {getClerk,mountSignIn} from './auth';
import {api,ApiError,message} from './api';
import {sessionChangeGuard} from './access-state';
import {renderReport} from './render';
import type {Report} from './types';
import {adminEmptyMessage,adminReportPath,type AdminOverview,type AdminTarget} from './admin-state';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
const month=$<HTMLInputElement>('month');month.value=new Date().toISOString().slice(0,7);
let epoch=0,reportEpoch=0,stopAuth:(()=>void)|undefined,unmount:(()=>void)|undefined,signingOut=false,nextOffset:number|null=null,selected:AdminTarget|undefined;
function status(text:string){$('status').textContent=text;$('status').hidden=!text;}
function clearReport(){clearProjectTheme($('report'));reportEpoch++;$('report').hidden=true;for(const id of ['metrics','metric-rows','comparison-chart'])$(id).replaceChildren();$('comparison-label').textContent='';}
function clear(){clearReport();$('admin-workspace').hidden=true;$('welcome').hidden=true;$('project-rows').replaceChildren();$('summary').textContent='';selected=undefined;nextOffset=null;}
function denied(error:unknown){return error instanceof ApiError&&[401,403,404].includes(error.status);}
async function loadReport(target:AdminTarget){clearProjectTheme($('report'));const request=++reportEpoch,auth=epoch;selected=target;$('report').hidden=false;$('target-name').textContent=target.name;$('target-detail').textContent=`${target.kind==='instagram_account'?'Instagram account':'One-off project'} · ${target.status}${target.platformAccountRef?` · ${target.platformAccountRef}`:''}`;$('report-status').textContent='Loading report…';for(const id of ['metrics','metric-rows','comparison-chart'])$(id).replaceChildren();
 try{const report=await api<Report>(adminReportPath(target,month.value));if(request!==reportEpoch||auth!==epoch)return;renderReport(report);$('report-status').textContent=report.metrics.length?'':'No metrics are linked to this project yet. Add metrics through authorized MCP tools.';if(!report.metrics.length)$('metrics').replaceChildren();}
 catch(error){if(request!==reportEpoch||auth!==epoch)return;if(denied(error)){clear();status('Administrator access could not be verified. Sign in again or ask an operator to check access.');}else $('report-status').textContent=message(error);}
}
async function loadPage(offset:number,auth:number){const data=await api<AdminOverview>(`/api/admin/overview?offset=${offset}`);if(auth!==epoch||signingOut)return;$('identity').textContent=`${data.session.email} · Administrator`;$('summary').textContent=`${data.counts.clients} clients · ${data.counts.projects} projects · ${data.counts.workspaces} workspaces`;$('empty').textContent=adminEmptyMessage(data.counts);$('empty').hidden=!$('empty').textContent;
 for(const entry of data.entries){const row=document.createElement('tr');for(const text of [entry.workspaceName,entry.clientName,entry.project?.name??'No projects yet',entry.project?.status??'—']){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}const cell=document.createElement('td');if(entry.project){const target=entry.project;const button=document.createElement('button');button.className='text-button';button.textContent='View report';button.setAttribute('aria-label',`View report for ${target.name}`);button.onclick=()=>void loadReport(target);cell.append(button);}row.append(cell);$('project-rows').append(row);}
 nextOffset=data.nextOffset;$('load-more').hidden=nextOffset===null;$('admin-workspace').hidden=false;status('');
}
async function boot(){const auth=++epoch;clear();unmount?.();unmount=undefined;status('Checking administrator access…');try{const clerk=await getClerk();if(auth!==epoch||signingOut)return;$('logout').hidden=!clerk.session;if(!stopAuth){const changed=sessionChangeGuard(clerk.session?.id??null,()=>{if(!signingOut)void boot();});stopAuth=clerk.addListener(({session})=>changed(session?.id??null));}
 const browserSession=clerk.session?.id??null;const session=await api<{authenticated:boolean}>('/api/session');if(auth!==epoch||signingOut)return;if(!session.authenticated){if(clerk.session){status('Your sign-in could not be verified. Sign out and try again.');return;}$('welcome').hidden=false;unmount=await mountSignIn($<HTMLDivElement>('clerk-sign-in'),'/admin',()=>auth===epoch&&!signingOut);if(auth===epoch&&!signingOut)status('');return;}if(!browserSession||browserSession!==(clerk.session?.id??null)){status('Your sign-in could not be verified. Sign out and try again.');return;}await loadPage(0,auth);
 }catch(error){if(auth!==epoch||signingOut)return;clear();status(denied(error)?'Administrator access is unavailable for this account. Use the client view for projects shared with you.':message(error));}}
$('load-more').onclick=async()=>{const button=$<HTMLButtonElement>('load-more');if(nextOffset===null||button.disabled)return;button.disabled=true;const auth=epoch;try{await loadPage(nextOffset,auth);}catch(error){if(auth===epoch){if(denied(error))clear();status(message(error));}}finally{button.disabled=false;}};
$('refresh').onclick=()=>void boot();month.onchange=()=>{if(selected&&month.value&&month.validity.valid)void loadReport(selected);};
$('logout').onclick=async()=>{const button=$<HTMLButtonElement>('logout');if(button.disabled)return;button.disabled=true;signingOut=true;epoch++;clear();unmount?.();try{await(await getClerk()).signOut();location.replace('/');}catch(error){signingOut=false;button.disabled=false;status(message(error));}};
window.addEventListener('pagehide',()=>{epoch++;clear();stopAuth?.();unmount?.();});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});void boot();
