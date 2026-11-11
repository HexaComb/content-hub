import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';

// Unlike synthetic browser fixtures, this exercises the actual production HTML,
// script assets and security headers. Do not replace its scripts with test bundles.
test('production workspace navigation is external, served, and allowed by the Worker CSP', async t => {
 const origin = 'https://content.unreelviews.com';
 const mf = new Miniflare({workers:[{config:{
  name:'navigation-assets-test',compatibilityDate:'2026-11-10',compatibilityFlags:['nodejs_compat'],
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:await readFile('.cloudflare/output/v0/workers/default/bundle/index.js','utf8')}}},
  assets:{directory:resolve('.cloudflare/output/v0/workers/default/assets'),hasUserWorker:true,runWorkerFirst:true,notFoundHandling:'none',htmlHandling:'auto-trailing-slash'},
  env:{ASSETS:{type:'assets'},APP_ORIGIN:{type:'text',value:origin}},
 }}]});
 t.after(() => mf.dispose());
 for (const path of ['/', '/admin/', '/project/']) {
  const response = await mf.dispatchFetch(origin + path, {headers:{Accept:'text/html'}});
  assert.equal(response.status, 200, path);
  const csp = response.headers.get('Content-Security-Policy') ?? '';
  const scriptDirective = csp.split(';').find(directive => directive.trim().startsWith('script-src ')) ?? '';
  assert.ok(scriptDirective.includes("'self'"), path + ': same-origin scripts permitted');
  assert.ok(!scriptDirective.includes("'unsafe-inline'"), path + ': inline script protection retained');
  const html = await response.text();
  assert.match(html, /id="toggle-navigation"/, path);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  let hasNavigation = false;
  for (const [, attributes, body] of scripts) {
   const src = attributes.match(/\bsrc="([^"]+)"/)?.[1];
   // The navigation controller must never become CSP-blocked inline JS again.
   assert.ok(!body.includes('toggle-navigation'), path + ': navigation must be external');
   if (!src) {
    assert.ok(!/\btype="module"/.test(attributes) || !body.trim(), path + ': processed modules must be external');
    continue;
   }
   const url = new URL(src, origin);
   if (url.origin !== origin) continue;
   const asset = await mf.dispatchFetch(url.href);
   assert.equal(asset.status, 200, src);
   assert.match(asset.headers.get('Content-Type') ?? '', /javascript/, src);
   const code = await asset.text();
   if (code.includes('toggle-navigation')) hasNavigation = true;
  }
  assert.ok(hasNavigation, path + ': actual external navigation controller is served');
 }
});
