import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {readPluginKey,pluginCatalog,dashboardViewState} from '../src/scripts/plugin-state.ts';
import {readProjectRoute,projectReportPath,previousCompletedMonth} from '../src/scripts/project-state.ts';

const source=stripTypeScriptTypes(readFileSync(new URL('../src/scripts/dashboard.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^void boot\(\);$/m,'');
async function run(plugin:string|null,enabled=true,fail=false){
 const nodes=new Map<string,any>();
 function element(){return {hidden:false,value:'0',textContent:'',children:[] as unknown[],attributes:new Map(),replaceChildren(...children:unknown[]){this.children=children;},append(...children:unknown[]){this.children.push(...children);},closest(){return this;},setAttribute(k:string,v:string){this.attributes.set(k,v);},removeAttribute(k:string){this.attributes.delete(k);},querySelectorAll(){return [];},addEventListener(){}};}
 const document={title:'',querySelector(selector:string){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},createElement:element,createTextNode:(text:string)=>text};
 const target={tenantId:'t',clientId:'c',projectId:'p',name:'Project',clientName:'Client',status:'active'};
 const all={target,month:'2026-10',previousMonth:'2026-09',metrics:[{id:'seo',key:'gsc_clicks'},{id:'ig',key:'instagram_reach'}]};
 const rendered:any[]=[];const requests:string[]=[];
 const mockPlugins={load:async()=>{},render(){},isEnabled:()=>enabled,clearContent(){},loadContent(){}};
 const context:any={document,location:{pathname:'/project/',search:'?tenant=t&client=c&project=p'+(plugin?'&plugin='+plugin:'')},window:{addEventListener(){}},AbortController,DOMException,URLSearchParams,Date,readPluginKey,pluginCatalog,dashboardViewState,readProjectRoute,projectReportPath,previousCompletedMonth,clearProjectTheme(){},renderReport:(report:unknown)=>rendered.push(report),message:()=> 'Failed',ApiError:class extends Error{},api:async(path:string)=>{requests.push(path);if(path.includes('&plugin=')){if(fail)throw Error();return {...all,metrics:plugin==='seo'?[all.metrics[0]]:[]};}return all;},mockPlugins,target};
 runInNewContext(source+'\nglobalThis.run=async()=>{verifiedAdmin=true;targets=[target];projectPlugins=mockPlugins;await loadReport();};',context);
 await context.run();return {rendered,requests,nodes};
}
test('actual dashboard controller renders only scoped plugin response, never landing aggregate',async()=>{
 const home=await run(null);assert.equal(home.rendered.length,0);assert.equal(home.nodes.get('#dashboard').hidden,true);
 const seo=await run('seo');assert.deepEqual(seo.rendered.map(r=>r.metrics.map((m:any)=>m.id)),[['seo']]);assert.equal(seo.nodes.get('#dashboard').hidden,false);
 const instagram=await run('instagram');assert.deepEqual(instagram.rendered.map(r=>r.metrics),[[]]);assert.equal(instagram.nodes.get('.admin-heading h1').textContent,'Instagram dashboard');
 assert.ok(instagram.nodes.get('#metrics').children[0].textContent.includes('No Instagram metrics'));
});
test('disabled plugins and failed scoped requests never fall back to aggregate values',async()=>{
 const disabled=await run('instagram',false);assert.equal(disabled.rendered.length,0);assert.equal(disabled.nodes.get('#dashboard').hidden,true);
 const failed=await run('instagram',true,true);assert.equal(failed.rendered.length,0);assert.equal(failed.nodes.get('#dashboard').hidden,true);
});
