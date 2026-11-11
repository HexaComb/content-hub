import type {ProjectRoute} from './project-state';
import {knownMetricPlugin,metricAllowedForPlugin} from '../../../src/pluginMetrics.ts';
export {metricAllowedForPlugin};
export type PluginKey='seo'|'instagram';
export interface ProjectPlugin {key:PluginKey;enabled:boolean;revision:number;metricIds:string[];updatedAt?:string|null}
export const pluginCatalog={
 seo:{name:'SEO',description:'Search visibility, traffic and rankings. A dedicated home for your project’s search metrics.',short:'Search performance',symbol:'↗'},
 instagram:{name:'Instagram',description:'Reels, posts and account performance. Keep stored content and results together.',short:'Reels, posts & performance',symbol:'◎'},
} as const;
export function readPluginKey(search:string):PluginKey|null|'invalid' {
 const params=new URLSearchParams(search),values=params.getAll('plugin');
 if(!values.length)return null;
 return values.length===1&&(values[0]==='seo'||values[0]==='instagram')?values[0]:'invalid';
}
export function pluginPagePath(target:ProjectRoute,key?:PluginKey):string {
 const params=new URLSearchParams({...target.tenantId?{tenant:target.tenantId}:{},client:target.clientId,project:target.projectId,...key?{plugin:key}:{}});
 return '/project?'+params;
}
export function pluginApiPath(target:ProjectRoute,admin:boolean):string {
 return (admin&&target.tenantId?`/api/admin/targets/${encodeURIComponent(target.tenantId)}`:'/api/targets')+`/${encodeURIComponent(target.clientId)}/${encodeURIComponent(target.projectId)}/plugins`;
}
export function suggestedMetricIds(key:PluginKey,metrics:{id:string;key:string}[]):string[] {
 // Suggestions are reviewed in the form. They never alter stored associations by themselves.
 return metrics.filter(metric=>knownMetricPlugin(metric.key)===key).map(metric=>metric.id);
}

/** A project home is a chooser, never an implicit combined report. */
export function dashboardViewState(projectPage:boolean,selected:PluginKey|null,enabled:boolean,metricCount:number){
 const report=!projectPage||(selected!==null&&enabled);
 return {report,comparisons:report&&metricCount>0};
}
