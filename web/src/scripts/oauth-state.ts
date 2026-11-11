import {readClientPresentationRoute} from './client-presentation-state.ts';
export interface ConsentProposal {
 handle:string;
 client:{name:string;domain:string|null;redirectHost:string;isLoopback:boolean};
 tenant:{id:string;name:string};
 scopes:{id:string;label:string;selected:boolean}[];
 clients:{id:string;name:string;selected:boolean}[];
 expiresAt:string;
 consentExpiresAt:string;
 accessTokenExpiresInSeconds?:number;
 refreshEnabled?:boolean;
 connectionMode?:'bounded'|'ongoing';
 allClientsAllowed?:boolean;
 idleTimeoutSeconds?:number;
}
/** Fixed local pages only. OAuth parameters remain same-origin; no redirect_uri navigation here. */
export function safeSignInReturn(returnPath:string,origin:string):string {
 if(returnPath.length>8192||/[\\\u0000-\u001f\u007f]/.test(returnPath))throw new Error('Invalid sign-in return');
 const url=new URL(returnPath,origin);
 // Directory-form navigation is supported, but sign-in return and JSON API
 // requests always use the advertised endpoint without changing opaque query.
 if(url.pathname==='/project/')url.pathname='/project';
 if(url.pathname==='/authorize/')url.pathname='/authorize';
 if(url.pathname==='/client/')url.pathname='/client';
 if(url.pathname==='/connections/')url.pathname='/connections';
 if(url.origin!==origin||url.username||url.password||url.hash||!['/','/invite','/authorize','/admin','/project','/client','/connections'].includes(url.pathname)||returnPath.startsWith('//'))throw new Error('Invalid sign-in return');
 if(url.pathname==='/client'&&!readClientPresentationRoute(url.search))throw new Error('Unexpected client parameters');
 if(url.pathname==='/project'&&([...url.searchParams.keys()].some(key=>!['tenant','client','project','plugin'].includes(key))||!url.searchParams.get('client')||!url.searchParams.get('project')||['tenant','client','project','plugin'].some(key=>url.searchParams.getAll(key).length>1)||url.searchParams.has('plugin')&&!['seo','instagram'].includes(url.searchParams.get('plugin')!)))throw new Error('Unexpected project parameters');
 if(url.pathname!=='/authorize'&&url.pathname!=='/project'&&url.pathname!=='/client'&&url.search)throw new Error('Unexpected sign-in parameters');
 return url.href;
}
const allowedScopes=new Set(['mcp:connect','clients:read','offline_access','themes:read','themes:write','presentations:read','presentations:write','presentations:publish','projects:read','projects:write','metrics:read','metrics:write','content:read','content:write','clients:write']);
export function validProposal(value:ConsentProposal):boolean {
 if(value?.allClientsAllowed!==undefined&&typeof value.allClientsAllowed!=='boolean')return false;
 if(value?.connectionMode!==undefined&&!['bounded','ongoing'].includes(value.connectionMode))return false;
 if(value?.connectionMode==='ongoing'&&(value.refreshEnabled!==true||value.idleTimeoutSeconds!==2592000||!Array.isArray(value.scopes)||!value.scopes.some(s=>s.id==='offline_access')))return false;
 return Boolean(value&&typeof value.handle==='string'&&value.handle&&typeof value.client?.name==='string'&&(typeof value.client.domain==='string'||value.client.domain===null)&&typeof value.client.redirectHost==='string'&&typeof value.client.isLoopback==='boolean'&&typeof value.tenant?.name==='string'&&typeof value.tenant.id==='string'&&Number.isFinite(Date.parse(value.expiresAt))&&Number.isFinite(Date.parse(value.consentExpiresAt))&&Array.isArray(value.scopes)&&value.scopes.every(s=>typeof s.id==='string'&&allowedScopes.has(s.id)&&typeof s.label==='string'&&typeof s.selected==='boolean')&&new Set(value.scopes.map(s=>s.id)).size===value.scopes.length&&Array.isArray(value.clients)&&value.clients.every(c=>typeof c.id==='string'&&typeof c.name==='string'&&typeof c.selected==='boolean')&&new Set(value.clients.map(c=>c.id)).size===value.clients.length);
}
export function consentRedirect(destination:string,proposal:ConsentProposal):string {
 const url=new URL(destination);
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.host!==proposal.client.redirectHost||!(url.protocol==='https:'||(url.protocol==='http:'&&proposal.client.isLoopback&&loopback)))throw new Error('Invalid authorization return');
 return url.href;
}

export function defaultScopeSelected(scope:{id:string;selected:boolean}):boolean {
 return scope.selected&&(scope.id==='mcp:connect'||scope.id.endsWith(':read'));
}
