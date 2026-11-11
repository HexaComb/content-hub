import test from 'node:test';
import assert from 'node:assert/strict';
import { __experimental_JWTPayloadToAuthObjectProperties as parseClerkClaims } from '@clerk/shared/jwtPayloadParser';
import { clerkAuthConfigured, getHumanIdentity, type HumanAuthAdapter } from '../src/humanAuth.ts';
import { getAdminSession } from '../src/admin.ts';
import type { InvitationEnv } from '../src/mail.ts';

const env:InvitationEnv={DB:{} as D1Database,APP_ORIGIN:'https://reports.example.test',ADMIN_ACCESS_ENABLED:'true',CLERK_AUTH_ENABLED:'true',CLERK_ISSUER:'https://clerk.example.test',CLERK_PUBLISHABLE_KEY:'pk_test_'+Buffer.from('clerk.example.test$').toString('base64').replace(/=+$/,''),CLERK_SECRET_KEY:'sk_test_synthetic'};
const request=new Request(env.APP_ORIGIN+'/api/session');
const claims=()=>({userId:'user_verified',sessionId:'sess_verified',sessionStatus:'active',sessionClaims:{iss:env.CLERK_ISSUER}});
const session=()=>({id:'sess_verified',userId:'user_verified',status:'active',expireAt:Date.now()+3600000,abandonAt:Date.now()+3600000,actor:null});
const user=()=>({id:'user_verified',banned:false,locked:false,primaryEmailAddress:{emailAddress:' CHRISTIAN@UNREELVIEWS.COM ',verification:{status:'verified'}}});
function adapter(overrides:Partial<HumanAuthAdapter>={}):HumanAuthAdapter {
 return {async authenticate(){return {isAuthenticated:true,status:'signed-in',toAuth:claims};},async getSession(){return session();},async getUser(){return user();},...overrides};
}
const denied=async(mock:HumanAuthAdapter)=>assert.equal(await getHumanIdentity(request,env,mock),null);

test('Clerk human resolver verifies session token, issuer, party and current primary email',async()=>{
 const calls:string[]=[];
 const mock=adapter({async authenticate(received,options){assert.equal(received,request);assert.deepEqual(options,{acceptsToken:'session_token',authorizedParties:[env.APP_ORIGIN],issuer:env.CLERK_ISSUER});calls.push('verify');return {isAuthenticated:true,status:'signed-in',toAuth:claims};},async getSession(id){assert.equal(id,'sess_verified');calls.push('session');return session();},async getUser(id){assert.equal(id,'user_verified');calls.push('user');return user();}});
 const identity=await getHumanIdentity(request,env,mock);
 assert.deepEqual(identity,{issuer:env.CLERK_ISSUER,subject:'user_verified',sessionId:'sess_verified',email:'christian@unreelviews.com'});
 assert.ok(Object.isFrozen(identity));assert.deepEqual(calls,['verify','session','user']);
 assert.deepEqual(getAdminSession(identity,env),{email:'christian@unreelviews.com',role:'super_admin'});
 assert.ok(!JSON.stringify(identity).includes('synthetic'));
 const viewer=await getHumanIdentity(request,env,adapter({async getUser(){return {...user(),primaryEmailAddress:{emailAddress:'viewer@example.test',verification:{status:'verified'}}};}}));
 assert.ok(viewer);assert.equal(getAdminSession(viewer,env),null);
});

test('Clerk human resolver rejects unsigned, pending, revoked and mismatched identity',async()=>{
 for(const state of [{isAuthenticated:false,status:'signed-out'},{isAuthenticated:false,status:'handshake'},{isAuthenticated:true,status:'handshake'}])await denied(adapter({async authenticate(){return {...state,toAuth:claims};}}));
 for(const auth of [{...claims(),userId:null},{...claims(),sessionId:null},{...claims(),sessionStatus:'pending'},{...claims(),sessionClaims:{iss:'https://evil.example.test'}},{...claims(),sessionClaims:null},{...claims(),actor:{sub:'impersonator'}},{...claims(),sessionClaims:{iss:env.CLERK_ISSUER,act:{sub:'impersonator'}}}])await denied(adapter({async authenticate(){return {isAuthenticated:true,status:'signed-in',toAuth:()=>auth};}}));
 for(const row of [{...session(),id:'other_session'},{...session(),userId:'other_user'},{...session(),status:'revoked'},{...session(),status:'expired'},{...session(),expireAt:0},{...session(),abandonAt:0},{...session(),expireAt:NaN},{...session(),actor:{sub:'impersonator'}}])await denied(adapter({async getSession(){return row;}}));
 for(const row of [{...user(),banned:true},{...user(),locked:true},{...user(),id:'other_user'},{...user(),primaryEmailAddress:null},{...user(),primaryEmailAddress:{emailAddress:'christian@unreelviews.com',verification:null}},{...user(),primaryEmailAddress:{emailAddress:'christian@unreelviews.com',verification:{status:'unverified'}}},{...user(),primaryEmailAddress:{emailAddress:'not-an-email',verification:{status:'verified'}}}])await denied(adapter({async getUser(){return row;}}));
});

test('No client headers, legacy cookies or asserted roles can establish a Clerk identity',async()=>{
 const forged=new Request(env.APP_ORIGIN+'/api/session?email=christian@unreelviews.com&role=super_admin',{headers:{Authorization:'Bearer forged-token',Cookie:'__Host-ch_session='+'a'.repeat(43),'X-User-Email':'christian@unreelviews.com','X-Role':'super_admin'}});
 let userReads=0;
 const result=await getHumanIdentity(forged,env,adapter({async authenticate(received){assert.equal(received,forged);return {isAuthenticated:false,status:'signed-out',toAuth:claims};},async getUser(){userReads++;return user();}}));
 assert.equal(result,null);assert.equal(userReads,0);assert.equal(getAdminSession(result,env),null);
});

