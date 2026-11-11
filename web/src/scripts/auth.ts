import {safeSignInReturn} from './oauth-state';
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
export async function mountSignIn(node:HTMLDivElement,returnPath:string,isCurrent:()=>boolean=()=>true){
 const returnUrl=safeSignInReturn(returnPath,location.origin);
 const clerk=await getClerk();
 if(!isCurrent()||clerk.session)return undefined;
 clerk.mountSignIn(node,{routing:'hash',forceRedirectUrl:returnUrl,signUpForceRedirectUrl:returnUrl,withSignUp:false,transferable:false,appearance:{variables:{colorBackground:'#171a1d',colorForeground:'#edf1f3',colorPrimary:'#8de0cd',colorPrimaryForeground:'#101214',colorNeutral:'#ffffff',colorMutedForeground:'#a0a9b2',colorInput:'#202428',colorInputForeground:'#edf1f3',borderRadius:'0.5rem'},elements:{footerAction:{display:'none'}}}});
 return ()=>clerk.unmountSignIn(node);
}
