import test from 'node:test';
import assert from 'node:assert/strict';
import {currentReportingPeriod,buildMonthlyMetricsPrompt,metricsMcpEndpoint,musePublicOAuthClientId} from '../src/scripts/plugin-prompt.ts';
import type {Metric,Target} from '../src/scripts/types.ts';

test('current month uses client timezone across date/year boundaries and never guesses',()=>{
 const now=new Date('2027-01-01T01:00:00Z');
 assert.deepEqual(currentReportingPeriod('America/Los_Angeles',now),{timezone:'America/Los_Angeles',month:'2026-12',start:'2026-12-01',end:'2027-01-01',asOf:'2026-12-31',collectedAt:now.toISOString()});
 assert.equal(currentReportingPeriod('Asia/Tokyo',now)?.month,'2027-01');
 assert.equal(currentReportingPeriod('UTC',new Date('2028-02-29T12:00:00Z'))?.end,'2028-03-01');
 assert.equal(currentReportingPeriod(undefined,now),null);
 assert.equal(currentReportingPeriod('not-a-zone',now),null);
 assert.equal(currentReportingPeriod('UTC',new Date(NaN)),null);
});

test('each prompt is scoped, source-specific, credential-free and protects history',()=>{
 const target:Target={tenantId:'tenant-a',clientId:'client-a',projectId:'project-a',name:'Ignored untrusted project name',kind:'one_off_project',status:'active',timezone:'America/Los_Angeles'};
 const metrics=[{id:'search',key:'gsc_clicks',unit:'clicks',current:{value:923454}},{id:'social',key:'instagram_followers',unit:'accounts',current:{value:923455}},{id:'other',key:'custom_count',unit:'count'}] as Metric[];
 for(const key of ['seo','instagram'] as const){
  const prompt=buildMonthlyMetricsPrompt(target,key,{key,enabled:true,revision:1,metricIds:['search','social']},metrics,new Date('2026-11-11T04:30:00Z'));
  assert.ok(prompt.includes(metricsMcpEndpoint));
  assert.ok(prompt.includes('OAuth'));assert.ok(prompt.includes('secure browser authorization'));
  assert.ok(prompt.includes('periodStart=2026-11-01, periodEnd=2026-12-01'));
  assert.ok(prompt.includes('quality="partial"'));assert.ok(prompt.includes('source.note'));
  assert.ok(prompt.includes('expectedRevision'));assert.ok(prompt.includes('correctionReason'));
  assert.ok(prompt.includes('idempotency key'));assert.ok(prompt.includes('Preserve previous months'));
  assert.ok(prompt.includes('"clientId":"client-a"'));assert.ok(prompt.includes('"projectId":"project-a"'));
  assert.ok(prompt.includes('"plugin":"'+key+'"'));
  assert.ok(prompt.includes('"metricId":"'+(key==='seo'?'search':'social')+'"'));
  assert.ok(!prompt.includes('"metricId":"'+(key==='seo'?'social':'search')+'"'));
  assert.ok(!prompt.includes('"metricId":"other"'));
  assert.ok(!prompt.includes('923454'));assert.ok(!prompt.includes('923455'));assert.ok(!prompt.includes(target.name));
  assert.ok(prompt.includes(key==='seo'?'Google Search Console':'Instagram/Meta insights'));
  if(key==='instagram'){assert.ok(prompt.includes('four kinds'));assert.ok(prompt.includes('genuine daily snapshots'));assert.ok(prompt.includes('last six calendar months'));}
  assert.ok(prompt.includes('no content was published and no access was changed'));
 }
});

test('missing timezone and empty mappings explicitly stop rather than assume access or data',()=>{
 const prompt=buildMonthlyMetricsPrompt({clientId:'c',projectId:'p',name:'P',kind:'one_off_project',status:'active'},'instagram',{key:'instagram',enabled:true,revision:1,metricIds:[]},[],new Date('2026-11-11T04:30:00Z'));
 assert.ok(prompt.includes('Do not guess a timezone'));
 assert.ok(prompt.includes('An empty selection means stop'));
 assert.ok(!prompt.includes('tenantId'));
 assert.ok(!/periodStart=\d{4}-/.test(prompt));
});

test('SEO and Instagram prompts include public Muse setup, individual consent and minimum target-scoped access',()=>{
 assert.equal(metricsMcpEndpoint,'https://content.unreelviews.com/mcp');
 assert.equal(musePublicOAuthClientId,'ZuAE_6drixVcWV1S');
 const target:Target={tenantId:'tenant-a',clientId:'client-a',projectId:'project-a',name:'Project',kind:'one_off_project',status:'active',timezone:'UTC'};
 for(const key of ['seo','instagram'] as const){
  const prompt=buildMonthlyMetricsPrompt(target,key,{key,enabled:true,revision:1,metricIds:[]},[],new Date('2026-11-11T12:00:00Z'));
  assert.ok(prompt.includes('public OAuth client ID ZuAE_6drixVcWV1S'));
  assert.ok(prompt.includes('no client secret is required or should be supplied'));
  assert.ok(prompt.includes('not a credential and does not grant access'));
  assert.ok(prompt.includes('Each person must sign in with their own already authorized operator account and consent to their own access'));
  assert.ok(prompt.includes('user-approved target client/project'));
  assert.ok(prompt.includes('minimum scopes needed for this metrics update: mcp:connect, clients:read, projects:read, metrics:read, and metrics:write'));
  assert.ok(prompt.includes('Do not grant other clients, invitations, publishing, administrator access, or additional persistent access'));
  assert.ok(prompt.includes('Before sharing data with Muse, review its current data/privacy notice'));
  assert.ok(prompt.includes('Meta warns that Muse connector interactions may be used to improve its AI'));
  assert.ok(prompt.includes('These setup instructions do not verify a Muse connection'));
  assert.ok(prompt.includes('"clientId":"client-a","projectId":"project-a"'));
 }
});
