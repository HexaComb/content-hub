import {getClerk,mountSignIn} from './auth';
import {api,ApiError,message} from './api';
import {sessionChangeGuard} from './access-state';
import {adminEmptyMessage,projectPagePath,type AdminOverview,type AdminTarget} from './admin-state';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
let epoch=0,stopAuth:(()=>void)|undefined,unmount:(()=>void)|undefined,signingOut=false,nextOffset:number|null=null;
function status(text:string){$('status').textContent=text;$('status').hidden=!text;}
function clear(){$<HTMLInputElement>('project-search').value='';$('search-summary').textContent='';$('search-empty').hidden=true;$('admin-workspace').hidden=true;$('welcome').hidden=true;$('project-rows').replaceChildren();$('summary').textContent='';for(const id of ['project-total','client-total'])$(id).textContent='—';nextOffset=null;}
function denied(error:unknown){return error instanceof ApiError&&[401,403,404].includes(error.status);}
async function loadPage(offset:number,auth:number){const data=await api<AdminOverview>(`/api/admin/overview?offset=${offset}`);if(auth!==epoch||signingOut)return;$('identity').textContent=`${data.session.email} · Administrator`;$('summary').textContent='Open a project to explore its reports and client access.';for(const [id,value] of [['project-total',data.counts.projects],['client-total',data.counts.clients]] as const)$(id).textContent=new Intl.NumberFormat('en').format(value);$('empty').textContent=adminEmptyMessage(data.counts);$('empty').hidden=!$('empty').textContent;
 for(const entry of data.entries){
  const row=document.createElement('tr');
  const projectCell=document.createElement('td');const projectName=document.createElement(entry.project?'a':'span');if(entry.project)(projectName as HTMLAnchorElement).href=projectPagePath(entry.project);projectName.className='admin-project-name';projectName.textContent=entry.project?.name??'No projects yet';projectCell.append(projectName);
  if(entry.project){const kind=document.createElement('span');kind.className='admin-project-kind';kind.textContent='Project';projectCell.append(kind);}
  row.append(projectCell);
  for(const text of [entry.clientName]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}
  const statusCell=document.createElement('td');const badge=document.createElement('span');badge.className='admin-status';badge.textContent=entry.project?.status??'No project';badge.dataset.status=entry.project?.status??'empty';statusCell.append(badge);row.append(statusCell);
  const cell=document.createElement('td');if(entry.project){const target=entry.project;const link=document.createElement('a');link.className='admin-report-button';link.textContent='Preview page →';link.href=projectPagePath(target);link.setAttribute('aria-label',`Preview page for ${target.name}`);cell.append(link);row.classList.add('project-row');row.addEventListener('click',event=>{if((event.target as Element).closest('a,button')||window.getSelection()?.toString())return;location.assign(link.href);});}row.append(cell);$('project-rows').append(row);
 }
 filterProjects();nextOffset=data.nextOffset;$('load-more').hidden=nextOffset===null;$('admin-workspace').hidden=false;status('');
}
async function boot(){const auth=++epoch;clear();unmount?.();unmount=undefined;status('Checking administrator access…');try{const clerk=await getClerk();if(auth!==epoch||signingOut)return;$('logout').hidden=!clerk.session;if(!stopAuth){const changed=sessionChangeGuard(clerk.session?.id??null,()=>{if(!signingOut)void boot();});stopAuth=clerk.addListener(({session})=>changed(session?.id??null));}
 const browserSession=clerk.session?.id??null;const session=await api<{authenticated:boolean}>('/api/session');if(auth!==epoch||signingOut)return;if(!session.authenticated){if(clerk.session){status('Your sign-in could not be verified. Sign out and try again.');return;}$('welcome').hidden=false;unmount=await mountSignIn($<HTMLDivElement>('clerk-sign-in'),'/admin',()=>auth===epoch&&!signingOut);if(auth===epoch&&!signingOut)status('');return;}if(!browserSession||browserSession!==(clerk.session?.id??null)){status('Your sign-in could not be verified. Sign out and try again.');return;}await loadPage(0,auth);
 }catch(error){if(auth!==epoch||signingOut)return;clear();status(denied(error)?'Administrator access is unavailable for this account. Use the client view for projects shared with you.':message(error));}}
$('load-more').onclick=async()=>{const button=$<HTMLButtonElement>('load-more');if(nextOffset===null||button.disabled)return;button.disabled=true;const auth=epoch;try{await loadPage(nextOffset,auth);}catch(error){if(auth===epoch){if(denied(error))clear();status(message(error));}}finally{button.disabled=false;}};
function filterProjects(){
 const query=$<HTMLInputElement>('project-search').value.trim().toLocaleLowerCase();
 const rows=[...$('project-rows').querySelectorAll<HTMLTableRowElement>('tr')];let shown=0;
 for(const row of rows){row.hidden=!row.textContent?.toLocaleLowerCase().includes(query);if(!row.hidden)shown++;}
 $('search-summary').textContent=query?`${shown} of ${rows.length} loaded entries match`:`${rows.length} entries loaded`;
 $('search-empty').hidden=!query||shown>0;
}
$('project-search').addEventListener('input',filterProjects);
$('refresh').onclick=()=>void boot();
$('logout').onclick=async()=>{const button=$<HTMLButtonElement>('logout');if(button.disabled)return;button.disabled=true;signingOut=true;epoch++;clear();unmount?.();try{await(await getClerk()).signOut();location.replace('/');}catch(error){signingOut=false;button.disabled=false;status(message(error));}};
window.addEventListener('pagehide',()=>{epoch++;clear();stopAuth?.();unmount?.();});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});void boot();
