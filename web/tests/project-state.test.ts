import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectPagePath} from '../src/scripts/admin-state.ts';
import {readProjectRoute,projectReportPath,previousCompletedMonth,canSendInvitation,invitationStatus,type InvitationPreview} from '../src/scripts/project-state.ts';
import {safeSignInReturn} from '../src/scripts/oauth-state.ts';
test('project address retains ownership across reload and new tabs',()=>{
 const target={tenantId:'a/b',clientId:'c & d',projectId:'project'};const path=projectPagePath(target);
 assert.deepEqual(readProjectRoute(path.split('?')[1]),target);assert.equal(readProjectRoute('?client=c'),null);assert.equal(readProjectRoute('?client=c&client=d&project=p'),null);
});
test('only a verified administrator may select the admin report endpoint',()=>{
 const target={tenantId:'t',clientId:'c',projectId:'p'};
 assert.equal(projectReportPath(target,'2026-11',true),'/api/admin/targets/t/c/p/report?month=2026-11');
 assert.equal(projectReportPath(target,'2026-11',false),'/api/targets/c/p/report?month=2026-11');
 assert.equal(projectReportPath({clientId:'c',projectId:'p'},'2026-11',true),'/api/targets/c/p/report?month=2026-11');
});
test('project sign-in return preserves only known same-origin project coordinates',()=>{
 assert.equal(safeSignInReturn('/project/?tenant=t&client=c&project=p','https://portal.test'),'https://portal.test/project?tenant=t&client=c&project=p');
 assert.equal(safeSignInReturn('/project/?client=c&project=p&plugin=seo','https://portal.test'),'https://portal.test/project?client=c&project=p&plugin=seo');
 for(const path of ['/project?client=c&project=p&plugin=bad','/project?client=c&project=p&plugin=seo&plugin=instagram','/project?client=c&project=p&redirect=https://evil.test','//evil.test/project?client=c&project=p','/project?client=c','/project?client=c&client=d&project=p'])assert.throws(()=>safeSignInReturn(path,'https://portal.test'));
});
test('invitation sending requires prepared server digest, readiness, explicit approval and idle state',()=>{
 const preview={invitationId:'id',approvalDigest:'digest'} as InvitationPreview;
 assert.equal(canSendInvitation(preview,true,false,true),true);
 for(const state of [[undefined,true,false,true],[preview,false,false,true],[preview,true,true,true],[preview,true,false,false],[{...preview,approvalDigest:''},true,false,true]] as const)assert.equal(canSendInvitation(...state),false);
});
test('directory links to standalone page and omits generic workspace data',()=>{
 const admin=readFileSync('web/src/scripts/admin.ts','utf8');const page=readFileSync('web/src/pages/admin.astro','utf8');
 assert.match(admin,/projectName as HTMLAnchorElement/);assert.match(admin,/projectPagePath/);assert.doesNotMatch(page,/workspace-total|<th[^>]*>Workspace|id="report"/);
 assert.match(readFileSync('web/src/pages/project.astro','utf8'),/<Dashboard project/);
});

test('invitation UI distinguishes provider acceptance from uncertain delivery and resets denial state',()=>{
 const source=readFileSync('web/src/scripts/project-invitations.ts','utf8');
 assert.match(source,/result.deliveryState!=='accepted'/);assert.match(source,/Delivery and access acceptance are not yet confirmed/);assert.match(source,/const clear=\(\)=>\{sequence\+\+;busy=false/);assert.doesNotMatch(source,/notice.textContent='Invitation sent.'/);
});

test('standalone reports default to the last completed UTC month, including January rollover',()=>{assert.equal(previousCompletedMonth(new Date('2026-11-11T00:00:00Z')),'2026-10');assert.equal(previousCompletedMonth(new Date('2026-01-01T00:00:00Z')),'2025-12');assert.equal(previousCompletedMonth(new Date('2026-03-01T00:30:00+02:00')),'2026-01');});

test('invitation history distinguishes provider acceptance, recipient acceptance, expiry and uncertainty',()=>{
 const now=Date.parse('2026-11-11T00:00:00Z');const invitation={revoked_at:null,accepted_at:null,grant_expires_at:'2026-12-11T00:00:00Z',invite_expires_at:'2026-11-18T00:00:00Z',delivery_state:'prepared'};
 const status=(changes={})=>invitationStatus({...invitation,...changes},now);
 assert.equal(status(),'Prepared, no email sent');
 assert.equal(status({delivery_state:'accepted'}),'Email accepted by provider, awaiting recipient');
 assert.equal(status({accepted_at:'2026-11-10T00:00:00Z'}),'Access accepted');
 assert.equal(status({accepted_at:'2026-11-10T00:00:00Z',grant_expires_at:'2026-11-11T00:00:00Z'}),'Access expired');
 assert.equal(status({revoked_at:'2026-11-10T00:00:00Z',accepted_at:'2026-11-09T00:00:00Z'}),'Revoked');
 assert.equal(status({delivery_state:'uncertain'}),'Delivery unconfirmed, do not resend');
 assert.equal(status({delivery_state:'sending'}),'Sending, outcome pending');
 assert.equal(status({invite_expires_at:'2026-11-10T00:00:00Z',delivery_state:'accepted'}),'Invitation expired');
 assert.equal(status({invite_expires_at:'2026-11-10T00:00:00Z',delivery_state:'uncertain'}),'Delivery unconfirmed, do not resend');
 assert.equal(status({delivery_state:'unknown'}),'Delivery status unavailable');
});
