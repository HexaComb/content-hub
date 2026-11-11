import {api,ApiError} from './api';
import {clientPresentationBasePath,clientPresentationPagePath,presentationMutation,type ClientPresentationRoute,type PresentationMutation,type PresentationReport,type PresentationState} from './client-presentation-state';
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string):HTMLElementTagNameMap[K]{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
export function mountPresentationAdmin(root:HTMLElement,route:ClientPresentationRoute,report:PresentationReport,state:PresentationState,isCurrent:()=>boolean,onCommit:(operation:'publish'|'restore',revision:number)=>void,onReload:()=>void,onAccessLost:()=>void){
 let disposed=false,busy=false,uncertain=false,pending:PresentationMutation|undefined;const controller=new AbortController();
 const current=()=>!disposed&&isCurrent();root.replaceChildren();root.hidden=false;
 root.append(el('h2',report.presentation.mode==='preview'?`Private design preview · revision ${report.presentation.revision}`:report.presentation.mode==='published'?`Published design · revision ${report.presentation.revision}`:'Default client design'));
 root.append(el('p','Administrator view: this page includes the full project report for the selected page. Each recipient sees only the metrics already approved for their account. A preview link never grants access. SEO and Instagram use one shared design and revision.'));
 const tools=el('div',undefined,'cp-admin-tools');const published=el('a','View published design');published.href=clientPresentationPagePath({...route,preview:undefined});tools.append(published);
 if(state.draftRevision!==null){const draft=el('a',`Preview draft ${state.draftRevision}`);draft.href=clientPresentationPagePath({...route,preview:state.draftRevision});tools.append(draft);}
 const publish=el('button','Publish exact draft');publish.type='button';
 const canPublish=state.draft!==null&&state.draftRevision!==null&&!state.isDraftPublished&&route.preview===state.draftRevision&&report.presentation.mode==='preview'&&report.presentation.revision===state.draftRevision;
 publish.disabled=!canPublish;tools.append(publish);root.append(tools);
 root.append(el('p',state.isDraftPublished?'The current draft is already published.':state.draftRevision===null?'No draft has been saved. Create a design through the presentation tools first.':canPublish?'This exact draft is ready for review. Publishing changes BOTH the SEO and Instagram pages for existing authorized recipients.':'Open the current draft preview to publish. Historical and published views cannot publish another unseen revision.','cp-admin-muted'));
 const historyTools=el('div',undefined,'cp-admin-tools'),label=el('label','Saved revision'),select=el('select');select.setAttribute('aria-label','Saved presentation revision');
 for(const item of state.history){const option=el('option',`Revision ${item.revision} · ${item.operation} · ${item.createdAt}`);option.value=String(item.revision);select.append(option);}label.append(select);historyTools.append(label);
 const preview=el('a','Preview selected revision'),restore=el('button','Restore as draft');restore.type='button';
 const updateHistory=()=>{const revision=Number(select.value);if(revision){preview.href=clientPresentationPagePath({...route,preview:revision});preview.hidden=false;}else preview.hidden=true;restore.disabled=!revision;};
 select.addEventListener('change',updateHistory);updateHistory();historyTools.append(preview,restore);if(state.history.length)root.append(historyTools);
 const feedback=el('p',undefined,'cp-admin-notice');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');root.append(feedback);
 const confirmation=el('section',undefined,'cp-action-confirm');confirmation.hidden=true;confirmation.setAttribute('aria-label','Confirm design change');root.append(confirmation);
 const setLocked=(locked:boolean)=>{publish.disabled=locked||!canPublish;restore.disabled=locked||!select.value;select.disabled=locked;};
 const ask=(operation:'publish'|'restore',revision:number)=>{
  if(!current()||busy||pending)return;
  pending=presentationMutation(operation,state,revision,crypto.randomUUID());setLocked(true);confirmation.replaceChildren();confirmation.hidden=false;
  confirmation.append(el('p',operation==='publish'?`Publish draft revision ${revision} for ${report.target.clientName??report.target.clientId} / ${report.target.name}? This replaces the shared design on BOTH the SEO and Instagram client pages for everyone already authorized for this project. It does not change their metric access.`:`Restore revision ${revision} as a new private draft for ${report.target.name}? Each published client page will stay unchanged until you preview and explicitly publish the shared draft. Publishing it changes BOTH SEO and Instagram.`));
  const actions=el('div',undefined,'cp-admin-tools'),confirm=el('button',operation==='publish'?`Publish revision ${revision}`:`Restore revision ${revision}`),cancel=el('button','Cancel');confirm.type=cancel.type='button';
  confirm.addEventListener('click',()=>void execute(confirm,cancel));cancel.addEventListener('click',()=>{if(busy)return;if(uncertain){onReload();return;}pending=undefined;confirmation.hidden=true;confirmation.replaceChildren();setLocked(false);(operation==='publish'?publish:restore).focus();});actions.append(confirm,cancel);confirmation.append(actions);confirm.focus();
 };
 async function execute(confirm:HTMLButtonElement,cancel:HTMLButtonElement){
  if(!current()||busy||!pending)return;busy=true;confirm.disabled=cancel.disabled=true;feedback.textContent=pending.operation==='publish'?'Publishing the confirmed draft…':'Restoring the selected revision as a draft…';
  const mutation=pending;
  try{
   const result=await api<{revision:number;operation:string}>(`${clientPresentationBasePath(route,true)}/presentation/${mutation.operation}`,{method:'POST',body:JSON.stringify(mutation.body),signal:controller.signal});
   if(!current())return;
   if(!Number.isSafeInteger(result.revision)||result.operation!==mutation.operation)throw new Error('Unexpected mutation receipt.');
   feedback.textContent=mutation.operation==='publish'?'The shared design was published for both SEO and Instagram. Loading the published page…':'The revision was restored as a private draft. Loading its exact preview…';pending=undefined;onCommit(mutation.operation,result.revision);
  }catch(error){
   if(!current())return;
   if(error instanceof ApiError&&[401,403,404].includes(error.status)){onAccessLost();return;}
   if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==429){
    pending=undefined;confirmation.replaceChildren(el('p','The change was not accepted. The design may have changed or the selected revision may no longer match the project. Read the latest state before choosing another action.'));const reload=el('button','Read latest state');reload.type='button';reload.onclick=onReload;confirmation.append(reload);feedback.textContent='No new change was confirmed.';
   }else{
    // The write may already have committed. Retry only the captured exact payload.
    uncertain=true;feedback.textContent='The outcome is not confirmed. Retry the same confirmed action to check its receipt, or read the latest state before considering another change.';confirm.textContent='Retry same action';confirm.disabled=false;cancel.textContent='Read latest state';cancel.disabled=false;
   }
  }finally{busy=false;}
 }
 publish.addEventListener('click',()=>{if(canPublish)ask('publish',state.draftRevision!);});restore.addEventListener('click',()=>ask('restore',Number(select.value)));
 return ()=>{disposed=true;controller.abort();pending=undefined;root.replaceChildren();root.hidden=true;};
}
