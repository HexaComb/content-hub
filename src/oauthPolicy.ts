import type {ConnectionMode} from './oauthLifetime.ts';
export type ClientAccessMode='selected'|'all';
export type AppPolicy={id:string;connection_mode:ConnectionMode;client_access_mode:ClientAccessMode;scopes_json:string;revoked_at:string|null};
/** A policy only applies to an exact registered app and never revives older grants. */
export async function appPolicy(db:D1Database,operatorId:string,clientId:string,policyId?:string|null):Promise<AppPolicy|null>{
 if(policyId===null)return null;
 const row=await db.prepare('SELECT id,connection_mode,client_access_mode,scopes_json,revoked_at FROM oauth_operator_app_policies WHERE operator_id=? AND oauth_client_id=? AND revoked_at IS NULL').bind(operatorId,clientId).first<AppPolicy>();
 return row&&!row.revoked_at&&(policyId===undefined||row.id===policyId)?row:null;
}
export function intersectPolicyScopes(operatorScopes:string[],policy:AppPolicy|null):string[]{
 if(!policy)return operatorScopes;
 const scopes:unknown=JSON.parse(policy.scopes_json);
 return Array.isArray(scopes)?operatorScopes.filter(s=>scopes.includes(s)):[];
}
