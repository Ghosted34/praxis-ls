/**
 * Sales & Procurement — declared in PR-1, flipped to live by PR-3.
 *
 * Four tiles, and each is a QUEUE rather than a total: what has not been
 * answered, received or converted yet. That shape is why all four are counts
 * and why 0 is always the truth for them — "nothing is waiting" is a real
 * state of a working pipeline, not an absence of data, so none of these ever
 * hides on an installed tenant. The one figure that is a total, pipeline_won,
 * is a sum over a period, and a period always exists.
 *
 * Where each queue ENDS, stated because every one of these is a definition:
 *
 *   pipeline_won         `opportunity` WON, settled this calendar month. The
 *                        settle date, not created_at: the month you win it in
 *                        is the month it counts for.
 *   quote_requests_open  RECEIVED / UNDER_REVIEW / CLARIFICATION_REQUIRED —
 *                        everything a client is still waiting on us for.
 *                        QUOTED has been answered; CONVERTED and
 *                        CLOSED_NO_ACTION are done.
 *   pos_in_flight        issued and not yet received: a PO the supplier owes
 *                        goods against, measured by the absence of a
 *                        `grn_inbound` row rather than by status alone, so a
 *                        PO whose goods arrived without its status being moved
 *                        stops counting when the GRN lands, not when someone
 *                        remembers.
 *   purchase_requests    SUBMITTED / APPROVED — raised and not yet turned into
 *                        a PO. ORDERED is converted; DRAFT is nobody's queue
 *                        but its author's.
 */
"use strict";

const ENTRIES = [
  {
    id: "pipeline_won",
    domain: "sales_procurement",
    unit: "money",
    module: "MOD-24",
    sourceRelation: "opportunity",
    status: "live",
    labelKey: "dash.pipelineWon",
    hintKey: "dash.pipelineWonHint",
    badgeKey: "dash.pipelineWonBadge",
    tone: "ok",
    icon: "revenue",
    drillTo: "/sales/opportunities",
    sensitive_field: null,
  },
  {
    id: "quote_requests_open",
    domain: "sales_procurement",
    unit: "count",
    module: "MOD-20",
    sourceRelation: "quote_request",
    status: "live",
    labelKey: "dash.quoteRequestsOpen",
    hintKey: "dash.quoteRequestsOpenHint",
    badgeKey: null,
    tone: "blue",
    icon: "proforma",
    drillTo: "/sales/quote-requests",
    sensitive_field: null,
  },
  {
    id: "pos_in_flight",
    domain: "sales_procurement",
    unit: "count",
    module: "MOD-60",
    sourceRelation: "purchase_order",
    status: "live",
    labelKey: "dash.posInFlight",
    hintKey: "dash.posInFlightHint",
    badgeKey: null,
    tone: "warn",
    icon: "truck",
    drillTo: "/procurement/purchase-orders",
    sensitive_field: null,
  },
  {
    id: "purchase_requests",
    domain: "sales_procurement",
    unit: "count",
    module: "MOD-62",
    sourceRelation: "purchase_request",
    status: "live",
    labelKey: "dash.purchaseRequests",
    hintKey: "dash.purchaseRequestsHint",
    badgeKey: null,
    tone: "mute",
    icon: "files",
    drillTo: "/procurement/purchase-requests",
    sensitive_field: null,
  },
];

async function values(client, { num, count }) {
  const out = {};
  out.pipeline_won = await num(
    client,
    "SELECT COALESCE(SUM(estimated_value), 0) n FROM opportunity " +
      "WHERE status = 'WON' AND settled_at >= date_trunc('month', CURRENT_DATE)",
  );
  out.quote_requests_open = await count(
    client,
    "SELECT count(*) n FROM quote_request " +
      "WHERE status IN ('RECEIVED','UNDER_REVIEW','CLARIFICATION_REQUIRED')",
  );
  out.pos_in_flight = await count(
    client,
    "SELECT count(*) n FROM purchase_order po " +
      "WHERE po.status IN ('ISSUED_LOCKED','APPROVED_LOCKED','PARTIAL') " +
      "AND NOT EXISTS (SELECT 1 FROM grn_inbound g WHERE g.po_id = po.po_id)",
  );
  out.purchase_requests = await count(
    client,
    "SELECT count(*) n FROM purchase_request WHERE status IN ('SUBMITTED','APPROVED')",
  );
  return out;
}

module.exports = { ENTRIES, values };
