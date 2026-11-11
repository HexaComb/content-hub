import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {consentFailureMessage} from '../src/scripts/oauth-errors.ts';
import {verificationMessage} from '../src/scripts/access-state.ts';
test('OAuth authorization rejection is distinct from identity verification failure',()=>{
 assert.equal(consentFailureMessage(401),verificationMessage);
 const denied=consentFailureMessage(403)!;
 assert.match(denied,/workspace authorization may be missing or expired/);
 assert.match(denied,/requested permissions are not allowed/);
 assert.doesNotMatch(denied,/could not verify|sign out|Clerk/i);
 assert.notEqual(denied,verificationMessage);
});
test('OAuth request and setup failures retain safe recovery without raw errors',()=>{
 for(const status of [400,404,409,410])assert.match(consentFailureMessage(status)!,/start a new connection/);
 assert.match(consentFailureMessage(503)!,/finish setting up MCP authorization/);
 for(const status of [200,429,500])assert.equal(consentFailureMessage(status),null);
});
test('consent UI uses status-only recovery without exposing server error strings',async()=>{
 const ui=await readFile(new URL('../src/scripts/authorize.ts',import.meta.url),'utf8');
 assert.match(ui,/consentFailureMessage\(error.status\)/);
 assert.doesNotMatch(ui,/\[401,403\]\.includes\(error.status\)/);
});
