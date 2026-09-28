"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");
const schemas = {
  grant: z.object({
    portal: z.enum(["CLIENT", "INVESTOR", "AUDITOR"]),
    subject_email: z.string().email(),
    client_id: z.string().uuid().optional().nullable(),
    expires_at: z.string().optional().nullable(),
    // Client team (14150): what this person may see, and whether they may
    // invite colleagues. Omitted = everything, and admin only if they are the
    // client's first portal user.
    access_scope: z.enum(["ALL", "OPERATIONS", "BILLING"]).optional(),
    is_client_admin: z.boolean().optional().nullable(),
  }),
  team: z.object({
    access_scope: z.enum(["ALL", "OPERATIONS", "BILLING"]).optional(),
    is_client_admin: z.boolean().optional(),
  }),
  // Praxis AI's shapes for the client-portal staff actions (portal.ai.js). The
  // HTTP routes validate the same fields in portal_auth.validator.js; these add
  // the id the route takes from its path.
  aiReviewRequest: z.object({
    client_request_id: z.string().uuid(),
    decision: z.enum(["ACCEPT", "REJECT", "CANCEL"]),
    note: z.string().trim().max(1000).optional().nullable(),
  }),
  aiConfirmProof: z.object({
    payment_proof_id: z.string().uuid(),
    treasury_account_id: z.string().uuid().optional().nullable(),
  }),
  aiPublishBundle: z.object({
    invoice_id: z.string().uuid(),
    doc_ids: z.array(z.string().uuid()).max(200),
  }),
  aiWithdrawBundle: z.object({ invoice_id: z.string().uuid() }),
  // A reply to a client in their portal chat (14170): General, or one shipment's thread.
  aiChatReply: z.object({
    client_id: z.string().uuid(),
    thread: z.union([z.literal("general"), z.string().uuid()]).optional(),
    body: z.string().trim().min(1).max(4000),
  }),
  aiRejectProof: z.object({
    payment_proof_id: z.string().uuid(),
    note: z.string().trim().min(1).max(1000),
  }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { grant: mw("grant"), team: mw("team"), schemas };
