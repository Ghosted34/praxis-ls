"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const create = z.object({
  employee_id: z.string().uuid().optional(),
  template_id: z.string().uuid().optional(),
  starts_on: ymd.optional().nullable(),
  // Plain labels, still accepted (0360) — a one-off checklist for a contractor
  // should not require a template first.
  items: z.array(z.string()).optional(),
});

// `label` was the ONLY field an item could carry. Everything that makes a task
// chaseable — its date, its owner, whether it is statutory — had nowhere to go.
const item = z.object({
  label: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  due_on: ymd.optional().nullable(),
  // The template's vocabulary, usable by hand: "day 3" rather than a calendar
  // date the caller has to work out from the start date themselves.
  due_days: z.number().int().min(-365).max(365).optional(),
  owner_role: z.string().max(120).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  sop_document_id: z.string().uuid().optional().nullable(),
  is_mandatory: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
});

const itemUpdate = item.partial().extend({
  is_done: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

/** The old two-field tick, kept so the existing PATCH /items/:itemId contract
 *  is unchanged for anything already calling it. */
const toggle = z.object({ is_done: z.boolean() });

const reschedule = z.object({ starts_on: ymd });

const template = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  department: z.string().max(120).optional().nullable(),
  job_title: z.string().max(120).optional().nullable(),
  priority: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
});

const templateItem = z.object({
  label: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  // Negative is meant: a contract signed and a laptop ordered BEFORE somebody
  // walks in is most of what good onboarding is.
  due_days: z.number().int().min(-365).max(365).optional(),
  owner_role: z.string().max(120).optional().nullable(),
  sop_document_id: z.string().uuid().optional().nullable(),
  is_mandatory: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
});

const schemas = {
  create, addItem: item, itemUpdate, toggle, reschedule,
  template, templateUpdate: template.partial(),
  templateItem, templateItemUpdate: templateItem.partial(),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  addItem: mw("addItem"),
  itemUpdate: mw("itemUpdate"),
  toggle: mw("toggle"),
  reschedule: mw("reschedule"),
  template: mw("template"),
  templateUpdate: mw("templateUpdate"),
  templateItem: mw("templateItem"),
  templateItemUpdate: mw("templateItemUpdate"),
  schemas,
};
