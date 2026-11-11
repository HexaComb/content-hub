import {bindPromptCopy} from './prompt-copy';
export {bindPromptCopy} from './prompt-copy';
import {instagramMetricKind} from '../../../src/instagramSchema.ts';
import {api,post,message} from './api';
import {createModal} from './modal';
import {pluginCatalog,pluginApiPath,pluginPagePath,suggestedMetricIds,metricAllowedForPlugin,excludedPluginMetricIds,pluginMappingWarning,type PluginKey,type ProjectPlugin} from './plugin-state';
import type {ProjectRoute} from './project-state';
import type {Metric,Target} from './types';
import {buildMonthlyMetricsPrompt,currentReportingPeriod} from './plugin-prompt';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
function button(text:string,action:()=>void){const node=el('button',text,'admin-button');node.type='button';node.onclick=action;return node;}
type StoredContent={id:string;title:string;kind:string|null;status:string;scheduledAt:string|null;publishedAt:string|null};
export function mountProjectPlugins(target:ProjectRoute,admin:boolean,selected:PluginKey|null,isCurrent:()=>boolean,onChange:()=>void){
 const root=document.getElementById('project-plugins')!,path=pluginApiPath(target,admin);
 let disposed=false,configs:ProjectPlugin[]=[],metrics:Metric[]=[],canManage=false,dialog:ReturnType<typeof createModal>|undefined;
 let contentSequence=0;let projectDetails:Target|undefined;
 const current=()=>!disposed&&isCurrent();
 const configuration=(key:PluginKey)=>configs.find(plugin=>plugin.key===key);
 async function load(signal?:AbortSignal){const result=await api<{plugins:ProjectPlugin[]}>(path,{signal});if(current())configs=result.plugins;return result.plugins;}
 function openSettings(key:PluginKey,trigger:HTMLElement){
  if(!current()||!canManage)return;
  dialog?.dispose();let alive=true;
  const modal=createModal({title:`${configuration(key)?.enabled?'Configure':'Add'} ${pluginCatalog[key].name}`,trigger,onClose:()=>{alive=false;}});dialog=modal;
  const config=configuration(key),eligibleMetrics=metrics.filter(metric=>metricAllowedForPlugin(key,metric)&&(key!=='instagram'||instagramMetricKind(metric.key)!==null)),chosen=new Set(config?.metricIds??suggestedMetricIds(key,metrics));
  const intro=el('p',key==='seo'?'Choose which project metrics appear in the SEO dashboard. Values continue to be updated through MCP.':'Add a dedicated dashboard for stored Instagram content and performance. This does not connect a Meta account or turn on posting.','plugin-notice');
  const form=el('form',undefined,'plugin-dialog-form');const notice=el('p','', 'plugin-notice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  const enabled=el('input');enabled.type='checkbox';enabled.checked=true;const enabledLabel=el('label',undefined,'plugin-enabled');enabledLabel.append(enabled,document.createTextNode('Show this plugin in the project'));
  const fields=el('fieldset');fields.append(el('legend','Metrics in this dashboard'));
  if(key==='instagram')fields.append(el('p','Instagram shows only Followers, Posts since month start, Average likes per post, and Posts per week. Daily follower observations supply the history chart.','plugin-notice'));
  if(!eligibleMetrics.length)fields.append(el('p',`No ${pluginCatalog[key].name} metrics are linked to this project yet. You can add this dashboard now; its metrics stay empty until matching metrics are added through MCP.`,'plugin-notice'));
  const incompatible=excludedPluginMetricIds(config,metrics).length;
  if(incompatible)fields.append(el('p',`${incompatible} saved metric selection${incompatible===1?' is':'s are'} not supported by this dashboard and will not be shown. Saving removes those selections, not the underlying metrics or readings.`,'plugin-notice'));
  for(const metric of eligibleMetrics){const label=el('label');const check=el('input');check.type='checkbox';check.name='metric';check.value=metric.id;check.checked=chosen.has(metric.id);const text=el('span',`${metric.label} (${metric.unit})`);label.append(check,text);fields.append(label);}
  const help=el('p','Only compatible project metrics can be selected. SEO and Instagram metrics stay in their own dashboards. Client viewers still see only the metrics already shared with them. Hiding a plugin keeps its settings and all stored data.','plugin-notice');
  const actions=el('div',undefined,'plugin-actions');const save=el('button',config?.enabled?'Save settings':`Add ${pluginCatalog[key].name}`,'admin-button');save.type='submit';const cancel=button('Cancel',()=>modal.close());actions.append(save,cancel);form.append(enabledLabel,fields,help,notice,actions);modal.content.append(intro,form);modal.open();
  let busy=false;
  form.onsubmit=async event=>{
   event.preventDefault();if(busy||!alive||!current())return;busy=true;modal.setDismissible(false);
   form.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(node=>node.disabled=true);notice.textContent='Saving plugin settings…';
   const payload={key,enabled:enabled.checked,metricIds:[...fields.querySelectorAll<HTMLInputElement>('input:checked')].map(input=>input.value),expectedRevision:config?.revision??0,idempotencyKey:crypto.randomUUID()};
   try{await post(path,payload);if(!alive||!current())return;modal.setDismissible(true);modal.close();if(!selected&&payload.enabled)location.assign(pluginPagePath(target,key));else onChange();}
   catch(error){if(!alive||!current())return;modal.setDismissible(true);notice.textContent=`${message(error)} Refresh settings to check the saved version before making another change.`;actions.replaceChildren(button('Refresh settings',async()=>{if(busy)return;busy=true;notice.textContent='Checking the saved settings…';try{await load();if(alive&&current()){modal.close();onChange();}}catch(e){if(alive&&current()){notice.textContent=message(e);busy=false;}}}),button('Close',()=>modal.close()));busy=false;}
  };
 }
 function openPrompt(key:PluginKey,trigger:HTMLElement){
  const config=configuration(key);if(!current()||!config?.enabled||!projectDetails)return;
  dialog?.dispose();let stopCopy:(()=>void)|undefined;const modal=createModal({title:`Update ${pluginCatalog[key].name} metrics`,trigger,onClose:()=>stopCopy?.()});dialog=modal;
  const period=currentReportingPeriod(projectDetails.timezone);
  modal.content.append(el('p',period?`Current month: ${period.month} · ${period.timezone}. This prompt requests partial month-to-date readings, even if you are viewing a different reporting month.`:'The agent must verify the reporting timezone before choosing the current month.','plugin-notice'));
  modal.content.append(el('p','Includes client/project identifiers and metric configuration, but no credentials or metric values. Share it only with an agent you authorize. Copying does not connect an account or update any data.','plugin-notice'));
  const label=el('label','Prompt and secure MCP setup instructions','plugin-prompt-label');const area=el('textarea',undefined,'plugin-prompt');area.readOnly=true;area.rows=14;area.value=buildMonthlyMetricsPrompt(projectDetails,key,config,metrics);label.append(area);
  const notice=el('p','','plugin-notice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  const copy=button('Copy prompt',()=>{});stopCopy=bindPromptCopy(area,copy,notice,()=>current()&&modal.dialog.open);
  modal.content.append(label,copy,notice);modal.open();
 }
 function catalog(trigger:HTMLElement){
  if(!canManage)return;dialog?.dispose();const modal=createModal({title:'Add a project plugin',trigger});dialog=modal;
  modal.content.append(el('p','Give each part of this project its own dashboard. Adding a plugin does not connect an external account or change client access.','plugin-notice'));
  const grid=el('div',undefined,'plugin-grid');
  for(const key of ['seo','instagram'] as const){const item=pluginCatalog[key],card=el('article',undefined,'plugin-card');card.dataset.plugin=key;card.append(el('h3',item.name),el('p',item.description));const installed=configuration(key)?.enabled;const action=button(installed?'Configure':`Add ${item.name}`,()=>{modal.close();openSettings(key,trigger);});card.append(action);grid.append(card);}
  modal.content.append(grid);modal.open();
 }
 function render(projectMetrics:Metric[],projectStatus:string,details?:Target){
  if(!current())return;projectDetails=details;metrics=projectMetrics;canManage=admin&&projectStatus!=='archived';root.hidden=false;root.replaceChildren();
  const nav=el('nav',undefined,'plugin-nav');nav.setAttribute('aria-label','Project dashboards');
  for(const key of [null,...(['seo','instagram'] as const).filter(key=>configuration(key)?.enabled)] as (PluginKey|null)[]){const link=el('a',key?pluginCatalog[key].name:'Project home');link.href=pluginPagePath(target,key??undefined);if(key===selected)link.setAttribute('aria-current','page');nav.append(link);}root.append(nav);
  if(selected){
   const info=pluginCatalog[selected],head=el('div',undefined,'plugin-title'),copy=el('div');copy.append(el('h2',`${info.name} dashboard`),el('p',info.short));head.append(copy);root.append(head);
   if(configuration(selected)?.enabled&&projectDetails){const prompt=button('Copy current-month prompt',()=>openPrompt(selected,prompt));head.append(prompt);}
   if(canManage){const manage=button(configuration(selected)?.enabled?'Plugin settings':`Add ${info.name}`,()=>openSettings(selected,manage));head.append(manage);}
   const readiness=el('aside',undefined,'plugin-readiness');readiness.setAttribute('aria-label','Plugin readiness');
   if(!configuration(selected)?.enabled){readiness.append(el('strong','This plugin has not been added'),el('p',admin?'Add it to choose the project metrics for this dashboard.':'Ask your project administrator to add this plugin.'));}
   else if(selected==='seo'){readiness.append(el('strong','Stored metrics · Updated through MCP'),el('p','This dashboard shows reported values saved to this project. Adding SEO does not create a live connection to OpenSEO or another search provider.'));}
   else{readiness.append(el('strong','Stored content and metrics · Meta is not connected'),el('p','Reels and posts can be tracked here. Scheduling and publication records are stored data, not an automatic publishing service.'));}
   const mappingWarning=pluginMappingWarning(admin,configuration(selected),metrics);
   if(mappingWarning)readiness.append(el('p',mappingWarning,'plugin-notice'));
   root.append(readiness);
  }else{
   const heading=el('div',undefined,'plugin-section-heading');const title=el('div');title.append(el('h2','Choose a dashboard'),el('p','Open SEO or Instagram to view its own metrics and content. Reports are kept separate.'));heading.append(title);
   if(canManage){const add=button('Add plugin',()=>catalog(add));heading.append(add);}root.append(heading);
   const grid=el('div',undefined,'plugin-grid');
   for(const key of ['seo','instagram'] as const){const info=pluginCatalog[key],config=configuration(key);if(!admin&&!config?.enabled)continue;const card=el('article',undefined,'plugin-card');card.dataset.plugin=key;const title=el('h3');title.append(el('span',info.symbol,'plugin-icon'),document.createTextNode(info.name));card.append(title,el('p',info.description));
    const status=el('span',config?.enabled?'Added':'Not added','quiet-pill');card.append(status);const actions=el('div',undefined,'plugin-actions');
    if(config?.enabled){const link=el('a',`Open ${info.name} dashboard →`);link.href=pluginPagePath(target,key);actions.append(link);}
    if(canManage){const action=button(config?.enabled?'Settings':`Add ${info.name}`,()=>openSettings(key,action));actions.append(action);}card.append(actions);grid.append(card);
   }
   if(!grid.children.length)grid.append(el('p','Your team has not added any dashboards yet. Ask your project administrator to add SEO or Instagram.','plugin-notice'));root.append(grid);
  }
 }
 function clearContent(){contentSequence++;document.getElementById('instagram-content')!.replaceChildren();document.getElementById('instagram-content')!.hidden=true;}
 async function loadContent(){
  clearContent();if(selected!=='instagram'||!configuration('instagram')?.enabled||!current())return;const section=document.getElementById('instagram-content')!;section.hidden=false;
  const heading=el('div',undefined,'plugin-section-heading');heading.append(el('h2','Reels & posts'));section.append(heading);
  if(!admin){section.append(el('p','Your access covers shared performance metrics. Content planning and publishing records are managed by your team.','plugin-notice'));return;}
  const notice=el('p','Loading stored content…','plugin-notice');notice.setAttribute('role','status');section.append(notice);
  const scroll=el('div',undefined,'table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Stored Instagram content, horizontally scrollable');const table=el('table'),head=el('thead'),row=el('tr');for(const name of ['Content','Format','Status','Stored schedule / publication']){const cell=el('th',name);cell.scope='col';row.append(cell);}head.append(row);table.append(head);const body=el('tbody');table.append(body);scroll.append(table);scroll.hidden=true;section.append(scroll);
  const sequence=++contentSequence;let cursor:string|undefined,busy=false;
  const more=button('Load more content',()=>void fetchPage());more.hidden=true;section.append(more);
  async function fetchPage(){if(busy)return;busy=true;more.disabled=true;try{const result=await api<{items:StoredContent[];nextCursor:string|null}>(path+'/instagram/content'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(!current()||sequence!==contentSequence)return;
    for(const item of result.items){const row=el('tr');for(const text of [item.title,item.kind??'Not specified',item.status,item.publishedAt?`Published ${new Date(item.publishedAt).toLocaleString()}`:item.scheduledAt?`Scheduled ${new Date(item.scheduledAt).toLocaleString()}`:'Not scheduled'])row.append(el('td',text));body.append(row);}
    scroll.hidden=!body.children.length;notice.textContent=body.children.length?'Stored Instagram records linked to this project. A stored schedule does not publish a post.':'No Instagram content is linked to this project yet. Your team can add drafts and link them to project metrics through MCP. Nothing is posted automatically.';cursor=result.nextCursor??undefined;more.hidden=!cursor;more.textContent='Load more content';
   }catch(error){if(current()&&sequence===contentSequence){notice.textContent=message(error);more.hidden=false;more.textContent='Retry content';}}finally{busy=false;more.disabled=false;}}
  await fetchPage();
 }
 return {load,render,loadContent,clearContent,isEnabled:(key:PluginKey)=>!!configuration(key)?.enabled,dispose(){disposed=true;contentSequence++;dialog?.dispose();root.replaceChildren();root.hidden=true;clearContent();}};
}
