import test from 'node:test';
import assert from 'node:assert/strict';
import {pluginApiPath,pluginPagePath,readPluginKey,suggestedMetricIds,excludedPluginMetricIds,pluginMappingWarning} from '../src/scripts/plugin-state.ts';
test('plugin routes are exact, encoded and never treat a tenant URL as admin authority',()=>{
 const target={tenantId:'t space',clientId:'a&b',projectId:'p/q'};
 assert.equal(pluginApiPath(target,false),'/api/targets/a%26b/p%2Fq/plugins');
 assert.equal(pluginApiPath(target,true),'/api/admin/targets/t%20space/a%26b/p%2Fq/plugins');
 assert.equal(pluginPagePath(target,'seo'),'/project?tenant=t+space&client=a%26b&project=p%2Fq&plugin=seo');
 assert.equal(readPluginKey(''),null);assert.equal(readPluginKey('?plugin=seo'),'seo');assert.equal(readPluginKey('?plugin=instagram'),'instagram');
 for(const value of ['?plugin=','?plugin=other','?plugin=seo&plugin=instagram','?plugin=SEO'])assert.equal(readPluginKey(value),'invalid');
});
test('metric suggestions use explicit category prefixes, not labels or invented data',()=>{
 const metrics=[{id:'seo',key:'openseo.visibility'},{id:'ig',key:'instagram_followers'},{id:'organic',key:'ga4_organic_sessions'},{id:'ambiguous',key:'reach'}];
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

test('legacy selection warnings survive effective management projections and older responses',()=>{
 const metrics=[{id:'followers',key:'instagram_followers'},{id:'search',key:'seo.clicks'},{id:'custom',key:'custom.metric'}];
 const config={key:'instagram' as const,enabled:true,revision:2,metricIds:['followers'],incompatibleMetricIds:['search'],unavailableMetricIds:['gone'],unsupportedMetricIds:['custom']};
 assert.deepEqual(excludedPluginMetricIds(config,metrics),['search','gone','custom']);
 assert.deepEqual(excludedPluginMetricIds({...config,metricIds:['followers','search','custom','gone']},metrics),['search','gone','custom']);
 assert.deepEqual(excludedPluginMetricIds({key:'instagram',enabled:true,revision:1,metricIds:['search','custom','gone']},metrics),['search','custom','gone']);
 assert.deepEqual(excludedPluginMetricIds(undefined,metrics),[]);
 assert.deepEqual(excludedPluginMetricIds({...config,metricIds:[],incompatibleMetricIds:[],unavailableMetricIds:[],unsupportedMetricIds:[]},metrics),[]);
});

test('Instagram posts-per-week avg alias is suggested for the dashboard',()=>{
 assert.deepEqual(suggestedMetricIds('instagram',[{id:'weekly',key:'instagram_posts_per_week_avg'}]),['weekly']);
});

test('dashboard mapping warning is admin-only and absent for valid selections',()=>{
 const config={key:'instagram' as const,enabled:true,revision:1,metricIds:[],incompatibleMetricIds:['search']};
 assert.equal(pluginMappingWarning(true,config,[]),'1 saved metric selection cannot be used by this dashboard. Review Plugin settings. Existing metric data is unchanged.');
 assert.equal(pluginMappingWarning(false,config,[]),null);
 assert.equal(pluginMappingWarning(true,{...config,incompatibleMetricIds:[]},[]),null);
});
