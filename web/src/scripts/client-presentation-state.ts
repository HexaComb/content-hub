import type {PresentationDocument} from '../../../src/presentationSchema.ts';
import type {Report} from './types';

export interface ClientPresentationRoute {clientId:string;projectId:string;tenantId?:string;preview?:number;month?:string}
export interface PresentationReport extends Report {presentation:{revision:number;document:PresentationDocument|null;mode:'published'|'default'|'preview'}}
export interface PresentationState {revision:number;draftRevision:number|null;publishedRevision:number|null;isDraftPublished:boolean;history:{revision:number;operation:string;createdAt:string}[];draft:PresentationDocument|null;published:PresentationDocument|null}
const validId=(value:string|null):value is string=>!!value&&value.length<=100&&/^[a-zA-Z0-9_.:-]+$/.test(value);
export const validPresentationMonth=(value:string)=>/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
/** A URL selects a target, never an identity or a permission. Reject ambiguity. */
export function readClientPresentationRoute(search:string):ClientPresentationRoute|null {
 if(search.length>2048)return null;
 const params=new URLSearchParams(search),keys=['client','project','tenant','preview','month'];
 if([...params.keys()].some(key=>!keys.includes(key))||keys.some(key=>params.getAll(key).length>1))return null;
 const clientId=params.get('client'),projectId=params.get('project'),tenantId=params.get('tenant'),preview=params.get('preview'),month=params.get('month');
 if(!validId(clientId)||!validId(projectId)||params.has('tenant')&&!validId(tenantId)||params.has('month')&&(!month||!validPresentationMonth(month)))return null;
 if(params.has('preview')&&(!tenantId||!preview||!/^[1-9]\d{0,15}$/.test(preview)||!Number.isSafeInteger(Number(preview))))return null;
 return {clientId,projectId,...(tenantId?{tenantId}:{}),...(preview?{preview:Number(preview)}:{}),...(month?{month}:{})};
}
export function clientPresentationPagePath(route:ClientPresentationRoute):string {
 const query=new URLSearchParams({client:route.clientId,project:route.projectId});
 if(route.tenantId)query.set('tenant',route.tenantId);
 if(route.preview!==undefined)query.set('preview',String(route.preview));
 if(route.month)query.set('month',route.month);
 if(!readClientPresentationRoute(query.toString()))throw new Error('Invalid client page target.');
 return `/client?${query}`;
}
export function clientPresentationBasePath(route:ClientPresentationRoute,verifiedAdmin:boolean):string {
 if(route.tenantId&&!verifiedAdmin)throw new Error('Administrator verification required.');
 const prefix=route.tenantId?`/api/admin/targets/${encodeURIComponent(route.tenantId)}`:'/api/targets';
 return `${prefix}/${encodeURIComponent(route.clientId)}/${encodeURIComponent(route.projectId)}`;
}
export function clientPresentationApiPath(route:ClientPresentationRoute,month:string,verifiedAdmin:boolean):string {
 if(!validPresentationMonth(month))throw new Error('Invalid report month.');
 if(route.preview!==undefined&&!route.tenantId)throw new Error('Private preview requires administrator access.');
 const query=new URLSearchParams({month});if(route.preview!==undefined)query.set('revision',String(route.preview));
 return `${clientPresentationBasePath(route,verifiedAdmin)}/presentation?${query}`;
}
export type PresentationMutation={operation:'publish'|'restore';body:Readonly<{expectedRevision:number;sourceRevision:number;idempotencyKey:string}>};
/** Retain this exact object after an interrupted request. Never mint a key to retry. */
export function presentationMutation(operation:PresentationMutation['operation'],state:PresentationState,sourceRevision:number,key:string):PresentationMutation {
 if(!Number.isSafeInteger(state.revision)||state.revision<0||!Number.isSafeInteger(sourceRevision)||sourceRevision<1||key.length<8||key.length>120)throw new Error('Invalid presentation revision.');
 if(operation==='publish'&&state.draftRevision!==sourceRevision)throw new Error('Only the exact current draft can be published.');
 if(operation==='restore'&&!state.history.some(item=>item.revision===sourceRevision))throw new Error('Choose a saved revision.');
 return {operation,body:Object.freeze({expectedRevision:state.revision,sourceRevision,idempotencyKey:key})};
}
/** Monotonic tickets protect every async view, even if cancellation arrives too late. */
export function presentationRequestGuard(){let generation=0;return {begin:()=>++generation,invalidate:()=>{generation++;},current:(ticket:number)=>ticket===generation};}
