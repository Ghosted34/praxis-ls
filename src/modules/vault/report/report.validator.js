"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const CADENCE = ["daily", "weekly", "monthly", "quarterly", "on_event"];
const FORMATS = ["pdf", "csv", "xlsx"];

const schemas = {
  // API F-15: POST /reports/run/:key/pdf read `req.body.params` and
  // `req.body.entity_id` with no validator, then fed `params` straight into the
  // report runner as filter values. `entity_id` reaches the document renderer
  // as the entity a generated PDF is filed against, so a malformed one produced
  // a 22P02 from deep inside PDF generation rather than a 422 at the edge.
  //
  // `params` is a free-form filter bag whose keys differ per report, so it is
  // bounded (short scalar values only) rather than enumerated.
  runPdf: z.object({
    params: z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
    entity_id: z.string().uuid().nullish(),
  }).strict(),
  save: z.object({ name: z.string().min(1), report_key: z.string().min(1), params: z.record(z.any()).optional(), is_shared: z.boolean().optional() }),
  setTile: z.object({ tile_key: z.string().min(1), position: z.number().int().nonnegative().optional(), is_visible: z.boolean().optional(), config: z.record(z.any()).optional() }),
  schedule: z.object({
    name: z.string().min(1),
    report_key: z.string().min(1),
    params: z.record(z.any()).optional(),
    cadence: z.enum(CADENCE),
    recipients: z.array(z.string().email()).max(100).optional(),
    formats: z.array(z.enum(FORMATS)).optional(),
    active: z.boolean().optional(),
  }),
  scheduleUpdate: z.object({
    name: z.string().min(1).optional(),
    report_key: z.string().min(1).optional(),
    params: z.record(z.any()).optional(),
    cadence: z.enum(CADENCE).optional(),
    recipients: z.array(z.string().email()).max(100).optional(),
    formats: z.array(z.enum(FORMATS)).optional(),
    active: z.boolean().optional(),
  }).strict(),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = {
  save: mw("save"), setTile: mw("setTile"), schedule: mw("schedule"),
  scheduleUpdate: mw("scheduleUpdate"), runPdf: mw("runPdf"),
  schemas,
};
