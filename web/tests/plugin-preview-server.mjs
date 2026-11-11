// Synthetic UI integration. No live credentials or Clerk application are used.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {rolldown} from 'rolldown';
import {themePresets,contrast} from '../../src/themeSchema.ts';

const plugins=new Map();
const metric=(id,key,label)=>({id,key,label,unit:'count',direction:'higher',current:null,previous:null,delta:null,relativePercent:null,percentagePoints:null,change:'neutral',reason:'missing'});
const metrics=[metric('search','openseo.visibility','Search visibility'),metric('reach','instagram.reach','Instagram reach')];
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
 const url=new URL(req.url,'http://localhost');const path=url.pathname;
 const target={tenantId:'tenant',clientId:'client',clientName:'Studio North',projectId:'project',name:'Monthly growth',kind:'instagram_account',status:'active',platformAccountRef:'@north'};
 if(path.startsWith('/api/')){
 res.setHeader('Content-Type','application/json');let result;
 if(path==='/api/session')result={authenticated:true,email:'fixture@example.test'};
 else if(path==='/api/admin/session')result={authenticated:true,role:'super_admin'};
 else if(path==='/api/admin/overview')result={session:{email:'fixture@example.test'},counts:{clients:1,projects:1,workspaces:1},entries:[{tenantId:'tenant',clientId:'client',clientName:'Studio North',project:target}],nextOffset:null};
 else if(path.endsWith('/plugins')&&req.method==='GET')result={plugins:[...plugins.values()]};
 else if(path.endsWith('/plugins')&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);const previous=plugins.get(input.key);if((previous?.revision??0)!==input.expectedRevision){res.statusCode=409;result={error:'stale revision'};}else{result={...input,revision:input.expectedRevision+1};plugins.set(input.key,result);}}
 else if(path.endsWith('/plugins/instagram/content'))result={items:[],nextCursor:null};
 else if(path.endsWith('/report')){const selected=url.searchParams.get('plugin'),config=plugins.get(selected);result={target,month:url.searchParams.get('month'),previousMonth:'2026-09',metrics:selected?metrics.filter(m=>config?.metricIds.includes(m.id)):metrics};}
 else if(path.endsWith('/invitations'))result={target,metrics:[{id:'views',label:'Views',unit:'count'}],invitations:[],readiness:{enabled:false,reason:'Synthetic sender not verified'}};
 else if(path.endsWith('/prepare'))result={invitationId:'fixture-id',approvalDigest:'fixture-digest',preview:{recipient:'client@example.test',clientId:'client',projectId:'project',target,metricIds:['views'],role:'metrics_viewer',grantExpiresAt:'2026-12-11T00:00:00Z',inviteExpiresAt:'2026-11-18T00:00:00Z',subject:'Your project invitation',email:'Read-only access to Views.',disclosure:'Only this project. No other metrics.'}};
 else {res.writeHead(403);result={error:'No real changes supported in this fixture'};}
 res.end(JSON.stringify(result));return;
 }
 if(scripts.has(path)){res.setHeader('Content-Type','application/javascript');res.end(scripts.get(path));return;}
 const file=resolve(root,`.${path.endsWith('/')?path+'index.html':extname(path)?path:path+'/index.html'}`);
 if(!file.startsWith(root+'/'))throw Error();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg'})[extname(file)]||'application/octet-stream');
 let body=await readFile(file);
 if(path==='/'||path==='/admin/'||path==='/project'||path==='/project/')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>',`<script type="module" src="/qa-${path==='/admin/'?'admin':'client'}.js"></script></body>`);
 res.end(body);
}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(4181,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
console.log('Synthetic plugin QA fixture (no live data or account): '+base+' /admin/');
