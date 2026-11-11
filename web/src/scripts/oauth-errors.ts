import {verificationMessage} from './access-state.ts';
/** Permission failures must not be mislabeled as broken human authentication. */
export function consentFailureMessage(status:number):string|null {
 if(status===401)return verificationMessage;
 if(status===403)return 'This account cannot approve this connection. Its workspace authorization may be missing or expired, or the requested permissions are not allowed. Ask your workspace administrator to check access, then restart the connection.';
 if(status===503)return 'Connections are not configured yet. Ask your workspace administrator to finish setting up MCP authorization.';
 if([400,404,409,410].includes(status))return 'This connection request is invalid, expired, or already used. Return to the requesting application and start a new connection.';
 return null;
}
