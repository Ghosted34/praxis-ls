"use strict";

/**
 * Folding the flat public services list into pillars (migration 12755).
 *
 * Lives here rather than in the route so it can be tested without a database
 * and without booting the app — the same reason the mount rules got their own
 * test. The route stays a thin read-and-respond.
 */

/**
 * The ungrouped bucket is keyed by a Symbol, not by null or "".
 *
 * A tenant is free to name a pillar with the empty string, and citext makes
 * "NULL" a perfectly ordinary key. Either would collide with a sentinel string
 * and merge a real pillar into the leftovers — a bug that only shows up on the
 * one tenant who typed the wrong thing. A Symbol cannot be produced by data.
 */
const UNGROUPED = Symbol("ungrouped");

/**
 * @param {object[]} rows  repo.publicList output, ALREADY ordered pillar-then-card
 * @param {(row: object) => object} toService  maps a row to its public shape
 * @returns {{groups: object[]}}
 *
 * Insertion order is render order: the SQL orders by group sort then card sort
 * (ungrouped last, NULLS LAST), and this walks the rows once without sorting
 * again. If the order is ever wrong, fix the query — not this.
 */
function groupServices(rows, toService) {
  const groups = [];
  const byKey = new Map();

  for (const row of rows || []) {
    // group_id is the authority, not group_key: the LEFT JOIN yields NULL
    // columns both when a service has no pillar AND when its pillar exists but
    // is inactive. Both belong in the leftovers.
    const grouped = Boolean(row.group_id);
    const key = grouped ? row.group_key : UNGROUPED;

    let group = byKey.get(key);
    if (!group) {
      group = {
        key: grouped ? row.group_key : null,
        name_fr: grouped ? row.group_name_fr : null,
        name_en: grouped ? row.group_name_en : null,
        icon: grouped ? row.group_icon : null,
        services: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.services.push(toService(row));
  }

  return { groups };
}

module.exports = { groupServices, UNGROUPED };
