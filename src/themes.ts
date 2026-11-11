import { authorize, PublicError, type Principal } from './auth.ts';
import { canonicalJson, sha256 } from './domain.ts';
import { projectThemeSchema, themePresets, themeTargetInput, validateThemeInput, updateThemeInput, resetThemeInput, type ProjectThemeState } from './themeSchema.ts';
import type { z } from 'zod';

type Target = z.infer<typeof themeTargetInput>;
async function requireTarget(db:D1Database,p:Principal,input:Target,scope:string) {
  await authorize(db,p,input.clientId,scope);
  if (!await db.prepare('SELECT 1 FROM projects WHERE tenant_id=? AND client_id=? AND id=?').bind(p.tenantId,input.clientId,input.projectId).first()) throw new PublicError('Reporting target is not available.');
}
/** Internal read: the caller must have already authorized this exact target. */
export async function readProjectTheme(db:D1Database,tenantId:string,clientId:string,projectId:string):Promise<ProjectThemeState> {
  const row=await db.prepare('SELECT revision,theme_json,updated_at FROM project_themes WHERE tenant_id=? AND client_id=? AND project_id=?').bind(tenantId,clientId,projectId).first<{revision:number;theme_json:string|null;updated_at:string}>();
  if(!row)return {revision:0,theme:null,updatedAt:null};
  // Fail safely to the standard report if an old/invalid design was stored.
  let theme=null;
  if(row.theme_json) {try {const parsed=projectThemeSchema.safeParse(JSON.parse(row.theme_json));if(parsed.success)theme=parsed.data;}catch{/* Default renderer remains usable. */}}
  return {revision:row.revision,theme,updatedAt:row.updated_at};
}
export async function getProjectTheme(db:D1Database,p:Principal,raw:Target) {
  const input=themeTargetInput.parse(raw);await requireTarget(db,p,input,'themes:read');
  return {...input,...await readProjectTheme(db,p.tenantId,input.clientId,input.projectId),presets:themePresets,capabilities:{schemaVersion:1,logo:'Not supported in this version; set brand.logo to null.',reportData:'Read-only: values, units, periods, metric access, comparison rules and quality warnings cannot be themed.',execution:'Declarative styling only. No HTML, CSS, JavaScript, remote assets or network requests.'}};
}
export async function validateProjectTheme(db:D1Database,p:Principal,raw:z.infer<typeof validateThemeInput>) {
  const input=validateThemeInput.parse(raw);await requireTarget(db,p,input,'themes:read');
  return {...input,valid:true,persisted:false,reportDataChanged:false};
}
async function replay(db:D1Database,p:Principal,key:string,hash:string) {
  const row=await db.prepare('SELECT payload_hash,result_json FROM theme_events WHERE tenant_id=? AND principal_id=? AND idempotency_key=?').bind(p.tenantId,p.id,key).first<{payload_hash:string;result_json:string}>();
  if(!row)return null;
  if(row.payload_hash!==hash)throw new PublicError('Idempotency key was already used for a different theme request.');
  return {...JSON.parse(row.result_json),replayed:true};
}
async function writeTheme(db:D1Database,p:Principal,input:z.infer<typeof updateThemeInput>|z.infer<typeof resetThemeInput>,reset:boolean) {
  await requireTarget(db,p,input,'themes:write');
  const operation=reset?'reset_project_theme':'update_project_theme';
  const hash=await sha256(canonicalJson({operation,input}));
  const previous=await replay(db,p,input.idempotencyKey,hash);if(previous)return previous;
  const now=new Date().toISOString(),revision=input.expectedRevision+1;
  const themeJson=reset?null:JSON.stringify((input as z.infer<typeof updateThemeInput>).theme);
  const result={clientId:input.clientId,projectId:input.projectId,revision,updatedAt:now,reset,reportDataChanged:false};
  const mutation=input.expectedRevision===0
    ? db.prepare('INSERT INTO project_themes(tenant_id,client_id,project_id,revision,theme_json,updated_at,updated_by) VALUES(?,?,?,1,?,?,?)').bind(p.tenantId,input.clientId,input.projectId,themeJson,now,p.id)
    : db.prepare('UPDATE project_themes SET revision=revision+1,theme_json=?,updated_at=?,updated_by=? WHERE tenant_id=? AND client_id=? AND project_id=? AND revision=?').bind(themeJson,now,p.id,p.tenantId,input.clientId,input.projectId,input.expectedRevision);
  const receipt=db.prepare('INSERT INTO theme_events(tenant_id,principal_id,idempotency_key,client_id,project_id,operation,revision,payload_hash,theme_json,result_json,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?)').bind(p.tenantId,p.id,input.idempotencyKey,input.clientId,input.projectId,operation,revision,hash,themeJson,JSON.stringify(result),now);
  try{await db.batch([mutation,receipt]);}catch(error){
    const retried=await replay(db,p,input.idempotencyKey,hash);if(retried)return retried;
    if(/constraint|unique|foreign key|NOT NULL/i.test(String(error)))throw new PublicError('Theme write rejected. Read the current theme revision and retry with a new idempotency key.');
    throw error;
  }
  return {...result,replayed:false};
}
export function updateProjectTheme(db:D1Database,p:Principal,input:z.infer<typeof updateThemeInput>){return writeTheme(db,p,updateThemeInput.parse(input),false);}
export function resetProjectTheme(db:D1Database,p:Principal,input:z.infer<typeof resetThemeInput>){return writeTheme(db,p,resetThemeInput.parse(input),true);}
