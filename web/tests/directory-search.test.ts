import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
// Exercise the actual directory controller; API/auth remain synthetic.
const source=stripTypeScriptTypes(readFileSync('web/src/scripts/admin.ts','utf8'))
 .replace(/^import .*;\n/gm,'').replace(/void boot\(\);\s*$/,'');
function harness(){
 const rows=[{textContent:'Search report Studio North active',hidden:false},{textContent:'Social report Acme paused',hidden:false}];
 const nodes=new Map<string,any>();
 const node=(id:string)=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,listeners:new Map(),addEventListener(type:string,fn:any){this.listeners.set(type,fn);},querySelectorAll(){return rows;},replaceChildren(){rows.length=0;}});return nodes.get(id);};
 const context:any={document:{getElementById:node},window:{addEventListener(){}},location:{},getClerk(){throw Error('No live authentication');}};
 runInNewContext(source+'\nthis.filter=filterProjects;this.clear=clear;',context);
 return {rows,node,context};
}
test('directory search is case-insensitive, reports loaded matches and includes newly appended entries',()=>{
 const h=harness();h.node('project-search').value='  STUDIO  ';h.context.filter();
 assert.deepEqual(h.rows.map(r=>r.hidden),[false,true]);assert.equal(h.node('search-summary').textContent,'1 of 2 loaded entries match');
 h.rows.push({textContent:'New project Studio South completed',hidden:false});h.context.filter();
 assert.equal(h.node('search-summary').textContent,'2 of 3 loaded entries match');
 h.node('project-search').value='unknown';h.context.filter();assert.equal(h.node('search-empty').hidden,false);
 h.node('project-search').value='';h.context.filter();assert.ok(h.rows.every(r=>!r.hidden));assert.equal(h.node('search-empty').hidden,true);
});
test('clearing the directory on refresh or session change removes search state and prior rows',()=>{
 const h=harness();h.node('project-search').value='Acme';h.context.filter();h.context.clear();
 assert.equal(h.node('project-search').value,'');assert.equal(h.node('search-summary').textContent,'');assert.equal(h.node('search-empty').hidden,true);assert.equal(h.rows.length,0);assert.equal(h.node('admin-workspace').hidden,true);
});
