import test from 'node:test';
import assert from 'node:assert/strict';
import {pluginApiPath,pluginPagePath,readPluginKey,suggestedMetricIds} from '../src/scripts/plugin-state.ts';
test('plugin routes are exact, encoded and never treat a tenant URL as admin authority',()=>{
 const target={tenantId:'t space',clientId:'a&b',projectId:'p/q'};
 assert.equal(pluginApiPath(target,false),'/api/targets/a%26b/p%2Fq/plugins');
 assert.equal(pluginApiPath(target,true),'/api/admin/targets/t%20space/a%26b/p%2Fq/plugins');
 assert.equal(pluginPagePath(target,'seo'),'/project?tenant=t+space&client=a%26b&project=p%2Fq&plugin=seo');
 assert.equal(readPluginKey(''),null);assert.equal(readPluginKey('?plugin=seo'),'seo');assert.equal(readPluginKey('?plugin=instagram'),'instagram');
 for(const value of ['?plugin=','?plugin=other','?plugin=seo&plugin=instagram','?plugin=SEO'])assert.equal(readPluginKey(value),'invalid');
});
test('metric suggestions use explicit category prefixes, not labels or invented data',()=>{
 const metrics=[{id:'seo',key:'openseo.visibility'},{id:'ig',key:'instagram_reach'},{id:'organic',key:'ga4_organic_sessions'},{id:'ambiguous',key:'reach'}];
 assert.deepEqual(suggestedMetricIds('seo',metrics),['seo','organic']);assert.deepEqual(suggestedMetricIds('instagram',metrics),['ig']);
});

test('project home never renders a combined report and empty plugins hide comparison panels',async()=>{
 const {dashboardViewState}=await import('../src/scripts/plugin-state.ts');
 for(const enabled of [false,true])for(const count of [0,8])assert.deepEqual(dashboardViewState(true,null,enabled,count),{report:false,comparisons:false});
 assert.deepEqual(dashboardViewState(true,'instagram',true,0),{report:true,comparisons:false});
 assert.deepEqual(dashboardViewState(true,'seo',true,8),{report:true,comparisons:true});
 assert.deepEqual(dashboardViewState(true,'instagram',false,8),{report:false,comparisons:false});
 assert.deepEqual(dashboardViewState(false,null,true,8),{report:true,comparisons:true});
});
