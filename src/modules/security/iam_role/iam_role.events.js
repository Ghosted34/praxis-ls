"use strict";
// 'role.changed' matches the security-critical event key seeded in
// migrations/seeds/9020_seed_rbac_events.sql (is_security_critical=true —
// Watch-the-Watcher, PRD §5.7). Role create/edit/archive all map to it, same
// convention as permission.changed / field_visibility.changed. Before this the
// module emitted iam_role.created/updated/archived, which are NOT seeded as
// security-critical — so role edits silently never reached the watchers.
module.exports = {
  MODULE: "MOD-67",
  CREATED: "role.changed",
  UPDATED: "role.changed",
  ARCHIVED: "role.changed",
};
