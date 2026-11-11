import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agentWorkflows,workflowGroups,buildSkillsSetupPrompt} from '../src/scripts/skills-catalog.ts';
import {metricsMcpEndpoint,musePublicOAuthClientId} from '../src/scripts/plugin-prompt.ts';
import {TOOL_SCOPES} from '../../src/oauthTools.ts';
import {OAUTH_SCOPES} from '../../src/oauthAccess.ts';

test('every catalog tool is registered and covered by the declared OAuth scopes',()=>{
 const source=readFileSync(new URL('../../src/index.ts',import.meta.url),'utf8');
 const tools=new Set([...source.matchAll(/registerTool\(["']([^"']+)["']/g)].map(match=>match[1]));
 assert.equal(agentWorkflows.length,10);
 assert.equal(new Set(agentWorkflows.map(workflow=>workflow.id)).size,agentWorkflows.length);
 for(const workflow of agentWorkflows){
  assert.ok(workflowGroups.some(group=>group.id===workflow.group));
  assert.ok(workflow.steps.length>=3);
  for(const tool of workflow.tools){
   assert.ok(tools.has(tool),`${workflow.id}: unknown ${tool}`);
   assert.ok(workflow.scopes.includes(TOOL_SCOPES[tool]),`${workflow.id}: missing ${TOOL_SCOPES[tool]}`);
  }
  for(const scope of workflow.scopes)assert.ok(OAUTH_SCOPES.includes(scope),`${workflow.id}: unsupported ${scope}`);
 }
});

test('generic setup includes public connection metadata, individual consent and honest installation boundaries',()=>{
 const prompt=buildSkillsSetupPrompt();
 assert.equal(metricsMcpEndpoint,'https://content.unreelviews.com/mcp');
 assert.equal(musePublicOAuthClientId,'ZuAE_6drixVcWV1S');
 assert.ok(prompt.includes(metricsMcpEndpoint));assert.ok(prompt.includes(musePublicOAuthClientId));
 for(const text of ['no client secret','own already authorized operator account','Do not use this Muse ID in another agent','Registration does not prove','improve AI at Meta','If you support reusable skills','reusable workflow instructions','Do not request every listed scope','offline_access is optional','tools actually advertised','connection may expose fewer tools','not permission to modify client data','Do not run arbitrary downloaded installers','Separate access workflow','all current and future projects','does not need a separate connection per project'])assert.ok(prompt.includes(text),text);
 assert.ok(!/Bearer [A-Za-z0-9_-]{16}|sk_(?:live|test)_|refresh_token[=:]|api[_-]?key[=:]|hexacomb|openseo-[0-9a-f]{8}/i.test(prompt));
 assert.ok(!prompt.includes('tenantId='));assert.ok(!prompt.includes('clientId='));
 assert.equal((prompt.match(/^SKILL: /gm)??[]).length,agentWorkflows.length);
});

test('single-workflow setup is allowlisted, deterministic and retains common safeguards',()=>{
 const prompt=buildSkillsSetupPrompt(['update-seo']);
 assert.ok(prompt.includes('SKILL: Update SEO readings'));
 assert.ok(!prompt.includes('SKILL: Publish or restore'));
 assert.ok(!prompt.includes('presentations:publish'));
 assert.ok(prompt.includes('preserve source')||prompt.includes('source provider'));
 assert.ok(prompt.includes('partial'));assert.ok(prompt.includes('expectedRevision'));assert.ok(prompt.includes('idempotency'));
 assert.equal(buildSkillsSetupPrompt(['update-seo','update-seo']),prompt);
 assert.equal(buildSkillsSetupPrompt(['<script>','update-seo']),prompt);
 assert.throws(()=>buildSkillsSetupPrompt(['<script>']),/supported workflow/);
 assert.throws(()=>buildSkillsSetupPrompt([]),/supported workflow/);
});

test('workflow guidance preserves trusted numbers, separate sources, draft review and private audience',()=>{
 const byId=(id:string)=>{const item=agentWorkflows.find(workflow=>workflow.id===id)!;return [...item.steps,item.guardrail].join(' ');};
 assert.match(byId('configure-metrics'),/Empty mappings mean no metrics/);
 assert.match(byId('update-seo'),/does not fetch OpenSEO or Google data/);
 assert.match(byId('update-instagram'),/missing dates remain missing/);
 assert.match(byId('review-results'),/client-wide.*filter/);
 assert.match(byId('style-report'),/does not replace a published client-page design/);
 assert.match(byId('design-client-pages'),/exact private preview.*both service pages/);
 assert.match(byId('design-client-pages'),/Saving a draft does not publish/);
 assert.match(byId('publish-client-pages'),/restore.*new private draft/i);
 assert.match(byId('publish-client-pages'),/existing client audience/);
 assert.match(byId('manage-content'),/user supplied.*exact idea revision/);
});

test('Skills is a shared sidebar entry with accessible static instructions and disclosure controls',()=>{
 const page=readFileSync(new URL('../src/pages/skills.astro',import.meta.url),'utf8');
 const sidebar=readFileSync(new URL('../src/components/Workspace.astro',import.meta.url),'utf8');
 const script=readFileSync(new URL('../src/scripts/skills.ts',import.meta.url),'utf8');
 assert.match(sidebar,/href="\/skills"/);
 assert.match(sidebar,/aria-current=\{isSkills \? "page"/);
 assert.match(page,/section="skills"/);
 assert.match(page,/label for="skills-setup-prompt"/);
 assert.match(page,/textarea[^>]+readonly[^>]*>\{buildSkillsSetupPrompt\(\)\}/);
 assert.match(page,/aria-live="polite"/);
 assert.match(page,/Use this skill/);
 assert.match(page,/Copying does not install anything/);
 assert.match(script,/bindPromptCopy/);
 assert.ok(!/\bpost\(|method:[ ]*["']POST/.test(script));
 assert.ok(!/innerHTML|eval\(|new Function/.test(script));
});
