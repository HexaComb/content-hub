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
}
/** Fixed local pages only. OAuth parameters remain same-origin; no redirect_uri navigation here. */
export function safeSignInReturn(returnPath:string,origin:string):string {
 const url=new URL(returnPath,origin);
 // Directory-form navigation is supported, but sign-in return and JSON API
 // requests always use the advertised endpoint without changing opaque query.
 if(url.pathname==='/authorize/')url.pathname='/authorize';
 if(url.origin!==origin||url.hash||!['/','/invite','/authorize','/admin'].includes(url.pathname)||returnPath.startsWith('//'))throw new Error('Invalid sign-in return');
 if(url.pathname!=='/authorize'&&url.search)throw new Error('Unexpected sign-in parameters');
 return url.href;
}
const allowedScopes=new Set(['mcp:connect','clients:read','offline_access','themes:read','themes:write','projects:read','projects:write','metrics:read','metrics:write','content:read','content:write','clients:write']);
export function validProposal(value:ConsentProposal):boolean {
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
