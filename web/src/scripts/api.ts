import {getClerk,AuthUnavailable} from './auth';
export class ApiError extends Error { constructor(public status:number) { super(status === 401 ? 'Your session has ended. Sign in again to continue.' : status === 403 || status === 404 ? 'This project is no longer available to you. Ask your administrator to check your access.' : status === 503 ? 'Sign-in is currently unavailable. Ask your administrator to finish setting up secure access.' : status === 429 ? 'Too many attempts. Please wait a little before trying again.' : 'We couldn’t complete that request. Please try again.'); } }
export async function api<T>(path:string, options:RequestInit={}):Promise<T> {
 if(!path.startsWith('/api/')||path.startsWith('//'))throw new Error('API requests must stay on this origin.');
 const clerk=await getClerk();
 const token=await clerk.session?.getToken();
 const headers=new Headers(options.headers);headers.set('Content-Type','application/json');headers.set('Accept','application/json');headers.delete('Authorization');
 if(token)headers.set('Authorization',`Bearer ${token}`);
 const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',headers});
 if(!response.ok) throw new ApiError(response.status);
 return response.status === 204 ? undefined as T : response.json();
}
export const post=<T>(path:string,body:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export function message(error:unknown) { return error instanceof ApiError || error instanceof AuthUnavailable ? error.message : 'Connection interrupted. Check your connection and try again.'; }
