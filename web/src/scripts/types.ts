import type { ProjectThemeState } from '../../../src/themeSchema';
export interface Target {tenantId?:string;clientName?:string;timezone?:string;clientId:string; projectId:string; name:string; kind:string; platformAccountRef?:string|null; status:string}
export interface Reading {value:number|null; quality:string; collectedAt?:string; provider?:string}
export interface Metric {id:string;key:string;label:string;unit:string;direction:string;current:Reading|null;previous:Reading|null;delta:number|null;relativePercent:number|null;percentagePoints:number|null;change:string;reason:string|null}
export interface Report {appearance?:ProjectThemeState;target:Target;month:string;previousMonth:string;metrics:Metric[]}
