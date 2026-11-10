import { z } from "zod";
import { id } from "./schemas.ts";

const utc = z.iso.datetime().transform(v => new Date(v).toISOString());
const timezone = z.string().min(1).max(80).refine(v => {
  try { new Intl.DateTimeFormat("en", { timeZone: v }); return !/^[+-]/.test(v); } catch { return false; }
}, "Use a valid IANA timezone.");
const asset = z.object({
  url: z.url().max(2000).refine(v => new URL(v).protocol === "https:", "Only HTTPS asset references are accepted."),
  mediaType: z.enum(["image", "video", "audio", "document"]),
  altText: z.string().max(2000).optional(),
}).strict();
const fields = {
  channel: z.string().trim().min(1).max(80),
  accountRef: z.string().trim().min(1).max(200),
  title: z.string().min(1).max(300),
  caption: z.string().max(20000),
  assets: z.array(asset).max(20).refine(v => JSON.stringify(v).length <= 32768, "Assets exceed storage limit."),
};
const operation = { clientId: id, idempotencyKey: z.string().min(8).max(120) };
const versioned = { ...operation, contentId: id, expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1) };
export const createContentInput = z.object({ ...operation, ...fields }).strict();
export const updateContentInput = z.object({ ...versioned, ...fields }).strict();
export const approveContentInput = z.object({ ...versioned, channel: fields.channel, accountRef: fields.accountRef }).strict();
export const scheduleContentInput = z.object({ ...versioned, scheduledAt: utc, timezone }).strict();
export const cancelContentInput = z.object({ ...versioned, reason: z.string().trim().min(1).max(1000) }).strict();
export const recordPublicationReceiptInput = z.object({
  ...versioned, channel: fields.channel, accountRef: fields.accountRef,
  publishedAt: utc, externalPostId: z.string().trim().min(1).max(300),
}).strict();
export const linkContentMetricInput = z.object({ ...versioned, metricId: id }).strict();
