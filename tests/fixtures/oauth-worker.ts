// Isolated test harness only. This file is never an application entrypoint.
import {serveMcp,type Env} from '../../src/index.ts';
import {authorizationServer,handleOAuthRoute,oauthMcpHandler,type OAuthEnv} from '../../src/oauth.ts';
const resource=oauthMcpHandler(async(request,env,ctx,principal)=>{
 if(new URL(request.url).searchParams.has('testPrincipal'))return Response.json({principal});
 const checkedEnv=request.headers.get('X-Test-Forbid-Business-DB')==='true'?{...env,DB:new Proxy(env.DB,{get(target,key){if(key==='prepare'||key==='batch'||key==='exec')return ()=>{throw new Error('Business database was touched before scope approval');};return Reflect.get(target,key);}})}:env;
 return serveMcp(request,checkedEnv as Env,ctx,principal);
});
export default {async fetch(request:Request,env:OAuthEnv,ctx:ExecutionContext) {
 const url=new URL(request.url);
 if(url.pathname==='/test/oversized-token'){
  const headers=new Headers({'Content-Type':'application/x-www-form-urlencoded'});
  if(url.searchParams.get('length')==='lie')headers.set('Content-Length','2');
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('code='+'x'.repeat(17000)));controller.close();}});
  return handleOAuthRoute(new Request('https://content.unreelviews.com/oauth/token',{method:'POST',headers,body}),env,ctx);
 }
 if(url.pathname==='/test/client')return Response.json(await authorizationServer.getOAuthApi(env).createClient({clientName:'Synthetic client',redirectUris:['https://client.test/callback'],tokenEndpointAuthMethod:'none',grantTypes:['authorization_code','refresh_token'],responseTypes:['code']}));
 if(url.pathname==='/mcp'||url.pathname.startsWith('/.well-known/oauth-protected-resource'))return resource.fetch(request,env,ctx);
 return (await handleOAuthRoute(request,env,ctx,async req=>req.headers.get('X-Test-Identity')==='owner'?{issuer:env.CLERK_ISSUER!,subject:'user_1',sessionId:'synthetic',email:'marco@hexacombllc.com'}:null))??new Response('Consent shell');
}};
