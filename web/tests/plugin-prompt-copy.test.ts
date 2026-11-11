import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/scripts/project-plugins.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
function harness(){
 const timers=new Map<number,()=>void>();let next=0,active=true,calls=0,focused=0,selected=0;let resolve!:()=>void,reject!:(e:Error)=>void;
 const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
 const context:any={setTimeout:(callback:()=>void)=>{timers.set(++next,callback);return next;},clearTimeout:(id:number)=>timers.delete(id)};
 runInNewContext(source+'\nglobalThis.bind=bindPromptCopy;',context);
 const area={value:'Actual prompt',focus(){focused++;},select(){selected++;}},copy={disabled:false,onclick:null as null|(()=>void)},notice={textContent:''};
 const dispose=context.bind(area,copy,notice,()=>active,(value:string)=>{assert.equal(value,'Actual prompt');calls++;return promise;});
 return {copy,notice,timers,dispose,resolve,reject,click:()=>copy.onclick?.(),timeout:()=>{for(const callback of [...timers.values()])callback();},inactive:()=>{active=false;},counts:()=>({calls,focused,selected})};
}
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
test('copy immediately announces progress, blocks duplicates, and confirms only resolved writes',async()=>{
 const h=harness();h.click();h.click();assert.equal(h.notice.textContent,'Copying prompt…');assert.equal(h.copy.disabled,true);assert.equal(h.counts().calls,1);h.resolve();await tick();assert.match(h.notice.textContent,/Prompt copied/);assert.equal(h.copy.disabled,false);assert.equal(h.timers.size,0);assert.equal(h.counts().selected,0);
});
test('rejected clipboard writes select prompt for manual copy and clear timer',async()=>{
 const h=harness();h.click();h.reject(Error('Denied'));await tick();assert.match(h.notice.textContent,/copy it manually/);assert.equal(h.counts().selected,1);assert.equal(h.counts().focused,1);assert.equal(h.copy.disabled,false);assert.equal(h.timers.size,0);
});
test('pending clipboard writes time out, and late completion cannot falsely replace feedback',async()=>{
 const h=harness();h.click();h.timeout();const feedback=h.notice.textContent;assert.match(feedback,/Could not confirm/);assert.equal(h.counts().selected,1);assert.equal(h.copy.disabled,false);assert.equal(h.timers.size,0);h.resolve();await tick();assert.equal(h.notice.textContent,feedback);
});
test('modal close cleans timer and ignores late clipboard outcome without focus theft',async()=>{
 const h=harness();h.click();const feedback=h.notice.textContent;h.dispose();assert.equal(h.timers.size,0);assert.equal(h.copy.onclick,null);h.resolve();await tick();assert.equal(h.notice.textContent,feedback);assert.equal(h.counts().selected,0);
});
test('navigation invalidation suppresses timeout feedback and selection',()=>{
 const h=harness();h.click();h.inactive();h.timeout();assert.equal(h.notice.textContent,'Copying prompt…');assert.equal(h.counts().selected,0);assert.equal(h.timers.size,0);
});
