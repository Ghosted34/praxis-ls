"use strict";
/**
 * MOD-01 validation — an ADAPTER, not a second rulebook.
 *
 * Every shape lives in `packages/shared` (schemas/entity-common.js) so the
 * client's entity form and this API validate against the SAME object. A
 * `z.object(...)` here would be a rule added on one side only, which is the
 * drift `client/scripts/check-schemas.mjs` exists to stop — and it is how the
 * previous version ended up listing the same fields twice, once for create and
 * once for update, with a column added to one silently unwritable through the
 * other.
 *
 * What this file owns: mapping a shared schema's failure onto this API's error
 * envelope, and naming the AI-facing variants (which differ only in carrying
 * `entity_id` in the body, because the assistant has no route parameter).
 */
const { entityCommon } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");

const schemas = {
  create: entityCommon.masterCreate,
  update: entityCommon.masterUpdate,
  setActive: entityCommon.setActive,
  setStatus: entityCommon.setStatus,
  setStructure: entityCommon.setStructure,
  logoUpload: entityCommon.logoUpload,
  letterhead: entityCommon.letterheadUpdate,
  workingCalendar: entityCommon.workingCalendarSave,
  // AI-facing: entity_id in the payload → list_entities picker.
  aiUpdate: entityCommon.aiUpdate,
  aiSetActive: entityCommon.aiSetActive,
  aiSetStatus: entityCommon.aiSetStatus,
  aiSetStructure: entityCommon.aiSetStructure,
  aiCapTable: entityCommon.aiCapTable,
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  setActive: mw("setActive"),
  setStatus: mw("setStatus"),
  setStructure: mw("setStructure"),
  logoUpload: mw("logoUpload"),
  letterhead: mw("letterhead"),
  workingCalendar: mw("workingCalendar"),
  schemas,
};
