import {mountInstagramDashboard} from './instagram-dashboard';
import {currentReportingPeriod} from './plugin-prompt';
import {clientPresentationPagePath} from './client-presentation-state';
import {mountProjectPlugins} from './project-plugins';
import {readPluginKey,pluginCatalog,dashboardViewState,pluginApiPath} from './plugin-state';
import {readProjectRoute,projectReportPath,previousCompletedMonth} from './project-state';
import {projectPagePath} from './admin-state';
import {mountInvitations} from './project-invitations';
import { clearProjectTheme } from './theme';
import {resolveWorkspaceAccess,sessionChangeGuard,verificationMessage} from './access-state';
import {getClerk,mountSignIn} from './auth';
import {api,message,ApiError} from './api';
import {renderReport} from './render';
import type {Target,Report} from './types';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.querySelector<T>(`#${id}`)!;
const isProject=location.pathname.replace(/\/$/,'')==='/project';const route=readProjectRoute(location.search);const plugin=readPluginKey(location.search);let projectPlugins:ReturnType<typeof mountProjectPlugins>|undefined;let instagramDashboard:ReturnType<typeof mountInstagramDashboard>|undefined;let verifiedAdmin=false;let disposeInvitations:(()=>void)|undefined;
let authGeneration=0;let stopAuth:(()=>void)|undefined;let unmount:(()=>void)|undefined;let signingOut=false;
let targets:Target[]=[];let controller:AbortController|undefined;let generation=0;let monthChosen=false;
const month=$<HTMLInputElement>('month');const selector=$<HTMLSelectElement>('target');
month.value=isProject?previousCompletedMonth():new Date().toISOString().slice(0,7);
function status(text:string,retry?:()=>void){const box=$('status');box.replaceChildren(document.createTextNode(text));box.hidden=!text;if(retry){const button=document.createElement('button');button.textContent='Try again';button.className='text-button';button.onclick=retry;box.append(' ',button);}}
function clearReport(){instagramDashboard?.clear();$('client-page-entry').hidden=true;for(const key of ['seo','instagram'] as const){const link=$('open-client-page-'+key);link.removeAttribute('href');link.removeAttribute('aria-current');link.hidden=true;}$('dashboard').hidden=true;projectPlugins?.clearContent();clearProjectTheme($('dashboard'));document.title=isProject?'Client project':'Performance overview';$('project-breadcrumb').hidden=true;for(const id of ['project-breadcrumb','target-name','target-detail','target-status','target-avatar'])$(id).textContent='';for(const id of ['metrics','metric-rows'])$(id).replaceChildren();$('comparison-label').textContent='';}
async function loadReport(){controller?.abort();controller=new AbortController();const request=++generation;const target=targets[Number(selector.value)];clearReport();if(!target)return;status('Loading this month’s report…');$('dashboard').setAttribute('aria-busy','true');$('target-name').textContent=target.name;$('target-detail').textContent=`Project${target.platformAccountRef?` · ${target.platformAccountRef}`:''}`;$('target-avatar').textContent=target.kind==='instagram_account'?'◎':'↗';$('target-status').textContent=target.status;
 try{
  let allReport=await api<Report>(projectReportPath(target,month.value,verifiedAdmin),{signal:controller.signal});if(request!==generation)return;
  if(plugin==='instagram'&&!monthChosen){monthChosen=true;const currentMonth=currentReportingPeriod(allReport.target.timezone)?.month;if(currentMonth&&month.value!==currentMonth){month.value=currentMonth;allReport=await api<Report>(projectReportPath(target,month.value,verifiedAdmin),{signal:controller.signal});if(request!==generation)return;}}
  let report=allReport,enabled=true,pluginsLoaded=false;
  if(projectPlugins){
   try{await projectPlugins.load(controller.signal);if(request!==generation)return;pluginsLoaded=true;projectPlugins.render(allReport.metrics,allReport.target.status,allReport.target);if(plugin&&plugin!=='invalid'){enabled=projectPlugins.isEnabled(plugin);if(enabled)report=await api<Report>(projectReportPath(target,month.value,verifiedAdmin)+'&plugin='+plugin,{signal:controller.signal});}}
   catch(error){if(plugin)throw error;if(request!==generation)return;const box=$('project-plugins');box.hidden=false;box.replaceChildren(document.createTextNode('Dashboards could not be loaded. Retry to choose a dashboard. '));const retry=document.createElement('button');retry.className='admin-button';retry.textContent='Retry plugins';retry.onclick=()=>void loadReport();box.append(retry);}
  }
  if(request!==generation)return;const selectedPlugin=plugin&&plugin!=='invalid'?plugin:null;const view=dashboardViewState(isProject,selectedPlugin,enabled,report.metrics.length);
  // Never render the unfiltered project report into a plugin or project-home view.
  const instagramView=selectedPlugin==='instagram'&&enabled;
  if(view.report&&!instagramView)renderReport(report);
  $('dashboard').querySelectorAll<HTMLElement>(':scope > .theme-divider, :scope > .section-heading, :scope > .metrics').forEach(node=>node.hidden=instagramView);
  $('dashboard').querySelectorAll<HTMLElement>(':scope > .detail-grid, :scope > .data-panel').forEach(node=>node.hidden=instagramView||!view.comparisons);
  $('month').closest<HTMLElement>('.month-control')!.hidden=!view.report;
  if(selectedPlugin&&view.report&&!instagramView&&!report.metrics.length){$('metrics').replaceChildren();const empty=document.createElement('p');empty.className='notice';empty.textContent=verifiedAdmin?`No ${pluginCatalog[selectedPlugin].name} metrics are configured yet. Open Plugin settings to choose compatible project metrics, or add them through MCP.`:'No metrics are shared with you in this plugin yet. Ask your project administrator to check the metric settings.';$('metrics').append(empty);}
  $('target-name').textContent=selectedPlugin?(report.target.clientName??report.target.name):report.target.name;$('target-detail').textContent=selectedPlugin?`${pluginCatalog[selectedPlugin].name} performance · ${report.target.name}`:`Project${report.target.platformAccountRef?` · ${report.target.platformAccountRef}`:''}`;$('target-status').textContent=report.target.status;$('project-breadcrumb').hidden=false;$('project-breadcrumb').textContent=`${report.target.clientName??target.clientName??target.clientId} › ${report.target.name}`;
  const title=plugin&&plugin!=='invalid'?pluginCatalog[plugin].name+' dashboard':'Client project';document.title=`${report.target.name} · ${title}`;
  const heading=document.querySelector('.admin-heading h1');if(heading&&isProject)heading.textContent=selectedPlugin?`${pluginCatalog[selectedPlugin].name} dashboard`:report.target.name;
  $('project-preview-label').textContent=selectedPlugin?`Administrator preview · ${pluginCatalog[selectedPlugin].name}`:'Administrator preview · Project home';
  $('project-preview-description').textContent=selectedPlugin?`This dashboard shows only compatible ${pluginCatalog[selectedPlugin].name} metrics. Client recipients see only their approved metrics.`:'Choose a dashboard below. Client recipients see only their approved metrics.';
  if(isProject&&pluginsLoaded&&(!selectedPlugin||enabled)){
   let links=0;for(const key of ['seo','instagram'] as const){
    if(!projectPlugins?.isEnabled(key)||selectedPlugin&&key!==selectedPlugin)continue;
    const link=$<HTMLAnchorElement>('open-client-page-'+key);link.href=clientPresentationPagePath({clientId:target.clientId,projectId:target.projectId,plugin:key,...(verifiedAdmin&&target.tenantId?{tenantId:target.tenantId}:{}),month:month.value});link.hidden=false;links++;
   }$('client-page-entry').hidden=!links;
  }
  $('dashboard').hidden=!view.report;status('');
  if(instagramView){if(instagramDashboard)await instagramDashboard.updateMonth(month.value,controller.signal);}else void projectPlugins?.loadContent();
 }
 catch(e){if(request!==generation||(e instanceof DOMException&&e.name==='AbortError'))return;status(message(e),()=>void loadReport());if(e instanceof ApiError&&[401,403,404].includes(e.status)){$('dashboard').hidden=true;if(e.status===401){$('welcome').hidden=true;status(verificationMessage,()=>void boot());}}}
 finally{if(request===generation)$('dashboard').removeAttribute('aria-busy');}
}
async function boot(){
 const authRequest=++authGeneration;verifiedAdmin=false;monthChosen=false;instagramDashboard?.dispose();instagramDashboard=undefined;disposeInvitations?.();disposeInvitations=undefined;projectPlugins?.dispose();projectPlugins=undefined;$('project-admin').hidden=true;$('invitations').hidden=true;
 let adminRole=false;
 $('admin-link').hidden=true;
 controller?.abort();generation++;clearReport();targets=[];selector.replaceChildren();
 $('dashboard').hidden=true;$('welcome').hidden=true;unmount?.();unmount=undefined;
 status('Opening your projects…');
 try{
  const clerk=await getClerk();if(authRequest!==authGeneration||signingOut)return;
  $('logout').hidden=!clerk.session;$('identity').textContent=clerk.session?'Signed in · checking access':'Private client portal';
  if(!stopAuth){const changed=sessionChangeGuard(clerk.session?.id??null,()=>{if(!signingOut)void boot();});stopAuth=clerk.addListener(({session})=>changed(session?.id??null));}
  const access=await resolveWorkspaceAccess<Target>(()=>clerk.session?.id??null,()=>authRequest===authGeneration&&!signingOut,()=>api('/api/session'),async()=>{
   try{const admin=await api<{authenticated:boolean;role?:string}>('/api/admin/session');adminRole=admin.authenticated===true&&admin.role==='super_admin';}
   catch(error){if(!(error instanceof ApiError&&[403,404].includes(error.status)))throw error;}
   if(isProject){if(!route)return [];return [{...route,name:'Project',kind:'one_off_project',status:''}];}
   if(adminRole&&new URLSearchParams(location.search).get('view')!=='client')return [];
   return (await api<{targets:Target[]}>('/api/targets')).targets;
  });
  if(authRequest!==authGeneration||signingOut||access.kind==='stale')return;
  if(access.kind==='verification_failed'){
   $('logout').hidden=!clerk.session;status(verificationMessage,()=>void boot());return;
  }
  if(access.kind==='signed_out'){
   $('welcome').hidden=false;$('logout').hidden=true;$('identity').textContent='Private client portal';
   unmount=await mountSignIn($<HTMLDivElement>('clerk-sign-in'),isProject?location.pathname+location.search:'/',()=>authRequest===authGeneration&&!signingOut);
   if(authRequest===authGeneration)status('');return;
  }
  if(!isProject&&adminRole&&new URLSearchParams(location.search).get('view')!=='client'){location.replace('/admin');return;}
  $('admin-link').hidden=!adminRole;verifiedAdmin=adminRole;
  if(isProject&&plugin==='invalid'){status('This plugin link is invalid. Open the project overview to choose a dashboard.');return;}
  if(isProject&&!route){status('This project link is incomplete. Open a project from your project list.');return;}
  if(isProject&&adminRole&&route?.tenantId){$('project-admin').hidden=false;disposeInvitations=mountInvitations(route,()=>authRequest===authGeneration&&!signingOut);}
  if(isProject&&route&&plugin!=='invalid')projectPlugins=mountProjectPlugins(route,adminRole&&!!route.tenantId,plugin,()=>authRequest===authGeneration&&!signingOut,()=>void loadReport());
  if(isProject&&route&&plugin==='instagram')instagramDashboard=mountInstagramDashboard({root:$('instagram-dashboard'),apiPrefix:pluginApiPath(route,adminRole&&!!route.tenantId),month:month.value,admin:adminRole&&!!route.tenantId,isCurrent:()=>authRequest===authGeneration&&!signingOut});
  selector.closest<HTMLElement>('.target-control')!.hidden=isProject;
  $('identity').textContent=access.email??'Signed in';$('logout').hidden=false;targets=access.targets;
  if(!targets.length){status('You’re signed in, but no projects are shared with you yet. Ask your administrator to grant access.');return;}
  targets.forEach((t,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${t.clientName??t.clientId} › ${t.name}`;selector.append(option);});
  $('dashboard').hidden=false;await loadReport();
 }catch(e){if(authRequest!==authGeneration||signingOut)return;status(message(e),()=>void boot());}
}
selector.addEventListener('change',()=>{const target=targets[Number(selector.value)];if(target)location.assign(projectPagePath({clientId:target.clientId,projectId:target.projectId}));});month.addEventListener('change',()=>{monthChosen=true;if(month.validity.valid&&month.value)void loadReport();});
for(const [id,step] of [['previous-month',-1],['next-month',1]] as const){$(id).addEventListener('click',()=>{monthChosen=true;const [y,m]=month.value.split('-').map(Number);const date=new Date(`${month.value}-01T00:00:00Z`);date.setUTCMonth(m-1+step);const next=date.toISOString().slice(0,7);if(y<1000||!/^\d{4}-\d{2}$/.test(next)||next<'1000-01')return;month.value=next;void loadReport();});}
$('logout').addEventListener('click',async()=>{const button=$<HTMLButtonElement>('logout');if(button.disabled)return;button.disabled=true;signingOut=true;disposeInvitations?.();instagramDashboard?.dispose();projectPlugins?.dispose();authGeneration++;controller?.abort();generation++;clearReport();$('dashboard').hidden=true;$('welcome').hidden=true;unmount?.();unmount=undefined;try{await (await getClerk()).signOut();location.replace('/');}catch(e){signingOut=false;status(message(e),()=>button.click());button.disabled=false;}});
window.addEventListener('pagehide',()=>{disposeInvitations?.();instagramDashboard?.dispose();projectPlugins?.dispose();controller?.abort();generation++;clearReport();authGeneration++;stopAuth?.();unmount?.();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
void boot();
