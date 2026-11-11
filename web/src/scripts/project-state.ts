export type ProjectRoute={tenantId?:string;clientId:string;projectId:string};
export function readProjectRoute(search:string):ProjectRoute|null {
 const params=new URLSearchParams(search);const clientId=params.get('client'),projectId=params.get('project'),tenantId=params.get('tenant');
 if(!clientId||!projectId||['client','project','tenant'].some(key=>params.getAll(key).length>1))return null;
 return {clientId,projectId,...(tenantId?{tenantId}:{})};
}
export function projectReportPath(target:ProjectRoute,month:string,verifiedAdmin:boolean):string {
 const prefix=verifiedAdmin&&target.tenantId?`/api/admin/targets/${encodeURIComponent(target.tenantId)}`:'/api/targets';
 return `${prefix}/${encodeURIComponent(target.clientId)}/${encodeURIComponent(target.projectId)}/report?month=${encodeURIComponent(month)}`;
}
export interface InvitationPreview {invitationId:string;approvalDigest:string;preview:{recipient:string;clientId:string;projectId:string;target:{name:string};metricIds:string[];role:string;grantExpiresAt:string|null;inviteExpiresAt:string;subject:string;email:unknown;disclosure:unknown}}
export function canSendInvitation(preview:InvitationPreview|undefined,enabled:boolean,busy:boolean,approved:boolean):boolean {return !!preview&&!!preview.invitationId&&!!preview.approvalDigest&&enabled&&!busy&&approved;}

/** Closed reporting period, using UTC even around year and local-time boundaries. */
export function previousCompletedMonth(now:Date=new Date()):string {const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));return date.toISOString().slice(0,7);}
export function invitationStatus(invitation:{revoked_at:string|null;accepted_at:string|null;grant_expires_at:string|null;invite_expires_at:string;delivery_state:string},now:number=Date.now()):string {
 if(invitation.revoked_at)return 'Revoked';
 if(invitation.accepted_at)return invitation.grant_expires_at&&Date.parse(invitation.grant_expires_at)<=now?'Access expired':'Access accepted';
 // Pending delivery must remain explicit even when its acceptance link expires.
 if(invitation.delivery_state==='uncertain')return 'Delivery unconfirmed, do not resend';
 if(invitation.delivery_state==='sending')return 'Sending, outcome pending';
 if(Date.parse(invitation.invite_expires_at)<=now)return 'Invitation expired';
 if(invitation.delivery_state==='accepted')return 'Email accepted by provider, awaiting recipient';
 if(invitation.delivery_state==='prepared')return 'Prepared, no email sent';
 return 'Delivery status unavailable';
}
