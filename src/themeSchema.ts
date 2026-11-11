import { z } from 'zod';
import { id } from './schemas.ts';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.').transform(v => v.toLowerCase());
function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
export function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
/** This is data, never a template, CSS declaration, URL, or script. */
export const projectThemeSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(80),
  colors: z.object({ background: color, surface: color, raised: color, text: color, muted: color, accent: color, border: color }).strict(),
  typography: z.object({ heading: z.enum(['sans','editorial','display','mono']), body: z.enum(['sans','humanist']) }).strict(),
  layout: z.object({ hero: z.enum(['compact','editorial','banner']), columns: z.union([z.literal(2),z.literal(3),z.literal(4)]), density: z.enum(['comfortable','airy']), width: z.enum(['standard','wide']), corners: z.enum(['square','soft','rounded']), divider: z.enum(['none','line','stripes','checker']), cards: z.enum(['outlined','solid','accent']), order: z.enum(['metrics-first','comparison-first']) }).strict(),
  brand: z.object({ eyebrow: z.string().trim().max(60), tagline: z.string().trim().max(180), logo: z.null().describe('Reserved for future safe image support. Embedded and remote logos are not supported in this version; use null.') }).strict(),
}).strict().superRefine((theme, ctx) => {
  // All report text stays readable on every surface. Semantic change/quality
  // badges keep their fixed, tested color pairs and cannot be overridden.
  for (const foreground of ['text','muted','accent'] as const) for (const background of ['background','surface','raised'] as const) {
    if (contrast(theme.colors[foreground], theme.colors[background]) < 4.5) ctx.addIssue({code:'custom',path:['colors',foreground],message:`${foreground} needs at least 4.5:1 contrast against ${background}.`});
  }
});
export type ProjectTheme = z.infer<typeof projectThemeSchema>;
export type ProjectThemeState = { revision: number; theme: ProjectTheme | null; updatedAt: string | null };
export const themeTargetInput = z.object({clientId:id, projectId:id}).strict();
export const validateThemeInput = themeTargetInput.extend({theme:projectThemeSchema}).strict();
const writeFields = {expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),idempotencyKey:z.string().min(8).max(120)};
export const updateThemeInput = validateThemeInput.extend(writeFields).strict();
export const resetThemeInput = themeTargetInput.extend(writeFields).strict();
export const themePresets: Record<string, ProjectTheme> = {
  studio: {schemaVersion:1,name:'Quiet studio',colors:{background:'#f6f7f2',surface:'#ffffff',raised:'#edf1e7',text:'#193c32',muted:'#52654e',accent:'#1b664c',border:'#cbd6c6'},typography:{heading:'sans',body:'sans'},layout:{hero:'compact',columns:4,density:'comfortable',width:'wide',corners:'soft',divider:'line',cards:'outlined',order:'metrics-first'},brand:{eyebrow:'YOUR MONTH IN FOCUS',tagline:'A clear view of the work and what comes next.',logo:null}},
  night: {schemaVersion:1,name:'After hours',colors:{background:'#101010',surface:'#191817',raised:'#242220',text:'#ffffff',muted:'#c3bdb7',accent:'#ff756b',border:'#4d4641'},typography:{heading:'display',body:'sans'},layout:{hero:'banner',columns:2,density:'airy',width:'wide',corners:'rounded',divider:'stripes',cards:'solid',order:'metrics-first'},brand:{eyebrow:'THE LATEST CHAPTER',tagline:'Your work. Your audience. Your progress.',logo:null}},
  editorial: {schemaVersion:1,name:'Paper & ink',colors:{background:'#f4efe6',surface:'#fffcf5',raised:'#e9e2d6',text:'#28251f',muted:'#5f574d',accent:'#8c3528',border:'#b8ad9c'},typography:{heading:'editorial',body:'humanist'},layout:{hero:'editorial',columns:3,density:'airy',width:'standard',corners:'square',divider:'line',cards:'accent',order:'comparison-first'},brand:{eyebrow:'A FIELD GUIDE TO YOUR PROGRESS',tagline:'The story in your numbers.',logo:null}},
};
