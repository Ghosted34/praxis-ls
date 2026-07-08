"use strict";
// 'permission.changed' matches the event key already seeded in
// migrations/seeds/9020_seed_rbac_events.sql (is_high_priority=true —
// Watch-the-Watcher, PRD §5.7), so CREATED/UPDATED/ARCHIVED all map to it.
module.exports = { MODULE: "MOD-67", CREATED: "permission.changed", UPDATED: "permission.changed", ARCHIVED: "permission.changed" };
