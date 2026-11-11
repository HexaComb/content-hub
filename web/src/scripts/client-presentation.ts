import {getClerk,mountSignIn} from './auth';
import {api,ApiError,message} from './api';
import {resolveWorkspaceAccess,sessionChangeGuard,verificationMessage} from './access-state';
import {previousCompletedMonth} from './project-state';
import {readClientPresentationRoute,clientPresentationApiPath,clientPresentationBasePath,clientPresentationPagePath,presentationRequestGuard,validPresentationMonth,presentationReportMatches,presentationPageLabels,type ClientPresentationRoute,type PresentationReport,type PresentationState} from './client-presentation-state';
import {clearClientPresentation,renderClientPresentation,renderClientPresentationChooser} from './client-presentation-render';
import {renderPresentationNavigation} from './client-presentation-navigation';
import {renderClientInstagramMetrics,selectClientInstagramMetrics,restrictClientInstagramMetrics,type ClientInstagramMetrics} from './client-instagram-metrics';
import {mountPresentationAdmin} from './client-presentation-admin';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$('client-canvas'),ledger=$('client-ledger'),reportSection=$('client-report'),admin=$('client-admin'),month=$<HTMLInputElement>('client-month');
const authGuard=presentationRequestGuard(),reportGuard=presentationRequestGuard();
let route:ClientPresentationRoute|null=null,verifiedAdmin=false,verifiedSession:string|null=null,signingOut=false;
let clerk:Awaited<ReturnType<typeof getClerk>>|undefined,controller:AbortController|undefined,stopAuth:(()=>void)|undefined,unmount:(()=>void)|undefined,disposeAdmin:(()=>void)|undefined;
function status(text:string,retry?:()=>void){const box=$('client-status');box.replaceChildren(document.createTextNode(text));box.hidden=!text;if(retry){const button=document.createElement('button');button.type='button';button.textContent='Try again';button.onclick=retry;box.append(' ',button);}}
function clearReport(){const navigation=$('client-page-navigation');navigation.replaceChildren();navigation.hidden=true;$('client-design-revision').textContent='';disposeAdmin?.();disposeAdmin=undefined;admin.replaceChildren();admin.hidden=true;reportSection.hidden=true;reportSection.removeAttribute('aria-busy');clearClientPresentation(canvas,ledger);ledger.hidden=true;document.title='Private client report';for(const id of ['client-business-name','client-project-name','client-project-detail'])$(id).textContent='';}
function cancelReport(){controller?.abort();controller=undefined;reportGuard.invalidate();clearReport();}
function activeSession(){return !!verifiedSession&&clerk?.session?.id===verifiedSession&&!signingOut;}
function changeMonth(next:string){if(!route||!activeSession()||!validPresentationMonth(next))return;route={...route,month:next};history.pushState(null,'',clientPresentationPagePath(route));month.value=next;void loadReport();}
function updateMonthControls(){ $('client-previous-month').toggleAttribute('disabled',month.value==='1000-01');$('client-next-month').toggleAttribute('disabled',month.value==='9999-12');}
async function loadReport(){
 if(!route||!activeSession())return;
 controller?.abort();controller=new AbortController();const signal=controller.signal,ticket=reportGuard.begin(),selected=route,selectedMonth=month.value,session=verifiedSession;
 const current=()=>reportGuard.current(ticket)&&activeSession()&&verifiedSession===session;
 clearReport();status('Loading your report…');reportSection.setAttribute('aria-busy','true');updateMonthControls();
 try{
  // Read canonical Instagram observations first. The later presentation response
  // supplies the final grant/plugin mapping snapshot used to filter every value.
  const packet=selected.plugin==='instagram'?await api<ClientInstagramMetrics>(`${clientPresentationBasePath(selected,verifiedAdmin)}/plugins/instagram/dashboard?month=${encodeURIComponent(selectedMonth)}`,{signal}).then(selectClientInstagramMetrics):null;
  if(!current())return;
  const [report,state]=await Promise.all([api<PresentationReport>(clientPresentationApiPath(selected,selectedMonth,verifiedAdmin),{signal}),selected.tenantId?api<PresentationState>(`${clientPresentationBasePath(selected,verifiedAdmin)}/presentation-state`,{signal}):Promise.resolve(null)]);
  if(!current())return;
  if(!presentationReportMatches(report,selected,selectedMonth)||packet&&(packet.month!==selectedMonth||packet.target.clientId!==selected.clientId||packet.target.projectId!==selected.projectId||selected.tenantId&&packet.target.tenantId!==selected.tenantId))throw new Error('The report did not match the requested project, page or revision.');
  const instagram=packet?restrictClientInstagramMetrics(packet,new Set(report.metrics.map(metric=>metric.id))):null;
  const choosePage=!selected.plugin&&report.presentation.pages.length>0;
  if(choosePage)renderClientPresentationChooser(canvas,ledger,report,report.presentation.document);
  else renderClientPresentation(canvas,ledger,report,report.presentation.document,{canonicalInstagramMetrics:!!instagram});
  ledger.hidden=choosePage;
  if(instagram)renderClientInstagramMetrics(canvas,instagram,current);
  const pageLabel=selected.plugin?presentationPageLabels[selected.plugin]:null;
  renderPresentationNavigation($('client-page-navigation'),{...selected,month:selectedMonth},report.presentation.pages,current,next=>{
   if(!current())return;route={...selected,month:selectedMonth,plugin:next};history.pushState(null,'',clientPresentationPagePath(route));void loadReport();
  });
  $('client-design-revision').textContent=report.presentation.mode==='default'?'Shared default design · SEO + Instagram':`Shared design · revision ${report.presentation.revision} · SEO + Instagram${report.presentation.mode==='preview'?' · Private preview':''}`;
  $('client-business-name').textContent=report.target.clientName??report.target.clientId;$('client-project-name').textContent=pageLabel?`${report.target.clientName??report.target.clientId} · ${pageLabel}`:report.target.name;$('client-project-detail').textContent=`${pageLabel?report.target.name+' · ':''}${report.target.platformAccountRef?report.target.platformAccountRef+' · ':''}Private monthly report${report.target.status?' · '+report.target.status:''}${!report.presentation.pages.length?' · No SEO or Instagram pages enabled':''}`;
  document.title=`${report.target.name} · ${pageLabel??'Private'} report`;
  if(selected.tenantId&&state&&!choosePage)disposeAdmin=mountPresentationAdmin(admin,{...selected,month:selectedMonth},report,state,current,(operation,revision)=>{
   if(!current())return;route={...selected,month:selectedMonth,preview:operation==='restore'?revision:undefined};history.pushState(null,'',clientPresentationPagePath(route));void loadReport();
  },()=>void loadReport(),()=>void boot());
  reportSection.hidden=false;status('');
 }catch(error){
  if(!current()||signal.aborted)return;clearReport();
  if(error instanceof ApiError&&error.status===401){verifiedSession=null;status(verificationMessage,()=>void boot());}
  else status(message(error),()=>void boot());
 }finally{if(current())reportSection.removeAttribute('aria-busy');}
}
async function boot(){
 const ticket=authGuard.begin();verifiedAdmin=false;verifiedSession=null;cancelReport();unmount?.();unmount=undefined;$('client-welcome').hidden=true;$('client-identity').textContent='Private client report';
 route=readClientPresentationRoute(location.search);month.value=route?.month??previousCompletedMonth();status('Checking secure access…');
 const current=()=>authGuard.current(ticket)&&!signingOut;
 if(!route){status('This client report link is invalid or incomplete. Open the original project link, or ask your administrator for a new one.');return;}
 try{
  clerk=await getClerk();if(!current())return;
  $('client-logout').hidden=!clerk.session;
  if(!stopAuth){const changed=sessionChangeGuard(clerk.session?.id??null,()=>{if(!signingOut)void boot();});stopAuth=clerk.addListener(({session})=>changed(session?.id??null));}
  const target=route;
  const access=await resolveWorkspaceAccess(()=>clerk?.session?.id??null,current,()=>api('/api/session'),async()=>{
   if(target.tenantId){const result=await api<{authenticated:boolean;role?:string}>('/api/admin/session');if(!current())return [];if(result.authenticated!==true||result.role!=='super_admin')throw new ApiError(403);verifiedAdmin=true;}
   return [target];
  });
  if(!current()||access.kind==='stale')return;
  if(access.kind==='signed_out'){
   $('client-welcome').hidden=false;$('client-logout').hidden=true;unmount=await mountSignIn($<HTMLDivElement>('client-sign-in'),clientPresentationPagePath(target),current);if(current())status('');return;
  }
  if(access.kind==='verification_failed'){status(verificationMessage,()=>void boot());return;}
  verifiedSession=clerk.session?.id??null;$('client-identity').textContent=access.email??'Signed in';$('client-logout').hidden=false;await loadReport();
 }catch(error){if(!current())return;cancelReport();status(message(error),()=>void boot());}
}
month.addEventListener('change',()=>{if(month.validity.valid&&validPresentationMonth(month.value))changeMonth(month.value);else month.reportValidity();});
for(const [id,step] of [['client-previous-month',-1],['client-next-month',1]] as const)$(id).addEventListener('click',()=>{if(!validPresentationMonth(month.value))return;const date=new Date(`${month.value}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+step);const next=date.toISOString().slice(0,7);if(validPresentationMonth(next))changeMonth(next);});
$('client-logout').addEventListener('click',async()=>{
 const button=$<HTMLButtonElement>('client-logout');if(button.disabled)return;button.disabled=true;signingOut=true;authGuard.invalidate();verifiedSession=null;verifiedAdmin=false;cancelReport();unmount?.();unmount=undefined;$('client-welcome').hidden=true;$('client-identity').textContent='Signing out…';
 try{await(await getClerk()).signOut();signingOut=false;button.disabled=false;void boot();}
 catch(error){signingOut=false;button.disabled=false;$('client-identity').textContent='Sign-out not confirmed';status(message(error),()=>button.click());}
});
window.addEventListener('popstate',()=>void boot());
window.addEventListener('pagehide',()=>{authGuard.invalidate();verifiedSession=null;cancelReport();stopAuth?.();stopAuth=undefined;unmount?.();unmount=undefined;$('client-welcome').hidden=true;$('client-identity').textContent='Private client report';});
window.addEventListener('pageshow',event=>{if(event.persisted)void boot();});
void boot();
