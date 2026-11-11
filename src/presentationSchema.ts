import { z } from 'zod';
import { id } from './schemas.ts';
import { projectThemeSchema, themePresets, type ProjectTheme } from './themeSchema.ts';

const nodeId=z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const space=z.enum(['tight','normal','generous']);
const children=z.array(nodeId).min(1).max(12);
const page=z.enum(['shared','seo','instagram']).optional();
export type PresentationPlugin='seo'|'instagram';
export const presentationNodeSchema=z.discriminatedUnion('type',[
 z.object({id:nodeId,page,type:z.literal('band'),tone:z.enum(['page','surface','raised','accent']),space,children}).strict(),
 z.object({id:nodeId,page,type:z.literal('stack'),gap:space,align:z.enum(['left','center','right']),children}).strict(),
 z.object({id:nodeId,page,type:z.literal('grid'),split:z.enum(['equal','wide-left','wide-right','thirds']),gap:space,children:z.array(nodeId).min(2).max(3)}).strict(),
 z.object({id:nodeId,page,type:z.literal('text'),role:z.enum(['eyebrow','title','heading','body','caption']),text:z.string().max(1000)}).strict(),
 z.object({id:nodeId,page,type:z.literal('divider'),style:z.enum(['line','stripes','checker'])}).strict(),
 z.object({id:nodeId,page,type:z.literal('metric'),metricId:id,variant:z.enum(['statement','stat','inline'])}).strict(),
 z.object({id:nodeId,page,type:z.literal('comparison'),metricIds:z.array(id).max(8).refine(v=>new Set(v).size===v.length,'Metric references must be unique.')}).strict(),
 z.object({id:nodeId,page,type:z.literal('metric_collection'),variant:z.enum(['stat','inline'])}).strict(),
]);
export type PresentationNode=z.infer<typeof presentationNodeSchema>;
/** Flat references keep input parsing bounded. The tree is validated, never evaluated. */
export const presentationDocumentSchema=z.object({
 schemaVersion:z.literal(1),name:z.string().trim().min(1).max(80),theme:projectThemeSchema,
 width:z.enum(['reading','wide','edge']),sections:z.array(nodeId).min(1).max(12),nodes:z.array(presentationNodeSchema).min(1).max(80),
}).strict().superRefine((doc,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:'custom',message});
 if(new TextEncoder().encode(JSON.stringify(doc)).length>48000)issue('Presentation must fit within 48 KiB.');
 const nodes=new Map(doc.nodes.map(n=>[n.id,n]));
 if(nodes.size!==doc.nodes.length)issue('Node IDs must be unique.');
 const seen=new Set<string>(),pending=doc.sections.map(id=>({id,depth:1}));let expanded=0;
 while(pending.length){const item=pending.pop()!;if(seen.has(item.id)){issue('Each node must appear once; cycles and reused nodes are not allowed.');continue;}seen.add(item.id);
  const node=nodes.get(item.id);if(!node){issue('A section or child references a missing node.');continue;}
  if(item.depth>6){issue('Composition depth cannot exceed six levels.');continue;}
  if(node.type==='band'&&item.depth!==1)issue('Color bands must be top-level sections.');
  if(node.type==='metric_collection')expanded+=200;else if(node.type==='metric')expanded++;else if(node.type==='comparison')expanded+=node.metricIds.length;
  if('children' in node)node.children.forEach(id=>pending.push({id,depth:item.depth+1}));
 }
 if(seen.size!==nodes.size)issue('Every node must belong to the page.');
 if(expanded>400)issue('Composition exceeds the report-block budget (400).');
});
export type PresentationDocument=z.infer<typeof presentationDocumentSchema>;
export function defaultPresentation(theme:ProjectTheme=themePresets.studio):PresentationDocument {
 return {schemaVersion:1,name:'Client report',theme,width:'wide',sections:['intro','facts'],nodes:[
  {id:'intro',type:'band',tone:'page',space:'generous',children:['eyebrow','title','tagline']},
  {id:'eyebrow',type:'text',role:'eyebrow',text:theme.brand.eyebrow||'YOUR MONTH IN FOCUS'},
  {id:'title',type:'text',role:'title',text:'The story in your numbers.'},
  {id:'tagline',type:'text',role:'body',text:theme.brand.tagline},
  {id:'facts',type:'band',tone:'surface',space:'generous',children:['all-metrics']},
  {id:'all-metrics',type:'metric_collection',variant:'stat'},
 ]};
}
export function presentationMetricIds(doc:PresentationDocument):string[]{return [...new Set(doc.nodes.flatMap(n=>n.type==='metric'?[n.metricId]:n.type==='comparison'?n.metricIds:[]))];}
/** Project one shared design into a page without fetching or exposing excluded data.
 * Missing page markers mean shared, keeping all stored version-one designs valid. */
export function filterPresentation(doc:PresentationDocument,allowed:Set<string>,plugin?:PresentationPlugin):PresentationDocument {
 if(!plugin)return {...doc,nodes:doc.nodes.map(n=>n.type==='metric'&&!allowed.has(n.metricId)?{id:n.id,type:'comparison' as const,metricIds:[]}:n.type==='comparison'?{...n,metricIds:n.metricIds.filter(id=>allowed.has(id))}:n)};
 const byId=new Map(doc.nodes.map(n=>[n.id,n])),nodes:PresentationNode[]=[];
 const visit=(id:string):string|null=>{
  const original=byId.get(id)!;
  if(original.page&&original.page!=='shared'&&original.page!==plugin)return null;
  let node:PresentationNode=original;
  if(node.type==='metric'&&!allowed.has(node.metricId))return null;
  if(node.type==='comparison'){const metricIds=node.metricIds.filter(id=>allowed.has(id));if(!metricIds.length)return null;node={...node,metricIds};}
  if('children'in node){const children=node.children.map(visit).filter((id):id is string=>id!==null);if(!children.length)return null;node=node.type==='grid'&&children.length===1?{id:node.id,type:'stack',gap:node.gap,align:'left',children}:{...node,children};}
  nodes.push(node);return node.id;
 };
 const sections=doc.sections.map(visit).filter((id):id is string=>id!==null);
 // Keep a valid bounded document even when no authored blocks match this page.
 if(!sections.length)return {...doc,sections:['page-empty'],nodes:[{id:'page-empty',type:'metric_collection',variant:'stat'}]};
 return {...doc,sections,nodes};
}
export const presentationTargetInput=z.object({clientId:id,projectId:id}).strict();
export const getPresentationInput=presentationTargetInput.extend({revision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1).optional()}).strict();
export const validatePresentationInput=presentationTargetInput.extend({document:presentationDocumentSchema}).strict();
const writeFields={expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),idempotencyKey:z.string().min(8).max(120)};
export const savePresentationInput=validatePresentationInput.extend(writeFields).strict();
export const selectPresentationInput=presentationTargetInput.extend({...writeFields,sourceRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1)}).strict();
export type PresentationView={revision:number;document:PresentationDocument|null;mode:'published'|'preview'|'default';plugin?:PresentationPlugin|null;pages?:PresentationPlugin[]};
