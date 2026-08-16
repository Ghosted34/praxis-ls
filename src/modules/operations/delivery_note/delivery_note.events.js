"use strict";
/**
 * MOD-32 event keys. Seeded in `migrations/tenant/10696_delivery_note_events.sql`.
 *
 * DELIVERED is the one worth wiring a milestone to: it is the only key that
 * means goods actually reached the client. `CREATED` means somebody opened a
 * form.
 */
module.exports = {
  MODULE: "MOD-32",
  CREATED: "delivery_note.created",
  UPDATED: "delivery_note.updated",
  ISSUED: "delivery_note.issued",
  DELIVERED: "delivery_note.delivered",
  CANCELLED: "delivery_note.cancelled",
  ARCHIVED: "delivery_note.archived",
};
