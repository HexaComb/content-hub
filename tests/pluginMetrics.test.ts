import test from 'node:test';
import assert from 'node:assert/strict';
import {knownMetricPlugin,metricAllowedForPlugin} from '../src/pluginMetrics.ts';

test('only explicit metric key namespaces determine plugin compatibility',()=>{
 for(const prefix of ['seo','openseo','search_console','google_search_console','gsc'])for(const separator of ['_', '.', ':', '-']){
  const key=prefix+separator+'clicks';
  assert.equal(knownMetricPlugin(key),'seo');
  assert.equal(metricAllowedForPlugin('instagram',{key}),false);
 }
 for(const separator of ['_', '.', ':', '-']){
  for(const key of ['ga4'+separator+'organic','ga4'+separator+'organic_sessions','INSTAGRAM'+separator+'views','ig'+separator+'reels']){
   const expected=key.startsWith('ga4')?'seo':'instagram';
   assert.equal(knownMetricPlugin(key),expected);
   assert.equal(metricAllowedForPlugin(expected,{key}),true);
  }
 }
 for(const key of ['views','custom.revenue','ga4.total_sessions','ga4_organically','seoul_visits','igloo_count','my_seo_clicks','instagramFollowers','']){
  assert.equal(knownMetricPlugin(key),null);
  assert.equal(metricAllowedForPlugin('seo',{key}),true);
  assert.equal(metricAllowedForPlugin('instagram',{key}),true);
 }
});