test('Clerk configuration and provider errors fail closed without exposing secrets',async()=>{
 let calls=0;
 const mock=adapter({async authenticate(){calls++;throw Error('synthetic-provider-secret');}});
 assert.equal(clerkAuthConfigured(env),true);
 assert.equal(await getHumanIdentity(request,{...env,CLERK_AUTH_ENABLED:'false'},mock),null);assert.equal(calls,0);
 for(const config of [{...env,CLERK_PUBLISHABLE_KEY:'pk_test_synthetic'},{...env,CLERK_ISSUER:'https://other.example.test'},{...env,CLERK_SECRET_KEY:undefined},{...env,CLERK_PUBLISHABLE_KEY:undefined},{...env,CLERK_ISSUER:'https://clerk.example.test/path'},{...env,CLERK_ISSUER:'http://clerk.example.test'},{...env,APP_ORIGIN:undefined}]) {
  assert.equal(clerkAuthConfigured(config),false);
  await assert.rejects(getHumanIdentity(request,config,mock),error=>error instanceof Error && error.message==='Authentication unavailable.');
 }
 assert.equal(calls,0);
 for(const failure of [mock,adapter({async getSession(){throw Error('synthetic-provider-secret');}}),adapter({async getUser(){throw Error('synthetic-provider-secret');}})])await assert.rejects(getHumanIdentity(request,env,failure),error=>error instanceof Error && error.message==='Authentication unavailable.');
});


test('Clerk SDK optional sts conversion accepts only an independently active live session',async()=>{
 // Plain synthetic claim data, not a signed JWT or credential. Exercise the
 // installed official SDK parser, while authentication remains an explicit mock.
 const seconds=Math.floor(Date.now()/1000);
 const payload={v:2 as const,__raw:'',iss:env.CLERK_ISSUER!,sub:'user_verified',sid:'sess_verified',azp:env.APP_ORIGIN,nbf:seconds-1,iat:seconds-1,exp:seconds+60};
 const parsed=parseClerkClaims(payload);
 assert.equal(parsed.sessionStatus,null);
 for(const auth of [parsed,{...parsed,sessionStatus:undefined},parseClerkClaims({...payload,sts:'active'})]){
  const reads:string[]=[];
  const mock=adapter({async authenticate(){return {isAuthenticated:true,status:'signed-in',toAuth:()=>auth};},async getSession(){reads.push('live session');return session();},async getUser(){reads.push('verified primary email');return user();}});
  const identity=await getHumanIdentity(request,env,mock);
  assert.ok(identity);assert.deepEqual(reads,['live session','verified primary email']);
  assert.equal(getAdminSession(identity,env)?.role,'super_admin');
  for(const live of [{...session(),status:'revoked'},{...session(),status:'pending'},{...session(),status:'expired'},{...session(),expireAt:0},{...session(),userId:'other_user'}]){
   let userRead=false;
   await denied({...mock,async getSession(){return live;},async getUser(){userRead=true;return user();}});
   assert.equal(userRead,false);
  }
  await denied({...mock,async authenticate(){return {isAuthenticated:false,status:'signed-out',toAuth:()=>auth};}});
  await denied({...mock,async getUser(){return {...user(),primaryEmailAddress:{emailAddress:'christian@unreelviews.com',verification:{status:'unverified'}}};}});
 }
 const pending=parseClerkClaims({...payload,sts:'pending'});
 for(const status of [pending.sessionStatus,'revoked','expired','', 'unknown']){
  let reads=0;
  await denied(adapter({async authenticate(){return {isAuthenticated:true,status:'signed-in',toAuth:()=>({...parsed,sessionStatus:status})};},async getSession(){reads++;return session();}}));
  assert.equal(reads,0);
 }
});

test('Canonical custom-domain auth passes one exact authorized party and rejects legacy or unrelated parties',async()=>{
 const canonicalEnv={...env,APP_ORIGIN:'https://content.unreelviews.com',ADMIN_ACCESS_ENABLED:'false',INVITATIONS_ENABLED:'false'};
 const incoming=new Request(canonicalEnv.APP_ORIGIN+'/api/session',{headers:{'X-Forwarded-Host':'unrelated.example.test','X-Forwarded-Proto':'http'}});
 for(const party of [canonicalEnv.APP_ORIGIN,'https://www.content.unreelviews.com','https://content-hub.marcode-chavez-jr.workers.dev','https://unrelated.example.test','http://content.unreelviews.com','https://content.unreelviews.com.evil.example.test']){
  let sessionReads=0;
  const identity=await getHumanIdentity(incoming,canonicalEnv,adapter({
   async authenticate(received,options){
    assert.equal(received,incoming);
    // Model the SDK's authorizedParties contract without signing a JWT or
    // accessing any real account. Host/forwarding headers cannot expand it.
    assert.deepEqual(options,{acceptsToken:'session_token',authorizedParties:[canonicalEnv.APP_ORIGIN],issuer:canonicalEnv.CLERK_ISSUER});
    const authorized=options.authorizedParties.includes(party);
    return {isAuthenticated:authorized,status:authorized?'signed-in':'signed-out',toAuth:claims};
   },
   async getSession(){sessionReads++;return session();},
  }));
  if(party===canonicalEnv.APP_ORIGIN){assert.ok(identity);assert.equal(sessionReads,1);assert.equal(getAdminSession(identity,canonicalEnv),null);}
  else{assert.equal(identity,null);assert.equal(sessionReads,0);}
 }
});
