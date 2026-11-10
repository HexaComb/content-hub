import { z } from 'zod';
import { id } from './schemas.ts';
export const prepareInvitationInput = z.object({ clientId: id, projectId: id, recipient: z.email().max(254), metricIds: z.array(id).min(1).max(200), grantExpiresAt: z.iso.datetime({offset:true}) }).strict();
export const sendInvitationInput = z.object({ invitationId: id, approvalDigest: z.string().regex(/^[a-f0-9]{64}$/), explicitlyApproved: z.literal(true) }).strict();
export const listInvitationsInput = z.object({ clientId:id }).strict();
export const revokeInvitationInput = z.object({ clientId:id, invitationId:id }).strict();
export type PrepareInvitationInput = z.infer<typeof prepareInvitationInput>;
