/**
 * AI action manifest (AI_ARCHITECTURE §2) for master-data field configuration
 * (§5.2/§5.3).
 *
 * ── WHY THIS MANIFEST HAS TWO OF EVERYTHING ────────────────────────────────
 *
 * The HTTP routes take the side in the path (`/:appliesTo`) and derive the
 * permission from it: `MOD-04` for SUPPLIER, `MOD-03` for CLIENT
 * (`master_config.routes.js`). A manifest action carries ONE static permission,
 * so a single `set_field_config` taking `applies_to` in its payload would have
 * to pick one grant and would then let a client-master holder reconfigure
 * supplier fields, or the reverse.
 *
 * Splitting into a CLIENT pair and a SUPPLIER pair keeps each action's gate
 * exactly the one its route carries, and `applies_to` is pinned by the wrapper
 * rather than taken from the payload — so it cannot be talked into the other
 * side.
 *
 * This module has no validator file (the routes rely on the repo's `writable`
 * allow-list), so the field shape is declared here, mirroring that list.
 */
"use strict";

const { z } = require("zod");
const service = require("./master_config.service");
const repo = require("./master_config.repo");

const CLIENT = "MOD-03";
const SUPPLIER = "MOD-04";

/** Mirrors `repo.writable` — the columns a PUT may set on one field row. */
const field = z.object({
  field_key: z.string().min(1).max(120),
  field_group: z.string().max(120).optional().nullable(),
  is_required: z.boolean().optional(),
  // Required to ACTIVATE the party (14030) — a different policy from
  // `is_required`, which is enforced when the record is created.
  required_for_activation: z.boolean().optional(),
  is_visible: z.boolean().optional(),
  is_custom: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
  label_override: z.string().max(200).optional().nullable(),
});
const put = z.object({ fields: z.array(field).min(1) });

// A field the repo cannot write is a field the caller thinks they set. Pinned
// here so the two lists cannot drift apart silently.
const declared = Object.keys(field.shape);
const missing = repo.writable.filter((k) => !declared.includes(k));
if (missing.length) throw new Error(`master_config.ai.js is behind repo.writable: ${missing.join(", ")}`);

module.exports = {
  entity: "master_config",
  module_key: CLIENT,
  screens: [],

  reads: [
    { key: "get_client_field_config", service: (c) => service.getEffective(c, "CLIENT"), permission: { module: CLIENT, action: "view" }, describe: "The tenant's field configuration for CLIENTS — which fields show, which are required, their groups and order." },
    { key: "get_supplier_field_config", service: (c) => service.getEffective(c, "SUPPLIER"), permission: { module: SUPPLIER, action: "view" }, describe: "The tenant's field configuration for SUPPLIERS — which fields show, which are required, their groups and order." },
  ],

  writes: [
    {
      key: "set_client_field_config",
      service: (c, p, actor) => service.put(c, { appliesTo: "CLIENT", fields: p.fields, actor }),
      schema: put,
      permission: { module: CLIENT, action: "edit" },
      confirm: true,
      describe: "Configure CLIENT master-data fields (visibility, required-ness, group, order, label). Each entry needs a field_key.",
    },
    {
      key: "set_supplier_field_config",
      service: (c, p, actor) => service.put(c, { appliesTo: "SUPPLIER", fields: p.fields, actor }),
      schema: put,
      permission: { module: SUPPLIER, action: "edit" },
      confirm: true,
      describe: "Configure SUPPLIER master-data fields (visibility, required-ness, group, order, label). Each entry needs a field_key.",
    },
  ],
};
