import type {Clerk} from '@clerk/clerk-js';
import {validateAuthConfig,type AuthConfig} from './auth-config';
export class AuthUnavailable extends Error {constructor(){super('Secure sign-in is unavailable. Ask your workspace administrator to check the Clerk configuration, then try again.');}}
let pending:Promise<Clerk>|undefined;
export async function getClerk():Promise<Clerk>{
 if(!pending)pending=(async()=>{
  const response=await fetch('/api/auth/config',{cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw new AuthUnavailable();
  const config=validateAuthConfig(await response.json() as AuthConfig);
  // Bundle the supported Core 3 UI export locally. No CDN script injection or embedded keys.
  const [{Clerk},{ui}]=await Promise.all([import('@clerk/clerk-js'),import('@clerk/ui')]);
  const clerk=new Clerk(config.publishableKey);
  await clerk.load({ui,telemetry:{disabled:true}});
  return clerk;
 })().catch(()=>{pending=undefined;throw new AuthUnavailable();});
 return pending;
}
export async function mountSignIn(node:HTMLDivElement,returnPath:'/'|'/invite'){
 const clerk=await getClerk();
 clerk.mountSignIn(node,{routing:'hash',forceRedirectUrl:location.origin+returnPath,signUpForceRedirectUrl:location.origin+returnPath,withSignUp:false,transferable:false,appearance:{elements:{footerAction:{display:'none'}}}});
 return ()=>clerk.unmountSignIn(node);
}
