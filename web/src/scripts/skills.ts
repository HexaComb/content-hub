import {agentWorkflows,buildSkillsSetupPrompt} from './skills-catalog';
import {bindPromptCopy} from './prompt-copy';
import {getClerk} from './auth';
import {api} from './api';
import {sessionChangeGuard} from './access-state';

const area=document.getElementById('skills-setup-prompt') as HTMLTextAreaElement;
const copy=document.getElementById('copy-skills-setup') as HTMLButtonElement;
const panel=document.getElementById('skills-prompt-panel') as HTMLDetailsElement;
const label=document.getElementById('skills-prompt-label')!;
const notice=document.getElementById('skills-copy-status')!;
let active=true,authEpoch=0,stopAuth:(()=>void)|undefined;
copy.addEventListener('click',()=>{panel.open=true;});
const disposeCopy=bindPromptCopy(area,copy,notice,()=>active);
function choose(id?:string) {
  if(!active||copy.disabled)return;
  const workflow=agentWorkflows.find(item=>item.id===id);
  if(id&&!workflow)return;
  area.value=buildSkillsSetupPrompt(workflow?[workflow.id]:undefined);
  label.textContent=workflow?`· ${workflow.title}`:'· All workflows';
  copy.textContent=workflow?'Copy selected skill setup':'Copy setup prompt';
  panel.open=true;
  notice.textContent=workflow?`Selected ${workflow.title}. Review the prompt, then copy it.`:'All workflows selected. Review the prompt, then copy it.';
  panel.scrollIntoView({block:'center',behavior:'auto'});
  area.focus({preventScroll:true});
}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-workflow]'))button.addEventListener('click',()=>choose(button.dataset.workflow));
document.getElementById('reset-skills-prompt')!.addEventListener('click',()=>choose());

// The guide is public and contains no client data. Session reads only personalize
// navigation; unavailable authentication never prevents reading/copying skills.
async function showAccount() {
  const epoch=++authEpoch;
  const identity=document.getElementById('identity')!;
  const adminLink=document.getElementById('admin-link')!;
  const logout=document.getElementById('logout') as HTMLButtonElement;
  adminLink.hidden=true;logout.hidden=true;identity.textContent='Agent guides';
  try {
    const clerk=await getClerk();
    if(!active||epoch!==authEpoch)return;
    if(!stopAuth){const changed=sessionChangeGuard(clerk.session?.id??null,()=>void showAccount());stopAuth=clerk.addListener(({session})=>changed(session?.id??null));}
    if(!clerk.session)return;
    const session=await api<{authenticated:boolean;email?:string}>('/api/session');
    if(!active||epoch!==authEpoch||!session.authenticated)return;
    identity.textContent=session.email??'Signed in';logout.hidden=false;
    try {const admin=await api<{authenticated:boolean;role?:string}>('/api/admin/session');if(active&&epoch===authEpoch)adminLink.hidden=!(admin.authenticated&&admin.role==='super_admin');}catch{/* No administrator link without a verified role. */}
  }catch{/* Public workflow guidance stays available. */}
}
document.getElementById('logout')!.addEventListener('click',async()=>{
  const button=document.getElementById('logout') as HTMLButtonElement;
  if(button.disabled)return;
  button.disabled=true;authEpoch++;
  try {await(await getClerk()).signOut();location.replace('/skills');}
  catch{button.disabled=false;document.getElementById('identity')!.textContent='Sign-out could not be confirmed. Try again.';}
});
window.addEventListener('pagehide',()=>{active=false;authEpoch++;disposeCopy();stopAuth?.();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
void showAccount();
