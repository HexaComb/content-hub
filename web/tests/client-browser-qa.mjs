// Synthetic UI integration. No live credentials or Clerk application are used.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {rolldown} from 'rolldown';
import {themePresets,contrast} from '../../src/themeSchema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('web/dist'),output=process.env.QA_OUTPUT||'/tmp/content-hub-client-qa';await mkdir(output,{recursive:true});
const bundle=await rolldown({input:{client:'qa-client',admin:'qa-admin'},plugins:[{
 name:'synthetic-ui',resolveId(id){if(id==='./auth'||id.startsWith('qa-'))return '\0'+id;},
 load(id){
  if(id==='\0qa-client'||id==='\0qa-admin')return `import ${JSON.stringify(resolve('web/src/scripts/navigation.ts'))};import ${JSON.stringify(resolve(`web/src/scripts/${id.endsWith('client')?'dashboard':'admin'}.ts`))};`;
  if(id==='\0./auth')return `export class AuthUnavailable extends Error {};
   const clerk={session:new URLSearchParams(location.search).has('signedout')?null:{id:'synthetic',getToken:async()=>null},addListener:()=>()=>{},signOut:async()=>{}};
   export async function getClerk(){return clerk;}
   export async function mountSignIn(node){node.textContent='Synthetic sign-in fixture';return ()=>node.replaceChildren();}`;
 }
}]});
const {output:chunks}=await bundle.generate({format:'es',entryFileNames:'qa-[name].js'});await bundle.close();
const scripts=new Map(chunks.filter(x=>x.type==='chunk').map(x=>['/'+x.fileName,x.code]));
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(scripts.has(path)){res.setHeader('Content-Type','application/javascript');res.end(scripts.get(path));return;}
 const file=resolve(root,`.${path.endsWith('/')?path+'index.html':extname(path)?path:path+'/index.html'}`);
 if(!file.startsWith(root+'/'))throw Error();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg'})[extname(file)]||'application/octet-stream');
 let body=await readFile(file);
 if(path==='/'||path==='/admin/'||path==='/project'||path==='/project/')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>',`<script type="module" src="/qa-${path==='/admin/'?'admin':'client'}.js"></script></body>`);
 res.end(body);
}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce',hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const targets=[{clientId:'synthetic',projectId:'default',name:'Studio North',kind:'instagram_account',platformAccountRef:'@studio.north',status:'active'},...Object.keys(themePresets).map(key=>({clientId:'synthetic',projectId:key,name:`${key} project`,kind:'one_off_project',status:'active'}))];
const metric=(key,label,value,prior)=>({id:key,key,label,unit:'count',direction:'higher',current:{value,quality:'complete',provider:'Synthetic fixture'},previous:{value:prior,quality:'complete',provider:'Synthetic fixture'},delta:value-prior,relativePercent:(value-prior)/prior*100,percentagePoints:null,change:value>=prior?'improved':'declined',reason:null});
const metrics=[metric('reach','Accounts reached',24680,20000),metric('followers','Followers',8420,7900),metric('posts','Posts published',12,16),{...metric('views','Video views',32100,29000),current:{value:32100,quality:'partial'},delta:null,relativePercent:null,change:'neutral',reason:'incomplete'}];
let mode='populated',requestedMonth;
const capture=async name=>{await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:`${output}/${name}.png`,fullPage:true});};
const noOverflow=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label);
try{
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/session')return route.fulfill({json:{authenticated:mode!=='signedout',email:'client@example.test'}});
  if(url.pathname==='/api/admin/session')return route.fulfill({status:403,json:{}});
  if(url.pathname==='/api/targets')return route.fulfill({json:{targets:mode==='empty'?[]:targets}});
  if(url.pathname==='/api/admin/overview')return route.fulfill({json:{session:{email:'admin@example.test'},counts:{clients:0,projects:0,workspaces:1},entries:[],nextOffset:null}});
  if(mode==='error')return route.fulfill({status:500,json:{}});
  if(mode==='denied')return route.fulfill({status:403,json:{}});
  const key=url.pathname.split('/').at(-2),theme=themePresets[key];requestedMonth=url.searchParams.get('month');
  const date=new Date(requestedMonth+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);
  return route.fulfill({json:{target:targets.find(t=>t.projectId===key),month:requestedMonth,previousMonth:date.toISOString().slice(0,7),metrics:mode==='no-metrics'?[]:metrics,appearance:theme?{revision:1,theme,updatedAt:null}:undefined}});
 });
 await page.goto(base+'/');await page.waitForFunction(()=>document.querySelectorAll('.metric-card').length===4);
 assert.equal(await page.locator('#admin-link').isVisible(),false);
 assert.equal(await page.locator('.app-brand img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
 assert.equal(await page.locator('.metric-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 26, 29)');
 const pairs=await page.evaluate(()=>['.admin-heading p','.workspace-link.is-current','.metric-top h3','.metric-context','.quality-warning','.delta.improved','.delta.declined'].map(selector=>{
  const element=document.querySelector(selector);let parent=element;let background='';
  while(parent){background=getComputedStyle(parent).backgroundColor;if(background!=='rgba(0, 0, 0, 0)'&&background!=='transparent')break;parent=parent.parentElement;}
  return {selector,foreground:getComputedStyle(element).color,background};
 }));
 const hex=rgb=>'#'+rgb.match(/\d+/g).slice(0,3).map(value=>Number(value).toString(16).padStart(2,'0')).join('');
 for(const pair of pairs)assert.ok(contrast(hex(pair.foreground),hex(pair.background))>=4.5,`Readable ${pair.selector}`);
 await capture('client-desktop');
 await page.getByRole('button',{name:'Collapse sidebar'}).click();
 assert.equal(await page.locator('#workspace-navigation').evaluate(el=>el.getBoundingClientRect().width),80);
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.metric-card').length===4);
 assert.equal(await page.getByRole('button',{name:'Expand sidebar'}).count(),1);
 await capture('client-collapsed');await page.getByRole('button',{name:'Expand sidebar'}).click();
 await page.locator('#month').fill('2026-10');await page.locator('#month').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('comparison-label').textContent.includes('October 2026'));
 await page.getByRole('button',{name:'Previous month'}).click();await page.waitForFunction(()=>document.getElementById('comparison-label').textContent.includes('September 2026'));assert.equal(requestedMonth,'2026-09');
 await page.getByRole('button',{name:'Next month'}).click();await page.waitForFunction(()=>document.getElementById('comparison-label').textContent.includes('October 2026'));
 for(const width of [390,768,320]){
  await page.setViewportSize({width,height:900});await noOverflow(`client ${width}`);
  assert.equal(await page.locator('#workspace-navigation').isVisible(),false);
  if(width===390)await capture('client-mobile');
  const menu=page.getByRole('button',{name:'Open navigation'});await menu.tap();
  assert.equal(await page.locator('#workspace-navigation').evaluate(el=>el.matches(':modal')),true);
  assert.equal(await page.locator('#close-navigation').evaluate(el=>el===document.activeElement),true);
  for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.getElementById('workspace-navigation').contains(document.activeElement)),true);}
  for(let i=0;i<6;i++){await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.getElementById('workspace-navigation').contains(document.activeElement)),true);}
  if(width===390)await page.screenshot({path:output+'/mobile-navigation.png'});
  await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');assert.equal(await menu.evaluate(el=>el===document.activeElement),true);
 }
 await page.setViewportSize({width:390,height:900});await page.getByRole('button',{name:'Open navigation'}).click();await page.touchscreen.tap(380,400);assert.equal(await page.locator('#workspace-navigation').isVisible(),false);
 await page.getByRole('button',{name:'Open navigation'}).click();await page.setViewportSize({width:1440,height:1100});assert.equal(await page.locator('#workspace-navigation').evaluate(el=>el.open&&!el.matches(':modal')),true);assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('navigation-open')),false);
 for(const [index,[key,theme]] of Object.entries(Object.entries(themePresets))){
  await page.goto(base+'/project?client=synthetic&project='+key);await page.waitForFunction(accent=>document.getElementById('dashboard').style.getPropertyValue('--project-accent')===accent,theme.colors.accent);
  const rgb=hex=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
  assert.equal(await page.locator('#dashboard').evaluate(el=>getComputedStyle(el).backgroundColor),rgb(theme.colors.background));
  assert.equal(await page.locator('.workspace-app').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 18, 20)');
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await noOverflow(`${key} ${width}`);if(key==='editorial'&&width!==320)await capture(`client-custom-${width}`);}
 }
 await page.goto(base+'/');await page.waitForFunction(()=>!document.getElementById('dashboard').hasAttribute('data-project-theme')&&document.querySelectorAll('.metric-card').length===4);
 assert.equal(await page.locator('.metric-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 26, 29)');
 mode='error';await page.getByRole('button',{name:'Previous month'}).click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Try again'));mode='populated';await page.getByRole('button',{name:'Try again'}).click();await page.waitForFunction(()=>document.querySelectorAll('.metric-card').length===4);
 mode='no-metrics';await page.reload();await page.waitForFunction(()=>document.querySelector('#metrics .notice'));await capture('client-no-metrics');
 mode='empty';await page.reload();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('no accounts or projects'));assert.equal(await page.locator('#dashboard').isVisible(),false);await capture('client-empty');
 mode='signedout';await page.goto(base+'/?signedout=1');await page.waitForFunction(()=>!document.getElementById('welcome').hidden);await capture('client-signin');
 mode='denied';await page.goto(base+'/');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('no longer available'));assert.equal(await page.locator('#dashboard').isVisible(),false);assert.equal(await page.locator('.metric-card').count(),0);
 mode='populated';await page.goto(base+'/admin/');await page.waitForFunction(()=>!document.getElementById('admin-workspace').hidden);
 await page.getByRole('button',{name:'Open navigation'}).click();assert.equal(await page.getByRole('link',{name:'Client view',exact:true}).isVisible(),true);await page.locator('#close-navigation').click();await capture('admin-mobile');
 assert.deepEqual(errors,[]);
 console.log('PASS: client dark reports, genuine logo, desktop collapse/persistence, mobile modal focus/Tab/Escape/backdrop/resize, admin shared navigation, month controls, all project themes, reset, retry, no-metrics, no-access, sign-in and denied states. Synthetic auth only.');
}finally{await browser.close();server.close();}

