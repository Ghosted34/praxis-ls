/**
 * What a person at a client may see in the client portal (migration 14150) —
 * the three plain choices the redesign settled on, labelled the way the
 * client's own admin reads them in their portal.
 */
export type PortalScope = "ALL" | "OPERATIONS" | "BILLING";

export const SCOPE_LABEL: Record<PortalScope, string> = {
  ALL: "Everything",
  OPERATIONS: "Shipments & documents",
  BILLING: "Billing",
};
