import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {agentWorkflows,buildSkillsSetupPrompt} from '../src/scripts/skills-catalog.ts';
import {sessionChangeGuard} from '../src/scripts/access-state.ts';

const source=stripTypeScriptTypes(readFileSync(new URL('../src/scripts/skills.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
class Element {
 value='';textContent='';hidden=false;disabled=false;open=false;focused=0;scrolled=0;onclick:(()=>void)|null=null;
 dataset:Record<string,string>={};listeners:Record<string,((event:any)=>void)[]>={};
 addEventListener(type:string,listener:(event:any)=>void){(this.listeners[type]??=[]).push(listener);}
 click(){for(const callback of this.listeners.click??[])callback({});this.onclick?.();}
 focus(){this.focused++;} scrollIntoView(){this.scrolled++;}
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(options:{clerk?:any;api?:(path:string)=>Promise<any>}={}){
 const nodes=Object.fromEntries(['skills-setup-prompt','copy-skills-setup','skills-prompt-panel','skills-prompt-label','skills-copy-status','reset-skills-prompt','identity','admin-link','logout'].map(id=>[id,new Element()]));
 nodes['skills-setup-prompt'].value=buildSkillsSetupPrompt();
 const cards=agentWorkflows.map(workflow=>{const node=new Element();node.dataset.workflow=workflow.id;return node;});
 const events:Record<string,(event:any)=>void>={};const requests:string[]=[];let disposed=false,copyCount=0;
 const context={document:{getElementById:(id:string)=>nodes[id],querySelectorAll:()=>cards},window:{addEventListener:(type:string,callback:(event:any)=>void)=>{events[type]=callback;}},location:{replace:()=>{},reload:()=>{}},agentWorkflows,buildSkillsSetupPrompt,sessionChangeGuard,
  getClerk:()=>options.clerk?Promise.resolve(options.clerk):Promise.reject(new Error('Authentication unavailable')),
  api:(path:string)=>{requests.push(path);return options.api?.(path)??Promise.resolve({authenticated:false});},
  bindPromptCopy:(_area:Element,button:Element,_notice:Element,current:()=>boolean)=>{button.onclick=()=>{if(current())copyCount++;};return()=>{disposed=true;button.onclick=null;};}};
 runInNewContext(source,context);
 return {nodes,cards,events,requests,copies:()=>copyCount,disposed:()=>disposed};
}

test('a chosen skill produces a reviewable focused prompt and reset restores all workflows without account access',async()=>{
 const h=harness();await tick();
 h.cards.find(card=>card.dataset.workflow==='update-seo')!.click();
 assert.equal(h.nodes['skills-setup-prompt'].value,buildSkillsSetupPrompt(['update-seo']));
 assert.equal(h.nodes['copy-skills-setup'].textContent,'Copy selected skill setup');
 assert.equal(h.nodes['skills-prompt-panel'].open,true);
 assert.equal(h.nodes['skills-setup-prompt'].focused,1);
 assert.match(h.nodes['skills-copy-status'].textContent,/Review the prompt/);
 h.nodes['reset-skills-prompt'].click();
 assert.equal(h.nodes['skills-setup-prompt'].value,buildSkillsSetupPrompt());
 assert.equal(h.nodes['copy-skills-setup'].textContent,'Copy setup prompt');
 h.nodes['copy-skills-setup'].click();assert.equal(h.copies(),1);
 assert.deepEqual(h.requests,[]);
});

test('copy in flight prevents prompt replacement and page exit disposes copy behavior',()=>{
 const h=harness();h.nodes['copy-skills-setup'].disabled=true;
 h.cards[0].click();assert.equal(h.nodes['skills-setup-prompt'].value,buildSkillsSetupPrompt());
 h.nodes['copy-skills-setup'].disabled=false;h.events.pagehide({});
 assert.equal(h.disposed(),true);
 h.cards[0].click();assert.equal(h.nodes['skills-setup-prompt'].value,buildSkillsSetupPrompt());
 h.nodes['copy-skills-setup'].click();assert.equal(h.copies(),0);
});

test('a late account response cannot reveal the prior identity or administrator link after sign-out',async()=>{
 let listener!:(value:any)=>void,finish!:(value:any)=>void;
 const clerk:any={session:{id:'old-session'},addListener:(value:any)=>{listener=value;return()=>{};}};
 const h=harness({clerk,api:()=>new Promise(resolve=>{finish=resolve;})});
 await tick();assert.deepEqual(h.requests,['/api/session']);
 clerk.session=null;listener({session:null});await tick();
 finish({authenticated:true,email:'old@example.test'});await tick();
 assert.equal(h.nodes.identity.textContent,'Agent guides');
 assert.equal(h.nodes['admin-link'].hidden,true);assert.equal(h.nodes.logout.hidden,true);
 assert.deepEqual(h.requests,['/api/session']);
});

test('administrator navigation appears only after both verified account and administrator reads',async()=>{
 const clerk:any={session:{id:'current'},addListener:()=>()=>{}};
 const h=harness({clerk,api:async path=>path==='/api/session'?{authenticated:true,email:'operator@example.test'}:{authenticated:true,role:'super_admin'}});
 await tick();assert.deepEqual(h.requests,['/api/session','/api/admin/session']);
 assert.equal(h.nodes.identity.textContent,'operator@example.test');assert.equal(h.nodes['admin-link'].hidden,false);
 const recipient=harness({clerk,api:async path=>path==='/api/session'?{authenticated:true}:{authenticated:false}});
 await tick();assert.equal(recipient.nodes['admin-link'].hidden,true);
});
