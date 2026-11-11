import test from 'node:test';
import assert from 'node:assert/strict';
import { adminAccessEnabled, getAdminSession, requireSuperAdmin, isSuperAdminEmail } from '../src/admin.ts';
import type { HumanIdentity } from '../src/humanAuth.ts';
import type { InvitationEnv } from '../src/mail.ts';

const env:InvitationEnv={DB:{} as D1Database,APP_ORIGIN:'https://reports.example.test',ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:'https://clerk.example.test',CLERK_PUBLISHABLE_KEY:'pk_test_'+Buffer.from('clerk.example.test$').toString('base64').replace(/=+$/,''),CLERK_SECRET_KEY:'sk_test_synthetic'};
const identity=(email:string):HumanIdentity=>({issuer:env.CLERK_ISSUER!,subject:'user_verified',sessionId:'sess_verified',email});

test('superadmin policy permits exactly two independently verified identities',()=>{
 assert.equal(adminAccessEnabled(env),true);
 for(const email of ['christian@unreelviews.com','marco@hexacombllc.com',' CHRISTIAN@UNREELVIEWS.COM ']) {
  assert.equal(isSuperAdminEmail(email),true);
  assert.deepEqual(getAdminSession(identity(email),env),{email:email.trim().toLowerCase(),role:'super_admin'});
  assert.deepEqual(requireSuperAdmin(identity(email),env),{email:email.trim().toLowerCase(),role:'super_admin'});
 }
 for(const email of ['viewer@example.test','christian+alias@unreelviews.com','mar.co@hexacombllc.com','marco@hexacombllc.com.evil.test','christian@unreelviews.com@evil.test']) {
  assert.equal(isSuperAdminEmail(email),false);
  assert.equal(getAdminSession(identity(email),env),null);
  assert.throws(()=>requireSuperAdmin(identity(email),env));
 }
 assert.equal(getAdminSession({...identity('christian@unreelviews.com'),issuer:'https://other.example.test'},env),null);
 assert.equal(getAdminSession(null,env),null);
 assert.throws(()=>requireSuperAdmin(null,env));
 // A viewer identity never inherits authority from caller-supplied role metadata.
 assert.equal(getAdminSession({...identity('viewer@example.test'),role:'super_admin'} as HumanIdentity,env),null);
});

test('administrator gate and Clerk configuration fail closed independently of Resend',()=>{
 const missing:InvitationEnv[]=[
  {...env,ADMIN_ACCESS_ENABLED:undefined},{...env,ADMIN_ACCESS_ENABLED:'false'},
  {...env,CLERK_AUTH_ENABLED:undefined},{...env,CLERK_AUTH_ENABLED:'false'},
  {...env,CLERK_ISSUER:undefined},{...env,CLERK_ISSUER:'http://clerk.example.test'},
  {...env,CLERK_ISSUER:'https://clerk.example.test/path'},
  {...env,CLERK_PUBLISHABLE_KEY:undefined},{...env,CLERK_SECRET_KEY:undefined},
  {...env,APP_ORIGIN:undefined},{...env,APP_ORIGIN:'http://reports.example.test'},
 ];
 for(const config of missing) {
  assert.equal(adminAccessEnabled(config),false);
  assert.equal(getAdminSession(identity('christian@unreelviews.com'),config),null);
  assert.throws(()=>requireSuperAdmin(identity('christian@unreelviews.com'),config));
 }
 // Resend transports invitations only; it is not the login or administrator gate.
 assert.equal(adminAccessEnabled({...env,INVITATIONS_ENABLED:'false',RESEND_FROM:undefined,RESEND_API_KEY:undefined}),true);
 const verified=identity('marco@hexacombllc.com');
 assert.equal(getAdminSession(verified,{...env,ADMIN_ACCESS_ENABLED:'false'}),null);
 assert.deepEqual(getAdminSession(verified,env),{email:'marco@hexacombllc.com',role:'super_admin'});
});
