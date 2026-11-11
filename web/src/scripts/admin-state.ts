export type AdminTarget={tenantId:string;clientId:string;projectId:string;name:string;kind:string;platformAccountRef:string|null;status:string};
export type AdminOverview={session:{email:string;role:'super_admin'};counts:{clients:number;projects:number;workspaces:number};entries:{tenantId:string;workspaceName:string;clientId:string;clientName:string;timezone:string;project:AdminTarget|null}[];nextOffset:number|null};
export function adminEmptyMessage(counts:AdminOverview['counts']):string {
 return counts.clients===0?'No clients or projects yet. Your administrator access is ready. Create your first client and project through authorized MCP tools.':counts.projects===0?'No projects yet. Your clients are listed below. Add projects through authorized MCP tools.':'';
}
export function adminReportPath(target:AdminTarget,month:string):string {
 return `/api/admin/targets/${[target.tenantId,target.clientId,target.projectId].map(encodeURIComponent).join('/')}/report?month=${encodeURIComponent(month)}`;
}
