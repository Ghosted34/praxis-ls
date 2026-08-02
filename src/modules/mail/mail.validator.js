"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const schemas = {
  connect: z.object({
    email_address: z.string().email(),
    provider: z.enum(["imap_smtp", "microsoft_graph", "google_gmail"]).optional(),
    display_name: z.string().optional(),
    imap_host: z.string().min(1).optional(),
    imap_port: z.coerce.number().int().positive().optional(),
    imap_secure: z.boolean().optional(),
    smtp_host: z.string().min(1).optional(),
    smtp_port: z.coerce.number().int().positive().optional(),
    smtp_secure: z.boolean().optional(),
    auth_user: z.string().optional(),
    password: z.string().min(1).max(4000).optional(),
  }),
  send: z.object({
    connectionId: z.string().uuid(),
    to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
    cc: z.array(z.string().email()).optional(),
    subject: z.string().optional(),
    html: z.string().optional(),
    text: z.string().optional(),
  }),
  reply: z.object({
    connectionId: z.string().uuid(),
    html: z.string().optional(),
    text: z.string().optional(),
  }),
  // AI copilot reply carries the target message id in the body (no route param).
  aiReply: z.object({
    connectionId: z.string().uuid(),
    inboundId: z.string().uuid(),
    html: z.string().optional(),
    text: z.string().optional(),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { connect: mw("connect"), send: mw("send"), reply: mw("reply"), schemas };
