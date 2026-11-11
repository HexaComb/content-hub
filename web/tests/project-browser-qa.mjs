// Synthetic UI integration. No live credentials or Clerk application are used.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {rolldown} from 'rolldown';
import {themePresets,contrast} from '../../src/themeSchema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('web/dist'),output=process.env.QA_OUTPUT||'/tmp/content-hub-project-qa';await mkdir(output,{recursive:true});
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
const target={tenantId:'tenant',clientId:'client',clientName:'Studio North',projectId:'project',name:'Monthly growth',kind:'instagram_account',status:'active',platformAccountRef:'@north'};
let admin=true,ready=false,sends=0,prepares=0,uncertain=false,networkFailure=false;const reports=[];
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 if(path==='/api/session')return route.fulfill({json:{authenticated:true,email:'fixture@example.test'}});
 if(path==='/api/admin/session')return route.fulfill(admin?{json:{authenticated:true,role:'super_admin'}}:{status:403,json:{}});
 if(path==='/api/admin/overview')return route.fulfill({json:{session:{email:'fixture@example.test'},counts:{clients:1,projects:1,workspaces:1},entries:[{tenantId:'tenant',clientId:'client',clientName:'Studio North',workspaceName:'Hidden tenant',project:target}],nextOffset:null}});
 if(path.endsWith('/report')){reports.push(path);return route.fulfill({json:{target,month:url.searchParams.get('month'),previousMonth:'2026-10',metrics:[],appearance:{revision:1,theme:themePresets.editorial}}});}
 if(path.endsWith('/invitations'))return route.fulfill({json:{target,metrics:[{id:'views',label:'Views',unit:'count'}],invitations:[],readiness:{enabled:ready,reason:'Sender verification pending'}}});
 if(path.endsWith('/prepare')){prepares++;return route.fulfill({json:{invitationId:'id',approvalDigest:'digest',preview:{recipient:'client@example.test',clientId:'client',projectId:'project',target,metricIds:['views'],role:'metrics_viewer',grantExpiresAt:'2026-12-11T00:00:00Z',inviteExpiresAt:'2026-11-18T00:00:00Z',subject:'Your project invitation',email:'Read-only access to Views.',disclosure:'Only this project. No other metrics.'}}});}
 if(path.endsWith('/send')){sends++;assert.deepEqual(route.request().postDataJSON(),{invitationId:'id',approvalDigest:'digest',explicitlyApproved:true});return networkFailure?route.abort():route.fulfill({json:{deliveryState:uncertain?'uncertain':'accepted',notice:uncertain?'Do not resend.':undefined}});}
 return route.fulfill({status:404,json:{}});
});
const shown=()=>page.locator('#target-name').filter({hasText:'Monthly growth'}).waitFor();
const prepare=async()=>{await page.getByRole('button',{name:'Invite client / Manage access'}).click();await page.getByLabel('Recipient email').fill('client@example.test');await page.getByLabel('Views (count)',{exact:true}).check();await page.getByRole('button',{name:'Review invitation',exact:true}).click();await page.getByRole('region',{name:'Invitation review'}).waitFor();};
try{
 await page.goto(base+'/admin/');const link=page.getByRole('link',{name:'Monthly growth',exact:true});await link.waitFor();assert.equal(await link.getAttribute('href'),'/project?tenant=tenant&client=client&project=project');await link.focus();await page.keyboard.press('Enter');await shown();
 assert.equal(await page.locator('#project-breadcrumb').textContent(),'Studio North › Monthly growth');assert.equal(reports.at(-1),'/api/admin/targets/tenant/client/project/report');assert.equal(await page.locator('#dashboard').getAttribute('data-project-heading'),'editorial');assert.equal(await page.locator('[data-workspace]').getAttribute('data-project-theme'),null);
 await page.reload();await shown();await page.goBack();await link.waitFor();await page.goForward();await shown();
 await prepare();assert.equal(sends,0);await page.getByLabel('I approve sending').check();assert.equal(await page.getByRole('button',{name:'Send invitation',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Discard review'}).click();assert.equal(sends,0);await page.getByRole('button',{name:'Close',exact:true}).click();
 ready=true;await prepare();assert.equal(await page.getByRole('button',{name:'Send invitation',exact:true}).isDisabled(),true);await page.getByLabel('I approve sending').check();await page.getByRole('button',{name:'Send invitation',exact:true}).click();await page.getByRole('heading',{name:'Invitations and access'}).waitFor();assert.equal(sends,1);
 await page.getByRole('button',{name:'Close',exact:true}).click();uncertain=true;await prepare();await page.getByLabel('I approve sending').check();await page.getByRole('button',{name:'Send invitation',exact:true}).click();await page.getByText('Delivery could not be confirmed.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Send invitation',exact:true}).count(),0);assert.equal(sends,2);
 await page.getByRole('button',{name:'Refresh access'}).click();await page.getByRole('heading',{name:'Invitations and access'}).waitFor();assert.equal(sends,2);await page.getByRole('button',{name:'Close',exact:true}).click();
 networkFailure=true;await prepare();await page.getByLabel('I approve sending').check();await page.getByRole('button',{name:'Send invitation',exact:true}).click();await page.getByText('Delivery could not be confirmed.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Send invitation',exact:true}).count(),0);assert.equal(sends,3);await page.getByRole('button',{name:'Close',exact:true}).click();
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${output}/project-${width}.png`,fullPage:true});}
 await page.setViewportSize({width:390,height:1000});await page.getByRole('button',{name:'Open navigation'}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('#workspace-navigation').isVisible(),false);
 admin=false;await page.goto(base+'/project?tenant=tenant&client=client&project=project');await shown();assert.equal(await page.locator('#project-admin').isVisible(),false);assert.equal(reports.at(-1),'/api/targets/client/project/report');
 await page.goto(base+'/project?client=client');await page.getByText('This project link is incomplete.',{exact:false}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,prepares,sends,checks:['real link keyboard navigation','back/forward/reload','shared isolated theme','scoped recipient API','readiness gate','explicit send review','uncertain delivery no retry','mobile overflow','mobile navigation escape'],output},null,2));
}finally{await browser.close();server.close();}
