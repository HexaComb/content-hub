// Synthetic-only local rendering. No sign-in, real report or remote asset is used.
// Run after build: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node web/tests/theme-browser-qa.mjs
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {themePresets} from '../../src/themeSchema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=resolve('web/tests/artifacts/themes'),fixture=resolve('web/tests/.theme-qa');await mkdir(output,{recursive:true});
await build({configFile:false,build:{lib:{entry:resolve('web/tests/theme-fixture.ts'),formats:['es'],fileName:()=> 'fixture.js'},outDir:fixture,emptyOutDir:true}});
const root=resolve('web/dist');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=path==='/qa.js'?resolve(fixture,'fixture.js'):resolve(root,`.${path.endsWith('/')?path+'index.html':extname(path)?path:path+'/index.html'}`);if(!file.startsWith(root+'/')&&!file.startsWith(fixture+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
const metric=(id,label,current,previous)=>({id,key:id,label,unit:'count',direction:'higher',current:{value:current,quality:'complete',collectedAt:'2026-11-01'},previous:{value:previous,quality:'complete',collectedAt:'2026-10-01'},delta:current-previous,relativePercent:(current-previous)/previous*100,percentagePoints:null,change:current>=previous?'improved':'declined',reason:null});
const report={target:{clientId:'synthetic',projectId:'demo',name:'Harbor Street Kitchen',kind:'instagram_account',platformAccountRef:'@synthetic.example',status:'active'},month:'2026-10',previousMonth:'2026-09',metrics:[metric('followers','Followers',35497,35183),metric('posts','Posts published',12,8),metric('likes','Average likes per post',314,269),{...metric('reach','Accounts reached',18420,16300),current:{value:18420,quality:'partial'},delta:null,relativePercent:null,change:'neutral',reason:'incomplete'}]};
try{
 await page.route('**/api/auth/config',route=>route.fulfill({status:503,json:{error:'Authentication unavailable'}}));
 for(const route of ['/','/project?client=synthetic&project=demo']){
  await page.goto(base+route);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('unavailable'));
  await page.evaluate(async()=>{window.qa=await import('/qa.js');});
  for(const [key,preset] of Object.entries(themePresets))for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:1100});
   const theme={...preset,brand:{...preset.brand,eyebrow:'SYNTHETIC DESIGN PREVIEW'}};
   await page.evaluate(({report,theme})=>{
    document.querySelector('#status').hidden=true;document.querySelector('#welcome').hidden=true;
    for(const id of ['dashboard','report','admin-workspace']){const root=document.getElementById(id);if(root)root.hidden=false;}
    const selector=document.querySelector('#target');if(selector)selector.replaceChildren(new Option(report.target.name,'0'));
    document.querySelector('#target-name').textContent=report.target.name;document.querySelector('#target-detail').textContent=report.target.platformAccountRef;
    document.querySelector('#month').value=report.month;
    window.qa.renderReport({...report,appearance:{revision:1,theme,updatedAt:null}});
   },{report,theme});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${route} ${key} ${width} overflow`);
   assert.equal(await page.locator('.metric-card').count(),4);
   assert.equal(await page.locator('#metric-rows tr').count(),4);
   assert.ok(await page.locator('.quality-warning').isVisible());
   assert.match(await page.locator('#metric-rows').innerText(),/Partial/);
   assert.equal(await page.locator('[data-project-theme]').count(),1);
   if(width!==320)await page.screenshot({path:output+`/${route==='/'?'client':'admin'}-${key}-${width}.png`,fullPage:true});
  }
  // Switching target clears every token and logo before another request finishes.
  await page.evaluate(()=>window.qa.clearProjectTheme(document.querySelector('#dashboard')??document.querySelector('#report')));
  assert.equal(await page.locator('[data-project-theme]').count(),0);
  assert.equal(await page.locator('#theme-tagline').isVisible(),false);
  await page.evaluate(report=>window.qa.renderReport(report),report);
  assert.equal(await page.locator('[data-project-theme]').count(),0);
  // Markup in brand copy is text. Invalid designs safely fall back to standard.
  const hostile={...themePresets.night,brand:{...themePresets.night.brand,tagline:'<img src=x onerror="window.pwned=true">'}};
  await page.evaluate(({report,theme})=>window.qa.renderReport({...report,appearance:{revision:2,theme}}),{report,theme:hostile});
  assert.equal(await page.locator('#theme-tagline img').count(),0);assert.equal(await page.evaluate(()=>window.pwned),undefined);
  await page.evaluate(({report,theme})=>window.qa.renderReport({...report,appearance:{revision:3,theme:{...theme,css:'body{display:none}'}}}),{report,theme:hostile});
  assert.equal(await page.locator('[data-project-theme]').count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: 30 client/project × palette × width variants, complete report content, partial warning, reset/switch isolation, hostile text, invalid-theme fallback, no page errors. Synthetic rendering only; live sign-in not tested.');
}finally{await browser.close();server.close();}
