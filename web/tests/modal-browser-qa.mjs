// Synthetic-only browser tests for modal behavior and invitation safety. No external API.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {rolldown} from 'rolldown';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bundle = await rolldown({input:'modal-fixture',plugins:[{
 name:'modal-fixture',resolveId(id){if(id==='modal-fixture'||id==='./api')return '\0'+id;},
 load(id){
  if(id==='\0modal-fixture')return `import {mountInvitations} from ${JSON.stringify(resolve('web/src/scripts/project-invitations.ts'))};
   window.disposeInvitations=mountInvitations({tenantId:'tenant',clientId:'client',projectId:'project'},()=>true);`;
  if(id==='\0./api')return `export class ApiError extends Error {constructor(status){super('Request failed');this.status=status;}}
   export async function api(path){const response=await fetch(path);if(!response.ok)throw new ApiError(response.status);return response.json();}
   export async function post(path,body){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new ApiError(response.status);return response.json();}
   export const message=error=>error.message;`;
 }
}]});
const {output}=await bundle.generate({format:'es'});await bundle.close();
const css=await readFile('web/src/styles/modal.css','utf8');
const server=createServer((request,response)=>{
 if(request.url==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(output.find(part=>part.type==='chunk').code);return;}
 response.setHeader('Content-Type','text/html');response.end(`<!doctype html><html><head><style>${css}</style></head><body><button id="manage-invitations">Manage access</button><button id="outside">Outside</button><section id="invitations" hidden></section><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:800}});
let sends=0,prepareFails=false,readDelay=false,heldRead,sendDelay=false,heldSend;
const data={target:{clientName:'Fixture client',name:'Fixture project'},metrics:[{id:'views',label:'Views',unit:'count'}],invitations:[],readiness:{enabled:true,reason:''}};
await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/invitations')){if(readDelay)await new Promise(done=>heldRead=done);return route.fulfill({json:data});}
 if(path.endsWith('/prepare'))return route.fulfill(prepareFails?{status:500,json:{}}:{json:{invitationId:'invitation',approvalDigest:'digest',preview:{recipient:'client@example.test',clientId:'client',projectId:'project',target:data.target,metricIds:['views'],role:'metrics_viewer',grantExpiresAt:'2099-01-01T00:00:00Z',inviteExpiresAt:'2098-12-01T00:00:00Z',subject:'Invitation',email:'Fixture email',disclosure:'Fixture only'}}});
 if(path.endsWith('/send')){sends++;if(sendDelay)await new Promise(done=>heldSend=done);return route.abort();}
 return route.fulfill({status:404,json:{}});
});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const trigger=page.getByRole('button',{name:'Manage access'});
 await trigger.click();await page.getByLabel('Recipient email').waitFor();
 const dialog=page.getByRole('dialog',{name:'Client access'});
 assert.equal(await dialog.evaluate(node=>node.matches(':modal')),true);
 await page.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Shift+Tab');
 assert.equal(await page.evaluate(()=>!!document.activeElement.closest('dialog')),true);
 for(let i=0;i<12;i++)await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>!!document.activeElement.closest('dialog')),true);
 await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);
 await trigger.click();await page.getByLabel('Recipient email').waitFor();await page.mouse.click(2,2);assert.equal(await dialog.isVisible(),false);
 readDelay=true;await trigger.click();await page.getByText('Loading project access…').waitFor();await page.keyboard.press('Escape');heldRead();readDelay=false;
 await page.waitForTimeout(100);assert.equal(await dialog.isVisible(),false);assert.equal(await page.locator('#invitations').textContent(),'');
 await trigger.click();await page.getByLabel('Recipient email').fill('client@example.test');await page.getByLabel('Access expires (UTC)').fill('2099-01-01T00:00');await page.getByLabel('Views (count)',{exact:true}).check();
 prepareFails=true;await page.getByRole('button',{name:'Review invitation',exact:true}).click();await page.getByText('Request failed',{exact:true}).waitFor();assert.equal(await page.getByLabel('Recipient email').inputValue(),'client@example.test');assert.equal(await page.getByLabel('Views (count)',{exact:true}).isChecked(),true);
 prepareFails=false;await page.getByRole('button',{name:'Review invitation',exact:true}).click();await page.getByLabel('I approve sending').waitFor();assert.equal(sends,0);
 await page.getByLabel('I approve sending').check();sendDelay=true;await page.getByRole('button',{name:'Send invitation',exact:true}).click();await page.getByText('Sending invitation…',{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);assert.equal(await page.getByRole('button',{name:'Close',exact:true}).isDisabled(),true);
 heldSend();sendDelay=false;await page.getByText('Delivery could not be confirmed.',{exact:false}).waitFor();assert.equal(sends,1);assert.equal(await page.getByRole('button',{name:'Send invitation',exact:true}).count(),0);
 await page.getByRole('button',{name:'Refresh access'}).click();await page.getByLabel('Recipient email').waitFor();assert.equal(sends,1);
 for(const width of [390,320]){await page.setViewportSize({width,height:700});assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.evaluate(()=>window.disposeInvitations());assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.locator('#invitations').textContent(),'');
 console.log(JSON.stringify({passed:true,sends,checks:['native modal and accessible name','focus containment and restoration','Escape and backdrop dismissal','dismiss during read ignores stale reply','failed preparation preserves inputs','explicit send only','pending send cannot be dismissed','uncertain send never retried','mobile overflow','session disposal clears modal']}));
}finally{await browser.close();server.close();}
