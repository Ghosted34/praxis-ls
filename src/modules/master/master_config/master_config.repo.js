/** party_field_config access (spec §5). SQL lives here. */
"use strict";

// `required_for_activation` (14030) is a SEPARATE policy from `is_required`:
// the first is enforced at activation, the second when the record is created.
// Both travel in every read, so the settings form and the service never need a
// second query to answer "what does this tenant actually require".
const CONFIG_COLS =
  "applies_to, field_key, field_group, is_required, required_for_activation, is_visible, is_custom, sort_order, label_override";

/** The tenant's stored config rows for one side, in display order. */
async function loadConfig(client, appliesTo) {
  const { rows } = await client.query(
    `SELECT ${CONFIG_COLS} FROM party_field_config WHERE applies_to = $1 ORDER BY sort_order, field_key`,
    [appliesTo],
  );
  return rows;
}

/** Upsert one field-config row (create the tenant's copy, or update in place). */
async function upsert(client, appliesTo, f) {
  await client.query(
    `INSERT INTO party_field_config
       (applies_to, field_key, field_group, is_required, required_for_activation, is_visible, is_custom, sort_order, label_override)
     VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, false), COALESCE($6, true), COALESCE($7, false), COALESCE($8, 100), $9)
     ON CONFLICT (applies_to, field_key) DO UPDATE SET
       field_group             = COALESCE(EXCLUDED.field_group, party_field_config.field_group),
       is_required             = EXCLUDED.is_required,
       required_for_activation = EXCLUDED.required_for_activation,
       is_visible              = EXCLUDED.is_visible,
       is_custom               = EXCLUDED.is_custom,
       sort_order              = EXCLUDED.sort_order,
       label_override          = EXCLUDED.label_override,
       updated_at              = now()`,
    [appliesTo, f.field_key, f.field_group ?? null, f.is_required, f.required_for_activation, f.is_visible, f.is_custom, f.sort_order, f.label_override ?? null],
  );
}

// `writable` names the columns a PUT may set per row — the mass-assignment guard
// AND what the write-route CI gate keys on for this module (the upsert above
// touches exactly these, never a raw request key).
module.exports = {
  writable: ["field_key", "field_group", "is_required", "required_for_activation", "is_visible", "is_custom", "sort_order", "label_override"],
  loadConfig,
  upsert,
};
