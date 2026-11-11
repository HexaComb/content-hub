import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as view from '../src/scripts/instagram-view-state.ts';
import * as copy from '../src/scripts/metric-copy.ts';
const range={key:'7d' as const,start:'2026-11-01',end:'2026-11-08'};
test('exclusive windows show seven days and never bridge absent or null dates',()=>{
 const plot=view.followerPlot([{date:'2026-11-01',value:0},{date:'2026-11-03',value:4},{date:'2026-11-04',value:5},{date:'2026-11-05',value:null},{date:'2026-11-06',value:5}],range);
 assert.equal(plot.days,7);assert.equal(plot.observed,4);assert.deepEqual(plot.segments.map(s=>s.length),[1,2,1]);assert.equal(plot.daily[1].value,null);assert.equal(plot.daily[0].value,0);assert.equal(view.lastIncludedDate(range.end),'2026-11-07');assert.ok(plot.high>plot.low);
});
test('flat, zero and absent observations have honest nonzero plotting domains',()=>{
 for(const value of [0,99,null]){const plot=view.followerPlot([{date:range.start,value}],range);assert.ok(plot.high>plot.low);assert.equal(plot.observed,value===null?0:1);assert.equal(view.metricValue(value),value===null?'Not available':String(value));}
});
test('source quality and timestamp survive daily alignment; unsafe content URLs are inert',()=>{
 const plot=view.followerPlot([{date:range.start,value:2,quality:'partial',asOf:'2026-11-01T12:00:00Z'}],range);assert.equal(plot.daily[0].quality,'partial');assert.equal(plot.daily[0].asOf,'2026-11-01T12:00:00Z');assert.equal(plot.daily[1].quality,'missing');
 for(const url of ['javascript:alert(1)','data:text/html,test','http://example.com','https://user:pass@example.com','/relative'])assert.equal(view.safeContentUrl(url),null);assert.equal(view.safeContentUrl('https://instagram.com/p/123'),'https://instagram.com/p/123');
});
class Node {tag:string;children:Node[]=[];textContent='';className='';hidden=false;disabled=false;dataset:Record<string,string>={};attributes=new Map<string,string>();onclick?:()=>void;classList={add:()=>{}};constructor(tag:string){this.tag=tag;}append(...children:Node[]){this.children.push(...children);}replaceChildren(...children:Node[]){this.children=children;}setAttribute(k:string,v:string){this.attributes.set(k,v);}removeAttribute(k:string){this.attributes.delete(k);}querySelectorAll(tag:string):Node[]{return this.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...c.querySelectorAll(tag)]);} }
const source=stripTypeScriptTypes(readFileSync(new URL('../src/scripts/instagram-dashboard.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
const kpiSource=stripTypeScriptTypes(readFileSync(new URL('../src/scripts/instagram-kpi-reading.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
function harness(admin=true){
 const root=new Node('section'),requests:string[]=[],resolvers:((v:any)=>void)[]=[],posts:{path:string;body:any;resolve:()=>void;reject:()=>void}[]=[],modals:any[]=[];let active=true;
 const context:any={...view,...copy,document:{createElement:(tag:string)=>new Node(tag),createElementNS:(_:string,tag:string)=>new Node(tag)},AbortController,Intl,crypto,api:(path:string)=>{requests.push(path);return new Promise(resolve=>resolvers.push(resolve));},message:()=> 'Failed',post:(path:string,body:any)=>new Promise<void>((resolve,reject)=>posts.push({path,body,resolve,reject:()=>reject(Error('Interrupted'))})),createModal:(options:any)=>{const modal={content:new Node('div'),open(){},close(){options.onClose?.();},dispose(){options.onClose?.();},setDismissible(){}};modals.push(modal);return modal;}};
 runInNewContext('const appendInstagramKpi=(()=>{'+kpiSource+';return appendInstagramKpi;})();\n'+source+'\nglobalThis.mount=mountInstagramDashboard;',context);
 const mount=context.mount({root,apiPrefix:'/api/targets/c/p/plugins',month:'2026-11',admin,isCurrent:()=>active});return {root,mount,requests,resolvers,posts,modals,deactivate:()=>{active=false;}};
}
const data={month:'2026-11',asOfDate:'2026-11-07',timezone:'UTC',kpis:[],followers:{ranges:[range],points:[]},pending:[],ideas:[],executed:[],answers:[],workflowAvailable:true};
const text=(node:Node):string=>[node.textContent,...node.children.map(text)].join(' ');
test('actual renderer has exactly four compact KPI cards and truthful empty workflow states',async()=>{
 const h=harness();const promise=h.mount.load();h.resolvers[0](data);await promise;const all=text(h.root);assert.equal(h.root.querySelectorAll('article').filter(n=>n.className==='ig-kpi').length,4);for(const title of ['Pending reels & posts','Upcoming content ideas','Executed content ideas','Answer history'])assert.ok(all.includes(title));assert.ok(all.includes('No daily follower observations'));assert.ok(!all.includes('undefined'));assert.equal(h.root.hidden,false);
});
test('recipient never renders workflow content even if a response wrongly includes it',async()=>{
 const h=harness(false);const promise=h.mount.load();h.resolvers[0]({...data,ideas:[{title:'PRIVATE IDEA'}]});await promise;assert.ok(!text(h.root).includes('PRIVATE IDEA'));assert.ok(text(h.root).includes('shared metrics only'));
});
test('superseded and disposed requests cannot restore stale project data',async()=>{
 const h=harness();const first=h.mount.load();const second=h.mount.updateMonth('2026-10');h.resolvers[1]({...data,month:'2026-10'});await second;h.resolvers[0](data);await first;assert.ok(text(h.root).includes('October 2026'));assert.ok(!text(h.root).includes('November 2026'));
 const third=h.mount.load();h.mount.dispose();h.resolvers[2](data);await third;assert.equal(h.root.hidden,true);assert.equal(h.root.children.length,0);
});

test('confirmed Yes sends one revisioned idempotent decision and uncertain outcomes require a read',async()=>{
 const h=harness();const loading=h.mount.load();h.resolvers[0]({...data,ideas:[{id:'idea-1',title:'Test idea',idea:'Description',platform:'instagram',format:'reel',revision:3,status:'proposed',contentUrl:null}]});await loading;
 h.root.querySelectorAll('button').find(n=>n.textContent==='Yes')!.onclick!();const modal=h.modals[0];const confirm=modal.content.querySelectorAll('button').find((n:Node)=>n.textContent==='Yes, queue creation');const saving=confirm.onclick();confirm.onclick();assert.equal(h.posts.length,1);assert.ok(h.posts[0].path.endsWith('/ideas/idea-1/decision'));assert.equal(h.posts[0].body.answer,'yes');assert.equal(h.posts[0].body.expectedRevision,3);assert.ok(h.posts[0].body.idempotencyKey);
 h.posts[0].reject();await saving;assert.equal(h.posts.length,1);modal.close();assert.equal(h.root.querySelectorAll('button').find(n=>n.textContent==='Yes')!.disabled,true);assert.ok(text(h.root).includes('could not be confirmed'));h.root.querySelectorAll('button').find(n=>n.textContent==='Yes')!.onclick!();assert.equal(h.posts.length,1);assert.equal(h.modals.length,1);
});
