/**
 * AI action manifest (AI_ARCHITECTURE §2) for email signatures (MOD-70).
 *
 * The operational half of the module: who has a signature set up, who does not,
 * and what the renderer thinks is wrong with theirs. Those are the questions an
 * administrator asks before a rollout, and they had no tool.
 *
 * ── WHAT IS DELIBERATELY LEFT OUT ──────────────────────────────────────────
 *
 * The template, motto and palette writes are BRAND DESIGN — which brand colour
 * paints which part of the card, and the line of copy under everyone's name.
 * That is the same thing `branding` carries an `// ai:none` for: a tenant's
 * look is theirs to choose in the screen built for choosing it, and handing a
 * model the paintbrush gains nothing. They stay on the settings screen.
 *
 * `renderPng` / `renderBatch` are left out for a plainer reason: they return
 * image bytes, which a tool result cannot usefully carry.
 *
 * `save_my_signature` IS here — phone, pronouns, credentials, booking link are
 * data entry about oneself, which is exactly what dictating to an assistant is
 * good for. It writes the CALLER's own profile: the user id comes from the
 * actor, never from the payload, so it cannot be pointed at a colleague.
 *
 * Its permission is `MOD-70 view`, which looks odd on a write and is chosen on
 * purpose. `PUT /signature` carries no `requirePermission` at all — it is any
 * authenticated person editing their own card — but `services/ai/action-authz`
 * fails CLOSED on a null requirement, so a manifest cannot express "no grant
 * needed". `view` is therefore the NARROWEST gate available here: strictly
 * fewer people reach it through the assistant than through the screen, which is
 * the safe direction for the two paths to differ in.
 */
"use strict";

const service = require("./signature.service");
const validator = require("./signature.validator");

const MOD = "MOD-70";

module.exports = {
  entity: "mail_signature",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_signature_staff", service: (c, p) => service.listStaff(c, p || {}), permission: { module: MOD, action: "view" }, describe: "Every member of staff and the state of their email signature — who has one configured and who does not." },
    { key: "list_signature_templates", service: (c, p) => service.listTemplates(c, p || {}), permission: { module: MOD, action: "view" }, describe: "The tenant's signature templates, with their scope and which is default." },
  ],

  writes: [
    {
      key: "save_my_signature",
      service: (c, p, actor) => service.saveOwnProfile(c, actor.user_id, p, actor),
      schema: validator.schemas.profile,
      permission: { module: MOD, action: "view" },
      confirm: true,
      describe: "Update the CALLER's own email signature details (desk and mobile numbers, WhatsApp, pronouns, credentials, booking link, language, or switch it off). It only ever writes the caller's own profile.",
    },
  ],
};
