import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';

test('built Worker + real Astro ASSETS preserve consent navigation and never route JSON/POST to HTML',async t=>{
 const mf=new Miniflare({workers:[{config:{
  name:'oauth-assets-test',compatibilityDate:'2026-11-10',compatibilityFlags:['nodejs_compat'],
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:await readFile('.cloudflare/output/v0/workers/default/bundle/index.js','utf8')}}},
  assets:{directory:resolve('.cloudflare/output/v0/workers/default/assets'),hasUserWorker:true,runWorkerFirst:true,notFoundHandling:'none',htmlHandling:'auto-trailing-slash'},
  env:{ASSETS:{type:'assets'},APP_ORIGIN:{type:'text',value:'https://content.unreelviews.com'}},
 } }]});
 t.after(()=>mf.dispose());
 const query='?client_id=test&state=opaque%2Bvalue%20with+spaces&redirect_uri=https%3A%2F%2Fclient.test%2Fcallback%3Fx%3D1';
 for(const path of ['/authorize','/authorize/']){
  const url='https://content.unreelviews.com'+path+query;
  const browser=await mf.dispatchFetch(url,{headers:{Accept:'text/html'},redirect:'manual'});
  assert.equal(browser.status,200,path);assert.equal(browser.headers.get('Location'),null);assert.equal(browser.redirected,false);
  // dispatchFetch returns an internal Response with an empty .url; a 200 with
  // no Location keeps the original browser URL/query, unlike the ASSETS301.
  assert.equal(browser.headers.get('Cache-Control'),'no-store');
  const html=await browser.text();assert.match(html,/id="consent-form"/);assert.ok(!html.includes('opaque%2Bvalue'));
  const json=await mf.dispatchFetch(url,{headers:{Accept:'application/json'},redirect:'manual'});
  assert.equal(json.status,503);assert.match(json.headers.get('Content-Type')!,/application\/json/);assert.equal(json.headers.get('Location'),null);
  const post=await mf.dispatchFetch(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Origin:'https://content.unreelviews.com'},body:'{}',redirect:'manual'});
  assert.equal(post.status,503);assert.match(post.headers.get('Content-Type')!,/application\/json/);assert.equal(post.headers.get('Location'),null);
 }
});
