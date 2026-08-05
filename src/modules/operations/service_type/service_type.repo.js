/**
 * Service type repository (table `service_type`, migration 0310).
 *
 * Mostly the shared CRUD kit. `list` is overridden to add the one thing callers
 * actually need beyond the columns: how many milestone template versions exist
 * and whether an ACTIVE one does — because a service type without an active
 * template silently produces dossiers with no milestone chain, and that should
 * be visible in the list rather than discovered later on an empty 360° tab.
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

const base = makeRepo({
  table: "service_type",
  pk: "service_type_id",
  activeColumn: "is_active",
  searchColumn: "name_fr",
  orderBy: "name_fr ASC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at", "name_fr", "is_active"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});

async function list(client, q = {}) {
  const params = [];
  const wh = [];
  // `includeInactive` exists because the admin screen has to be able to see and
  // reactivate what it archived — the base repo filters is_active unconditionally.
  if (!q.includeInactive) wh.push("st.is_active = true");
  if (q.q) {
    params.push(`%${q.q}%`);
    wh.push(`(st.name_fr ILIKE $${params.length} OR st.name_en ILIKE $${params.length} OR st.key ILIKE $${params.length})`);
  }
  const { rows } = await client.query(
    "SELECT st.*, " +
      "(SELECT COUNT(*)::int FROM milestone_template mt WHERE mt.service_type_id = st.service_type_id) AS template_versions, " +
      "(SELECT COUNT(*)::int FROM milestone_template mt WHERE mt.service_type_id = st.service_type_id AND mt.is_active) > 0 AS has_active_template " +
      "FROM service_type st" +
      (wh.length ? " WHERE " + wh.join(" AND ") : "") +
      " ORDER BY st.is_active DESC, st.name_fr ASC",
    params,
  );
  return rows;
}

module.exports = { ...base, list };
