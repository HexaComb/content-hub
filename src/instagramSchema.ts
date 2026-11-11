import {z} from 'zod';
import {id} from './schemas.ts';

export const instagramKinds=['followers','posts','average_likes_per_post','posts_per_week'] as const;
export type InstagramMetricKind=typeof instagramKinds[number];
export const instagramMetricLabels:Record<InstagramMetricKind,string>={followers:'Followers',posts:'Posts since month start',average_likes_per_post:'Average likes per post',posts_per_week:'Posts per week (avg)'};
/** Only explicit, exact aliases. Units, labels and project names do not classify a metric. */
export function instagramMetricKind(key:string):InstagramMetricKind|null {
 const normalized=key.toLowerCase().replace(/[.:-]/g,'_').replace(/^ig_/,'instagram_');
 const aliases:Record<string,InstagramMetricKind>={instagram_followers:'followers',instagram_follower_count:'followers',instagram_posts:'posts',instagram_posts_since_month_start:'posts',instagram_average_likes_per_post:'average_likes_per_post',instagram_avg_likes_per_post:'average_likes_per_post',instagram_posts_per_week:'posts_per_week'};
 return aliases[normalized]??null;
}
/** Validate display semantics without changing generic observations. Null is a
 * missing reading, not a valid numeric value. Counts must also be safe integers. */
export function validInstagramMetricValue(kind:InstagramMetricKind,value:number|null):boolean {
 return value!==null&&Number.isFinite(value)&&value>=0&&(!['followers','posts'].includes(kind)||Number.isSafeInteger(value));
}
export const instagramTargetInput=z.object({clientId:id,projectId:id}).strict();
export const instagramDashboardInput=instagramTargetInput.extend({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()});
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const idempotencyKey=z.string().min(8).max(100);
const url=z.string().max(2000).url().refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use an HTTPS content URL without credentials.');
export const upsertInstagramItemInput=instagramTargetInput.extend({id,format:z.enum(['reel','post']),title:z.string().trim().min(1).max(300),idea:z.string().trim().min(1).max(4000),status:z.enum(['proposed','queued','in_progress','completed','declined']),platform:z.literal('instagram'),contentUrl:url.nullable().default(null),evidence:z.string().trim().min(1).max(2000).nullable().default(null),expectedRevision:revision,idempotencyKey}).strict().refine(v=>v.status==='completed'?(v.contentUrl!==null&&v.evidence!==null):(v.contentUrl===null&&v.evidence===null),'Only completed items may have content URL/evidence; both are required for completion.');
export const instagramDecisionInput=instagramTargetInput.extend({id,answer:z.enum(['yes','no']),expectedRevision:revision.refine(v=>v>0),idempotencyKey}).strict();
export type InstagramItemInput=z.infer<typeof upsertInstagramItemInput>;
export type InstagramDecisionInput=z.infer<typeof instagramDecisionInput>;
