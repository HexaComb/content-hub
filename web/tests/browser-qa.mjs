// Run after building: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node web/tests/browser-qa.mjs
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'../dist');const output=resolve(import.meta.dirname,'artifacts');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,`.${path.endsWith('/')?path+'index.html':extname(path)?path:path+'/index.html'}`);if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1150}});let errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
// No live Clerk application or credentials are used in this suite. Authenticated Clerk
// flows must be validated with Clerk's supported test setup before production use.
await page.route('**/api/auth/config',route=>route.fulfill({status:503,json:{error:'Authentication unavailable'}}));
await page.goto(base+'/');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Secure sign-in is unavailable'));await page.screenshot({path:output+'/auth-unconfigured.png',fullPage:true});
assert.equal(await page.locator('.metric-card').count(),0);assert.equal(await page.locator('a[href="/demo"]').count(),0);await page.setViewportSize({width:390,height:844});await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Secure sign-in is unavailable'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:output+'/auth-unconfigured-mobile.png',fullPage:true});
await page.goto(base+'/invite#token=synthetic-token');assert.equal(new URL(page.url()).hash,'');await page.waitForFunction(()=>document.querySelector('#invite-status').textContent.includes('Secure sign-in is unavailable'));assert.equal(await page.locator('#accept-invite').isVisible(),false);await page.screenshot({path:output+'/invite-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);await page.click('#retry-invite');await page.waitForFunction(()=>document.querySelector('#invite-status').textContent.includes('Secure sign-in is unavailable'));await page.reload();assert.match(await page.locator('#invite-status').innerText(),/reopen the original email link/i);assert.equal(await page.locator('#accept-invite').isVisible(),false);
await page.goto(base+'/authorize');await page.waitForFunction(()=>document.querySelector('#consent-status').textContent.includes('unavailable'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:output+'/consent-mobile.png',fullPage:true});
assert.deepEqual(errors,[]);console.log('PASS: empty desktop/mobile portal, unconfigured Clerk failure, fragment clearing, retry and interrupted invitation. Live Clerk sign-in/acceptance NOT covered.');
}finally{await browser.close();server.close();}
