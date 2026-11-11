import type {CallToolResult,ToolAnnotations,McpServer,Tool} from '@modelcontextprotocol/server';
import {z} from 'zod';
import type {Principal} from './auth.ts';

const RESOURCE_METADATA='https://content.unreelviews.com/.well-known/oauth-protected-resource/mcp';
export const TOOL_SCOPES:Record<string,string>={
 list_clients:'clients:read',create_client:'clients:write',update_client:'clients:write',
 list_projects:'projects:read',create_project:'projects:write',update_project:'projects:write',
 list_metrics:'metrics:read',get_observation:'metrics:read',compare_month:'metrics:read',define_metric:'metrics:write',record_observation:'metrics:write',
 list_content:'content:read',get_content:'content:read',create_content:'content:write',update_content:'content:write',link_content_metric:'content:write',
 approve_content:'content:approve',schedule_content:'content:schedule',cancel_content:'content:schedule',record_publication_receipt:'content:receipt',
 prepare_invitation:'invitations:manage',list_invitations:'invitations:manage',revoke_invitation:'invitations:manage',send_invitation:'invitations:send',
};
export function scopeChallenge(required:string[]):CallToolResult {
 // Every value is server-owned, never from a caption, tool argument or client URL.
 const challenge=`Bearer error="insufficient_scope", error_description="Approve the required Content Hub permissions to use this tool.", scope="${required.join(' ')}", resource_metadata="${RESOURCE_METADATA}"`;
 return {isError:true,content:[{type:'text',text:'Additional permission is required. Review and approve the requested access to continue.'}],_meta:{'mcp/www_authenticate':[challenge]}};
}
/** Registration keeps discovery and execution authorization separate. The caller
 * has already resolved current operator policy; this closure cannot expand it. */
export function oauthToolRegistrar(server:McpServer,principal:Principal) {
 const definitions:(Tool & {securitySchemes: {type:string;scopes:string[]}[]})[]=[];
 function registerTool<S extends z.ZodType=z.ZodObject<{}>>(name:string,config:{description:string;inputSchema?:S;annotations:ToolAnnotations},callback:(input:z.output<S>)=>Promise<CallToolResult>) {
  const scope=TOOL_SCOPES[name];
  if(!scope)throw new Error('Tool has no declared authorization policy.');
  const oauth=!!principal.oauthOperatorId;
  const required=['mcp:connect',scope];
  if(oauth && !principal.oauthEligibleScopes?.includes(scope))return;
  const securitySchemes=[{type:'oauth2',scopes:required}];
  const schema=config.inputSchema??z.object({});
  const meta=oauth?{securitySchemes}:undefined;
  server.registerTool(name,{...config,inputSchema:schema,_meta:meta},async (args:unknown)=>{
   // The check precedes every business callback, including read-only list_clients.
   if(oauth && required.some(s=>!principal.scopes.includes(s)))return scopeChallenge(required);
   return callback(args as z.output<S>);
  });
  if(oauth)definitions.push({name,description:config.description,inputSchema:z.toJSONSchema(schema,{io:'input'}) as Tool['inputSchema'],annotations:config.annotations,securitySchemes,_meta:meta});
 }
 function finish(){
  if(principal.oauthOperatorId) {
   // SDK2.4 currently drops the non-core top-level securitySchemes property.
   // Serve equivalent registered schemas plus the supported OAuth extension and
   // its _meta mirror, without changing legacy service-token discovery.
   server.server.setRequestHandler('tools/list',()=>({tools:definitions}));
  }
 }
 return {registerTool,finish};
}
