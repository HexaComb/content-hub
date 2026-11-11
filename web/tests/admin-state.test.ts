import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminEmptyMessage,adminReportPath} from '../src/scripts/admin-state.ts';
test('admin empty states explain setup, never invitation access',()=>{
 assert.match(adminEmptyMessage({clients:0,projects:0,workspaces:0}),/administrator access is ready/);
 assert.match(adminEmptyMessage({clients:1,projects:0,workspaces:1}),/No projects yet/);
 assert.equal(adminEmptyMessage({clients:1,projects:1,workspaces:1}),'');
});
test('admin report URLs preserve all three ownership identifiers',()=>{
 assert.equal(adminReportPath({tenantId:'t',clientId:'c',projectId:'p',name:'Project',kind:'one_off_project',status:'active',platformAccountRef:null},'2026-11'),'/api/admin/targets/t/c/p/report?month=2026-11');
});
test('admin page has no public signup, business mutations, or frontend email allowlist',()=>{
 const source=readFileSync('web/src/scripts/admin.ts','utf8');assert.doesNotMatch(source,/marco@|christian@|innerHTML|method:\s*['"]POST/);assert.match(source,/api\/admin\/overview/);
 const page=readFileSync('web/src/pages/admin.astro','utf8');assert.match(page,/Read-only/);assert.match(page,/Business changes stay in MCP/);
});

test('root routes only a server-confirmed administrator; client view remains explicit',()=>{
 const source=readFileSync('web/src/scripts/dashboard.ts','utf8');assert.match(source,/api\/admin\/session/);assert.match(source,/admin.authenticated===true&&admin.role==='super_admin'/);assert.match(source,/location.replace\('\/admin'\)/);assert.match(source,/get\('view'\)!=='client'/);assert.doesNotMatch(source,/marco@|christian@/);
});

test('administrator sign-in returns only to a fixed local page',()=>{
 const source=readFileSync('web/src/scripts/auth.ts','utf8');
 assert.ok(source.includes("['/','/invite','/admin'].includes(returnPath)"));
 assert.ok(source.includes('forceRedirectUrl:location.origin+returnPath'));
});
