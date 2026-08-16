"use strict";

/**
 * MOD-30 events.
 *
 * `transit_order.created` is kept and still means what the seeded milestone
 * chains already bind it to (9091/0680, stage T1_LODGED) — renaming it would
 * silently unhook every tenant's chain. The lifecycle states added in 0692 get
 * their own event each, so a chain can be re-pointed at the moment that
 * actually matters for it: SIGNED is the authorisation, LODGED is the filing.
 */
module.exports = {
  MODULE: "MOD-30",
  CREATED: "transit_order.created",
  UPDATED: "transit_order.updated",
  ISSUED: "transit_order.issued",
  SIGNED: "transit_order.signed",
  LODGED: "transit_order.lodged",
  CANCELLED: "transit_order.cancelled",
  ARCHIVED: "transit_order.archived",
};
