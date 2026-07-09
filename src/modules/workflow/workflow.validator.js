"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const check = (schema) => (req, _res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request body", 400, r.error.flatten().fieldErrors);
  }
  req.body = r.data;
  return next();
};

const registerEventType = z.object({
  key: z.string().min(1),
  module_key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  is_security_critical: z.boolean().optional(),
  is_approvable: z.boolean().optional(),
});

const createWorkflow = z.object({
  event_type_key: z.string().min(1),
  name: z.string().min(1),
});

const updateWorkflow = z.object({
  name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

const addStep = z.object({
  step_seq: z.number().int().positive(),
  step_kind: z.enum(["VALIDATE", "APPROVE"]),
  role_id: z.string().uuid().optional(),
  capability_code: z.enum(["VALIDATOR", "APPROVER"]).optional(),
  scope_id: z.string().uuid().optional(),
  min_amount_xaf: z.number().nonnegative().optional(),
  max_amount_xaf: z.number().nonnegative().optional(),
});

module.exports = {
  registerEventType: check(registerEventType),
  createWorkflow: check(createWorkflow),
  updateWorkflow: check(updateWorkflow),
  addStep: check(addStep),
};
