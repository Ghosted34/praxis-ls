/**
 * Sales & Procurement — declared in PR-1, flipped to live by PR-3.
 *
 * No `values()` here yet is the design, not an omission: hidden entries carry
 * identity (id, grant gate, labels) so the migration can seed toward stable
 * ids, while the query ships with its domain PR. The self-check in index.js
 * enforces the pairing — a live entry without a value source, or a hidden one
 * that quietly gained one, both fail at require time.
 */
"use strict";

const ENTRIES = [
  {
    id: "pipeline_won",
    domain: "sales_procurement",
    unit: "money",
    module: "MOD-24",
    sourceRelation: "opportunity",
    status: "hidden",
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
    status: "hidden",
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
    status: "hidden",
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
    status: "hidden",
    labelKey: "dash.purchaseRequests",
    hintKey: "dash.purchaseRequestsHint",
    badgeKey: null,
    tone: "mute",
    icon: "files",
    drillTo: "/procurement/purchase-requests",
    sensitive_field: null,
  },
];

async function values() {
  return {};
}

module.exports = { ENTRIES, values };
