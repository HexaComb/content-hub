// Run after build:web. Uses synthetic API responses and a test-only Clerk adapter.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH may point to an existing browser installation.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {rolldown} from 'rolldown';
import {themePresets} from '../../src/themeSchema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'../dist');
const output=resolve(process.env.QA_OUTPUT||'/tmp/content-hub-admin-qa');
await mkdir(output,{recursive:true});
const build=await rolldown({input:resolve(import.meta.dirname,'../src/scripts/admin.ts'),plugins:[{
 name:'test-auth-adapter',
 resolveId(source){if(source==='./auth')return '\0test-auth';},
 load(id){if(id==='\0test-auth')return `export class AuthUnavailable extends Error {};
 const clerk={session:{id:'synthetic-session',getToken:async()=>null},addListener:()=>()=>{},signOut:async()=>{}};
 export async function getClerk(){return clerk;}
 export async function mountSignIn(){return ()=>{};}`;},
}]});
const {output:bundles}=await build.generate({format:'es'});await build.close();
const script=bundles.find(item=>item.type==='chunk').code;
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/qa-admin.js'){res.setHeader('Content-Type','application/javascript');res.end(script);return;}
 const file=resolve(root,`.${path.endsWith('/')?path+'index.html':extname(path)?path:path+'/index.html'}`);
 if(!file.startsWith(root+'/'))throw Error();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');
 let body=await readFile(file);
 if(path==='/admin/')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>','<script type="module" src="/qa-admin.js"></script></body>');
 res.end(body);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const names=['Studio North / Instagram','Autumn editorial','Product launch','Brand strategy'];
const entries=names.map((name,i)=>({tenantId:'demo',workspaceName:'Studio workspace',clientId:`client-${i}`,clientName:['Studio North','Forma Collective','Orbit Goods','Forma Collective'][i],timezone:'UTC',project:{tenantId:'demo',clientId:`client-${i}`,projectId:`project-${i}`,name,kind:i===0?'instagram_account':'one_off_project',platformAccountRef:null,status:['active','active','paused','completed'][i]}}));
let state='populated',reportMonth='',appearance;
const overview={session:{email:'admin@example.test',role:'super_admin'},counts:{clients:3,projects:4,workspaces:1},entries:entries.slice(0,3),nextOffset:3};
try{
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/session')return route.fulfill({json:{authenticated:true}});
  if(url.pathname==='/api/admin/overview'){
   if(state==='denied')return route.fulfill({status:403,json:{}});
   if(state==='empty')return route.fulfill({json:{...overview,counts:{clients:0,projects:0,workspaces:0},entries:[],nextOffset:null}});
   return route.fulfill({json:url.searchParams.get('offset')==='3'?{...overview,entries:entries.slice(3),nextOffset:null}:overview});
  }
  reportMonth=url.searchParams.get('month');
  return route.fulfill({json:{appearance,target:entries[0].project,month:reportMonth,previousMonth:'2026-10',metrics:[{id:'reach',key:'reach',label:'Accounts reached',unit:'count',direction:'higher',current:{value:24680,quality:'complete',provider:'Synthetic fixture'},previous:{value:20000,quality:'complete',provider:'Synthetic fixture'},delta:4680,relativePercent:23.4,percentagePoints:null,change:'improved',reason:null}]}});
 });
 await page.goto(base+'/admin/');
 await page.waitForFunction(()=>document.getElementById('project-total').textContent==='4');
 assert.equal(await page.locator('#project-rows tr').count(),3);
 assert.equal(await page.locator('#client-total').innerText(),'3');
 await page.getByRole('button',{name:'Load more projects'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#project-rows tr').length===4);
 assert.equal(await page.locator('#load-more').isVisible(),false);
 await page.screenshot({path:output+'/desktop.png',fullPage:true});
 await page.getByRole('button',{name:'View report for Studio North / Instagram',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.metric-card').length===1);
 assert.equal(await page.locator('#target-name').innerText(),names[0]);
 assert.equal(await page.locator('.admin-report-button[aria-pressed="true"]').count(),1);
 assert.equal(await page.locator('.metric-card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('#month').fill('2026-09');await page.locator('#month').dispatchEvent('change');
 await page.waitForFunction(()=>document.getElementById('comparison-label').textContent.includes('September'));
 assert.equal(reportMonth,'2026-09');
 await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});
 await page.screenshot({path:output+'/project-report.png',fullPage:true});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No report page overflow at ${width}`);
  if(width===390){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/project-report-mobile.png',fullPage:true});}
 }
 await page.setViewportSize({width:1440,height:1000});
 for(const [key,theme] of Object.entries(themePresets)){
  appearance={revision:1,theme,updatedAt:null};
  await page.getByRole('button',{name:'View report for Studio North / Instagram',exact:true}).click();
  await page.waitForFunction(name=>document.querySelector('#report').style.getPropertyValue('--project-accent')===name,theme.colors.accent);
  const expectedRgb=hex=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
  assert.equal(await page.locator('#report').evaluate(el=>getComputedStyle(el).backgroundColor),expectedRgb(theme.colors.background));
  assert.equal(await page.locator('#report').evaluate(el=>getComputedStyle(el).color),expectedRgb(theme.colors.text));
  assert.equal(await page.locator('#report').evaluate(el=>getComputedStyle(el).borderRadius),{square:'0px',soft:'10px',rounded:'22px'}[theme.layout.corners]);
  assert.equal(await page.locator('.admin-app').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 18, 20)');
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${key} report overflow at ${width}`);
   if(key==='night'&&width!==320){await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:output+`/custom-theme-${width}.png`,fullPage:true});}
  }
 }
 appearance=undefined;
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.waitForFunction(()=>!document.getElementById('admin-workspace').hidden);
 assert.equal(await page.locator('#report').isVisible(),false);
 for(const width of [390,768,320]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No page overflow at ${width}`);
  if(width===390)await page.screenshot({path:output+'/mobile.png',fullPage:true});
 }
 state='empty';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.waitForFunction(()=>!document.getElementById('empty').hidden);
 assert.equal(await page.locator('#project-total').innerText(),'0');
 await page.screenshot({path:output+'/empty.png',fullPage:true});
 state='denied';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Administrator access is unavailable'));
 assert.equal(await page.locator('#admin-workspace').isVisible(),false);
 assert.equal(await page.locator('#project-rows tr').count(),0);
 await page.screenshot({path:output+'/denied.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: desktop/mobile/tablet layouts, totals, pagination, report selection, month change, preserved report palette, refresh, empty and denied states. Synthetic authentication only.');
}finally{await browser.close();server.close();}
