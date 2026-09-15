"use strict";
/**
 * Bodies for the website-settings endpoints.
 *
 * Every schema comes from `@praxis/shared/schemas/site-settings` — the SAME
 * object the settings screens validate against, so a form that accepts a value
 * cannot hand the API something it refuses. That is the rule `check:schemas`
 * enforces, and re-declaring a shape here is the failure it exists to catch.
 *
 * The only rules written locally are the two this file is the right place for:
 * a path parameter's shape, and "the body must be an object with at least one
 * field" on a PATCH — neither of which is a payload contract the client needs
 * a copy of.
 */

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
// Through the package ROOT, not a deep path: `check:schemas` proves a shared
// domain is used by both sides by looking for exactly this import, and a
// relative require would satisfy Node while leaving the gate blind.
const { siteSettings: shared } = require("@praxis/shared");

/** PATCH bodies are partial: a settings form sends the fields it changed. The
 *  shared schema describes a WHOLE resource, so `.partial()` derives the patch
 *  from it rather than a second hand-written shape drifting beside it. */
const partial = (schema) => (schema._def.typeName === "ZodEffects" ? schema : schema.partial());

const schemas = {
  // `theme` is sent whole by its screen (it is one form of eight fields), so it
  // is not partial — a missing field means "unset", which for a colour is not a
  // thing a tenant can mean.
  theme: shared.theme,

  // { linkedin: "https://…", facebook: "" } — the whole set, blank meaning
  // "remove". From the shared package, not re-declared here: `check:schemas`
  // treats a validator that imports @praxis/shared and then writes its own
  // z.object as a migrated adapter growing its rules back, and it is right to.
  social: shared.socialSet,

  createPartner: shared.partner,
  updatePartner: shared.partner,
  createCredential: shared.credential,
  updateCredential: shared.credential,
  createLeader: shared.leader,
  updateLeader: shared.leader,
  about: shared.about,

  // Partial for the reason `partial()` states: the careers screen has three
  // controls and toggling one must not unset the other two.
  careers: partial(shared.careers),
  entityStory: shared.entityPublicStory,

  // The image upload. Shared for the reason §6.3 gives: the control has to
  // state each slot's aspect, minimum width and byte cap BEFORE the file dialog
  // opens, and it reads them from the same `SITE_MEDIA_SLOTS` this schema's
  // enum is built from. Two lists would be two answers to "what fits here".
  media: shared.siteMediaUpload,
};

const mw = (k) => (req, _res, next) => {
  const parsed = schemas[k].safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(
      new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors),
    );
  }
  req.body = parsed.data;
  return next();
};

module.exports = {
  schemas,
  partial,
  theme: mw("theme"),
  social: mw("social"),
  createPartner: mw("createPartner"),
  updatePartner: mw("updatePartner"),
  createCredential: mw("createCredential"),
  updateCredential: mw("updateCredential"),
  createLeader: mw("createLeader"),
  updateLeader: mw("updateLeader"),
  about: mw("about"),
  careers: mw("careers"),
  entityStory: mw("entityStory"),
  media: mw("media"),
};
