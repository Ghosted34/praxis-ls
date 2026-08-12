"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");
const { schemas: qTicket } = require("../operations/q_ticket/q_ticket.validator");

const schemas = {
  login: z.object({ email: z.string().email(), password: z.string().min(1) }),
  create: z.object({ email: z.string().email(), password: z.string().min(8), full_name: z.string().optional() }),
  password: z.object({ password: z.string().min(8) }),
  status: z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }),
  // Invite takes no password: staff must not choose an external party's
  // credentials. `full_name` is optional because a grant is issued against an
  // email address and the name may not be known yet.
  invite: z.object({ email: z.string().email(), full_name: z.string().optional() }),
  forgot: z.object({ email: z.string().email() }),
  accept: z.object({ token: z.string().min(1), password: z.string().min(8) }),
  // Q tickets raised from the portal. Reuses the module's own shapes so the
  // internal and external surfaces validate identically — with one exception
  // enforced in the service, not here: a client can never post an internal note,
  // whatever the body says.
  raiseTicket: qTicket.raise,
  replyTicket: qTicket.reply,
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  login: mw("login"), create: mw("create"), password: mw("password"), status: mw("status"),
  invite: mw("invite"), forgot: mw("forgot"), accept: mw("accept"),
  raiseTicket: mw("raiseTicket"), replyTicket: mw("replyTicket"),
};
