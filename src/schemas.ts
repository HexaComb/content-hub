import { z } from "zod";

export const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/);
export const day = z.iso.date();
const timezone = z.string().max(80).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Use a valid IANA timezone.");
export const metricInput = z.object({
  clientId: id, key: id, label: z.string().min(1).max(120),
  category: z.string().min(1).max(80), unit: z.string().min(1).max(40),
  direction: z.enum(["higher", "lower", "neutral"]),
  semantics: z.enum(["period_total", "period_average", "snapshot", "custom"]),
  timezone, dimensions: z.record(z.string().max(80), z.string().max(300)).default({}),
  definition: z.string().min(1).max(1000),
}).strict();
export const observationInput = z.object({
  clientId: id, metricId: id, periodStart: day, periodEnd: day,
  value: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(), quality: z.enum(["complete", "partial", "missing"]),
  source: z.object({ provider: z.string().min(1).max(120), reference: z.url().max(2000).optional(), note: z.string().max(1000).optional() }).strict(),
  collectedAt: z.iso.datetime({ offset: true }),
  idempotencyKey: z.string().min(8).max(120), expectedRevision: z.number().int().min(0),
  correctionReason: z.string().min(1).max(1000).optional(),
}).strict().refine(v => v.periodEnd > v.periodStart, "periodEnd is exclusive and must be after periodStart.")
  .refine(v => (v.quality === "missing") === (v.value === null), "Only missing observations have a null value.")
  .refine(v => v.expectedRevision === 0 || Boolean(v.correctionReason?.trim()), "Corrections need a reason.");
export const reportInput = z.object({ clientId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
export const contentListInput = z.object({
  clientId: id,
  status: z.enum(["draft", "approved", "scheduled", "publishing", "published", "failed", "cancelled"]).optional(),
  scheduledBefore: z.iso.datetime({ offset: true }).optional(),
  afterId: id.optional(), limit: z.number().int().min(1).max(100).default(50),
}).strict();
export type MetricInput = z.infer<typeof metricInput>;
export type ObservationInput = z.infer<typeof observationInput>;

