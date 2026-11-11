import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {themePresets,projectThemeSchema,updateThemeInput} from '../src/themeSchema.ts';
import {getProjectTheme,readProjectTheme,validateProjectTheme,updateProjectTheme,resetProjectTheme} from '../src/themes.ts';
import {adminReport} from '../src/adminReports.ts';
import type {InvitationEnv} from '../src/mail.ts';

test('theme schema is closed, accessible and non-executable',()=>{
 for(const theme of Object.values(themePresets))assert.equal(projectThemeSchema.safeParse(theme).success,true);
 const theme=themePresets.night;
 for(const input of [{...theme,css:'body{display:none}'},{...theme,html:'<script>alert(1)</script>'},{...theme,metrics:[]},{...theme,colors:{...theme.colors,accent:'red;display:none'}},{...theme,colors:{...theme.colors,muted:theme.colors.background}},{...theme,layout:{...theme.layout,columns:0}},{...theme,typography:{...theme.typography,heading:'url(https://evil.test/font)'}}])assert.equal(projectThemeSchema.safeParse(input).success,false);
 // No image decoder is exposed: even a valid one-pixel PNG is rejected.
 for(const dataUrl of ['https://tracker.test/logo.png','data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=','javascript:alert(1)','data:image/png;base64,PHNjcmlwdD4=','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','data:image/png;base64,'+'A'.repeat(40000)])assert.equal(projectThemeSchema.safeParse({...theme,brand:{...theme.brand,logo:{dataUrl,alt:'Logo'}}}).success,false);
 assert.equal(projectThemeSchema.safeParse({...theme,brand:{...theme.brand,logo:'https://tracker.test/logo.png'}}).success,false);
 assert.equal(projectThemeSchema.safeParse({...theme,brand:{...theme.brand,logo:null}}).success,true);
 assert.equal(updateThemeInput.safeParse({clientId:'c',projectId:'p',theme,expectedRevision:0,idempotencyKey:'test-key',tenantId:'other'}).success,false);
});

test('project themes preserve reports, isolate targets and audit atomic writes/resets',async t=>{
 const mf=new Miniflare({workers:[{config:{name:'theme-tests',compatibilityDate:'2026-11-10',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}},env:{DB:{type:'d1',name:'theme-tests'}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())for(const statement of(await readFile('migrations/'+file,'utf8')).split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(/;(?=\s*(?:CREATE|ALTER|INSERT|PRAGMA|$))/).map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants VALUES(?,?)').bind(tenant,tenant).run();
  await db.prepare("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES(?,'agent','Agent',?,'2099-01-01','[]')").bind(tenant,tenant.repeat(64)).run();
  for(const client of ['c','other']){
   await db.prepare("INSERT INTO clients VALUES(?,?,'Client','UTC')").bind(tenant,client).run();
   for(const project of ['p','sibling'])await db.prepare("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES(?,?,?,'Project','','active',1,'2026-11-01','2026-11-01')").bind(tenant,client,project).run();
  }
  await db.prepare("INSERT INTO client_grants VALUES(?,'agent','c')").bind(tenant).run();
  await db.prepare("INSERT INTO metrics VALUES(?,'c','m','views','Views','test','count','higher','period_total','UTC','{}','Synthetic','agent','2026-11-01')").bind(tenant).run();
  await db.prepare("INSERT INTO project_metrics VALUES(?,'c','p','m')").bind(tenant).run();
  for(const [month,end,value]of [['2026-10-01','2026-11-01',10],['2026-11-01','2026-12-01',20]])await db.prepare("INSERT INTO observations VALUES(?,'c',?,'m',?,?,1,?,'complete','{}','2026-11-11','2026-11-11','agent',?,'hash',NULL)").bind(tenant,month,month,end,value,month).run();
 }
 const p={tenantId:'a',id:'agent',scopes:['themes:read','themes:write']},target={clientId:'c',projectId:'p'};
 const env:InvitationEnv={DB:db,APP_ORIGIN:'https://reports.example.test',ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:'https://clerk.example.test',CLERK_PUBLISHABLE_KEY:'pk_test_'+btoa('clerk.example.test$').replace(/=+$/,''),CLERK_SECRET_KEY:'sk_test_synthetic'};
 const admin={issuer:env.CLERK_ISSUER!,subject:'user_admin',sessionId:'session_admin',email:'marco@hexacombllc.com'};
 const before=await adminReport(db,admin,env,'a','c','p','2026-11');
 assert.equal((await getProjectTheme(db,p,target)).revision,0);
 await validateProjectTheme(db,p,{...target,theme:themePresets.night});
 assert.equal((await getProjectTheme(db,p,target)).revision,0);
 await assert.rejects(getProjectTheme(db,{...p,scopes:['projects:read']},target),/scope/);
 await assert.rejects(getProjectTheme(db,p,{...target,clientId:'other'}),/not available/);
 await assert.rejects(getProjectTheme(db,p,{...target,projectId:'missing'}),/not available/);
 const input={...target,theme:themePresets.night,expectedRevision:0,idempotencyKey:'theme-create'};
 await assert.rejects(updateProjectTheme(db,{...p,scopes:['themes:read']},input),/scope/);
 const writes=await Promise.all([updateProjectTheme(db,p,input),updateProjectTheme(db,p,input)]);
 assert.equal(writes.filter(r=>r.replayed).length,1);
 assert.equal((await getProjectTheme(db,p,target)).revision,1);
 assert.equal((await getProjectTheme(db,{...p,tenantId:'b'},target)).revision,0);
 assert.equal((await getProjectTheme(db,p,{...target,projectId:'sibling'})).revision,0);
 await assert.rejects(updateProjectTheme(db,p,{...input,theme:themePresets.editorial}),/Idempotency/);
 await assert.rejects(updateProjectTheme(db,p,{...input,idempotencyKey:'stale-key'}),/revision/);
 const after=await adminReport(db,admin,env,'a','c','p','2026-11');
 assert.deepEqual({...after,appearance:undefined},{...before,appearance:undefined});
 assert.equal(after.appearance.theme?.name,'After hours');
 assert.equal((await db.prepare("SELECT revision FROM projects WHERE tenant_id='a' AND client_id='c' AND id='p'").first<{revision:number}>())?.revision,1);
 const reset={...target,expectedRevision:1,idempotencyKey:'theme-reset'};
 assert.equal((await resetProjectTheme(db,p,reset)).revision,2);
 assert.equal((await resetProjectTheme(db,p,reset)).replayed,true);
 assert.equal((await getProjectTheme(db,p,target)).theme,null);
 assert.equal((await getProjectTheme(db,p,target)).revision,2);
 await assert.rejects(updateProjectTheme(db,p,{...input,idempotencyKey:'after-reset'}),/revision/);
 await updateProjectTheme(db,p,{...input,expectedRevision:2,idempotencyKey:'next-theme'});
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM theme_events').first<{n:number}>())?.n,3);
 await assert.rejects(db.prepare("UPDATE theme_events SET operation='reset_project_theme'").run(),/append-only/);
 await assert.rejects(db.prepare('DELETE FROM theme_events').run(),/append-only/);
 await db.prepare("UPDATE project_themes SET theme_json='{\"html\":\"<script/>\"}' WHERE tenant_id='a'").run();
 assert.equal((await readProjectTheme(db,'a','c','p')).theme,null);
 await db.prepare("DELETE FROM client_grants WHERE tenant_id='a'").run();
 await assert.rejects(getProjectTheme(db,p,target),/not available/);
 await assert.rejects(updateProjectTheme(db,p,input),/not available/); // Replays do not bypass current grants.
});
