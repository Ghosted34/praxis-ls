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
  letterheadLine: entityCommon.letterheadLineSave,
  workingCalendar: entityCommon.workingCalendarSave,
  // Its own endpoint rather than a column on the PATCH body — the prefix is an
  // identifier clients see, and it is only changeable before any operation file
  // has used it. See the note beside the schema.
  opsReferencePrefix: entityCommon.opsReferencePrefix,
  // Tax obligation generator (PR-05) — the run and its two manual transitions.
  taxObligationGenerate: entityCommon.taxObligationGenerate,
  taxObligationStatus: entityCommon.taxObligationStatus,
  taxObligationAssign: entityCommon.taxObligationAssign,
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

/**
 * Create with optional atomic initial registered address (PR-02).
 *
 * The entity and its initial REGISTERED address must commit or fail together
 * (Decision Q7). The address arrives as `initial_address` on the same POST that
 * creates the entity, so a single transaction owns both rows and a failure of
 * the child rolls back the parent — no orphaned entity, no silently lost address.
 *
 * `masterCreate` is the authority for the entity columns; `addressCreate` is the
 * authority for the nested address. They are validated separately so that
 * `initial_address` does not need to be smuggled into the shared master shape
 * (which would break the WRITABLE parity gate — it is not a column).
 */
function createWithInitialAddress(req, _res, next) {
  const raw = req.body || {};
  const { initial_address: rawAddress, ...rest } = raw;

  const parsedEntity = schemas.create.safeParse(rest);
  if (!parsedEntity.success) {
    return next(
      new AppError(
        "VALIDATION_ERROR",
        "Invalid body",
        422,
        parsedEntity.error.flatten().fieldErrors,
      ),
    );
  }

  let validatedAddress;
  if (rawAddress !== undefined && rawAddress !== null) {
    const parsedAddress = entityCommon.addressCreate.safeParse(rawAddress);
    if (!parsedAddress.success) {
      const fieldErrors = parsedAddress.error.flatten().fieldErrors;
      const mapped = {};
      for (const [k, v] of Object.entries(fieldErrors)) {
        mapped[`initial_address.${k}`] = v;
      }
      return next(new AppError("VALIDATION_ERROR", "Invalid initial address", 422, mapped));
    }
    validatedAddress = parsedAddress.data;
  }

  req.body = { ...parsedEntity.data, initial_address: validatedAddress };
  return next();
}

module.exports = {
  create: createWithInitialAddress,
  update: mw("update"),
  setActive: mw("setActive"),
  setStatus: mw("setStatus"),
  setStructure: mw("setStructure"),
  logoUpload: mw("logoUpload"),
  letterhead: mw("letterhead"),
  letterheadLine: mw("letterheadLine"),
  workingCalendar: mw("workingCalendar"),
  opsReferencePrefix: mw("opsReferencePrefix"),
  taxObligationGenerate: mw("taxObligationGenerate"),
  taxObligationStatus: mw("taxObligationStatus"),
  taxObligationAssign: mw("taxObligationAssign"),
  schemas,
};
