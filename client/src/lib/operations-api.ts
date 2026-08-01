/**
 * Operations API helpers (typed) — dossiers (operation files), transit orders,
 * delivery notes, milestones. Routes mirror src/modules/operations/*.
 */
import { tenant } from "./api-client";

/* ── Operation files / dossiers(/operations) ── */
export type Dossier = {
  dossier_id: string;
  ref: string;
  entity_id?: string | null;
  client_id?: string | null;
  service_type_id?: string | null;
  status: string;
  incoterm?: string | null;
  bl_mawb?: string | null;
  vessel_flight?: string | null;
  // Free text = display snapshot; *_place_id = the geo_place reference (0479),
  // which is what gives the Control Tower map exact coordinates.
  pol?: string | null;
  pod?: string | null;
  pol_place_id?: string | null;
  pod_place_id?: string | null;
  customs_regime?: string | null;
  eta?: string | null;
  ata?: string | null;
  created_at?: string;
  // enriched by list() join (read-only display fields)
  client_name?: string | null;
  service_key?: string | null;
  service_name_en?: string | null;
  service_name_fr?: string | null;
  service_territory?: string | null;
  costing_total?: number | string | null;
  milestone_total?: number | null;
  milestone_done?: number | null;
  current_milestone?: string | null;
};
export type DossierInput = {
  entity_id: string;
  client_id?: string;
  service_type_id?: string;
  incoterm?: string;
  bl_mawb?: string;
  pol?: string;
  pod?: string;
  // Nullable, not just optional: clearing a picked port must send an explicit
  // null so the stale reference is dropped rather than silently retained.
  pol_place_id?: string | null;
  pod_place_id?: string | null;
  customs_regime?: string;
};
export const listDossiers = () => tenant<Dossier[]>("/operations");
export const getDossier = (id: string) => tenant<Dossier & { lines?: unknown[] }>(`/operations/${id}`);
export const dossier360 = (id: string) => tenant<Record<string, unknown>>(`/operations/${id}/360`);
export const createDossier = (body: DossierInput) => tenant<Dossier>("/operations", { method: "POST", body });
export const updateDossier = (id: string, body: Partial<DossierInput>) => tenant<Dossier>(`/operations/${id}`, { method: "PATCH", body });
export const transitionDossier = (id: string, to: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") =>
  tenant<Dossier>(`/operations/${id}/transition`, { method: "POST", body: { to } });

/* ── Transit orders(/transit-orders) ── */
export type TransitOrder = {
  transit_order_id: string;
  ref?: string | null;
  dossier_id?: string | null;
  entity_id?: string | null;
  customs_regime?: string | null;
  service_direction?: string | null;
  declared_value?: number | null;
  status?: string | null;
  created_at?: string;
};
export type TransitOrderInput = {
  entity_id: string;
  dossier_id?: string;
  customs_regime?: string;
  service_direction?: string;
  declared_value?: number;
  submitted_docs?: unknown[];
  lines?: { inventory_item_id: string; label?: string; packages?: number; weight?: string }[];
  date?: string;
};
export const listTransitOrders = () => tenant<TransitOrder[]>("/transit-orders");
export const createTransitOrder = (body: TransitOrderInput) => tenant<TransitOrder>("/transit-orders", { method: "POST", body });
export const updateTransitOrder = (id: string, body: Partial<TransitOrderInput>) => tenant<TransitOrder>(`/transit-orders/${id}`, { method: "PATCH", body });

/* ── Delivery notes(/delivery-notes) ── */
export type DeliveryNote = {
  delivery_note_id: string;
  ref?: string | null;
  dossier_id?: string | null;
  entity_id?: string | null;
  consignee?: string | null;
  city_zone?: string | null;
  contact_person?: string | null;
  status?: string | null;
  created_at?: string;
};
export type DeliveryNoteInput = {
  entity_id: string;
  dossier_id?: string;
  consignee?: string;
  city_zone?: string;
  contact_person?: string;
  lines?: { inventory_item_id: string; label?: string; qty?: number }[];
  date?: string;
};
export const listDeliveryNotes = () => tenant<DeliveryNote[]>("/delivery-notes");
export const createDeliveryNote = (body: DeliveryNoteInput) => tenant<DeliveryNote>("/delivery-notes", { method: "POST", body });

/* ── Places (/geo-places) — POL/POD reference data for the route pickers ── */
export type GeoPlace = {
  geo_place_id: string;
  name: string;
  country?: string | null;
  kind?: string | null;
  latitude: string | number;
  longitude: string | number;
  source?: string | null;
};
export const listGeoPlaces = (q?: string) =>
  tenant<GeoPlace[]>(`/geo-places${q ? `?q=${encodeURIComponent(q)}` : ""}`);
export const createGeoPlace = (body: {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  kind?: string;
}) => tenant<GeoPlace>("/geo-places", { method: "POST", body });

/* ── Milestones(/milestones) — templates + per-dossier instances ── */
export type MilestoneTemplate = {
  milestone_template_id?: string;
  code?: string;
  label_fr?: string;
  label_en?: string | null;
  stage_seq?: number;
  default_offset_days?: number | null;
  service_type_id?: string | null;
};
export type MilestoneInstance = {
  milestone_instance_id: string;
  dossier_id: string;
  code?: string;
  label_fr?: string;
  status: string;
  due_date?: string | null;
  completed_at?: string | null;
};
export const listMilestoneTemplates = () => tenant<MilestoneTemplate[]>("/milestones/templates");
export const milestonesByDossier = (dossierId: string) => tenant<MilestoneInstance[]>(`/milestones/dossier/${dossierId}`);
export type MilestoneStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "BLOCKED";

/**
 * Move a milestone to a new status.
 *
 * `to` is REQUIRED by the validator (`milestone.validator.js:7`) but this helper
 * never sent it — so every advance from the UI returned 422 VALIDATION_ERROR.
 * Defaults to DONE, which is what the single "advance" button in the milestones
 * screen means; pass `to` explicitly for the IN_PROGRESS / BLOCKED transitions.
 */
export const advanceMilestone = (
  id: string,
  body: { to?: MilestoneStatus; evidence_vault_id?: string } = {},
) =>
  tenant<MilestoneInstance>(`/milestones/${id}/advance`, {
    method: "POST",
    body: { to: body.to || "DONE", ...(body.evidence_vault_id ? { evidence_vault_id: body.evidence_vault_id } : {}) },
  });

/**
 * Seed a dossier's milestone chain from its service type's active template.
 *
 * New dossiers get this automatically on create (operations_file.service
 * seedMilestones), so this is the ESCAPE HATCH, not the main path: dossiers
 * created before their service type had a template, or before auto-seeding
 * existed, have no chain and no other way to get one.
 *
 * Throws 409 ALREADY_INSTANTIATED if a chain exists (safe to offer blindly —
 * the backend refuses to duplicate) and 422 NO_TEMPLATE when the service type
 * has no active template, which is the case worth surfacing to the user: the
 * fix is to publish a template, not to retry.
 */
export const instantiateMilestones = (body: { dossierId: string; serviceTypeId: string; baseDate?: string | null }) =>
  tenant<MilestoneInstance[]>("/milestones/instantiate", {
    method: "POST",
    // base_date is `.optional()` and NOT `.nullable()` in the validator, so an
    // explicit null is a 422. Omit the key entirely when absent — the service
    // then defaults the base to today.
    body: {
      dossier_id: body.dossierId,
      service_type_id: body.serviceTypeId,
      ...(body.baseDate ? { base_date: body.baseDate } : {}),
    },
  });

export type OverviewPerson = { user_id: string; name?: string | null } | null;
export type DossierOverview = {
  dossier: { dossier_id: string; ref: string; status: string; client_id?: string | null; service_type_id?: string | null };
  /** Lifecycle readiness — powers the "ready to complete / fully collected" prompt. */
  readiness?: { milestones_complete: boolean; fully_collected: boolean; ready_to_complete: boolean } | null;
  costing: { count: number; planned_cost?: number | null };
  costs: { actual_cost?: number | null; gl_entries: number };
  invoicing: { count: number; invoiced_ttc?: number | null; billed_ttc?: number | null; outstanding?: number | null };
  economics?: { billed_ttc?: number | null; actual_cost?: number | null; gross_margin?: number | null; margin_percent?: number | null } | null;
  /** Money breakdown; margin keys arrive nulled for roles masked on dossier.margin. */
  money?: {
    service_ht?: number | null;
    debours_total?: number | null;
    vat_total?: number | null;
    revenue_ht?: number | null;
    billed_ttc?: number | null;
    planned_service_cost?: number | null;
    planned_debours?: number | null;
    planned_cost?: number | null;
    actual_cost?: number | null;
    dossier_margin?: number | null;
    margin_percent?: number | null;
    budget?: { budget?: number | null; actual?: number | null; variance?: number | null; variance_percent?: number | null; over_budget?: boolean | null } | null;
  } | null;
  /** SoD chain on the latest costing + latest locked final invoice. */
  people?: {
    costing?: { doc_number?: string | null; status?: string | null; validator: OverviewPerson; approver: OverviewPerson } | null;
    invoice?: { doc_number?: string | null; status?: string | null; issuer: OverviewPerson; validator: OverviewPerson; approver: OverviewPerson } | null;
  } | null;
  milestones: Record<string, number>;
  procurement: { po_count: number; po_total?: number | null };
  documents: { transit_orders: number; delivery_notes: number };
  document_rows?: {
    invoices?: { invoice_id: string; ref?: string | null; status?: string | null; total_ttc?: number | null; type?: string | null; created_at?: string }[];
    transit: { transit_order_id: string; ref?: string | null; customs_regime?: string | null; service_direction?: string | null; declared_value?: number | null; created_at?: string }[];
    delivery: { delivery_note_id: string; ref?: string | null; consignee?: string | null; city_zone?: string | null; created_at?: string }[];
    vault: { doc_id: string; doc_type?: string | null; status?: string | null; entity_ref?: string | null; version_no?: number | null; created_at?: string }[];
  } | null;
};
/** 360° rollup for one operation file; money fields are role-masked server-side. */
export const getOverview = (id: string) => tenant<DossierOverview>(`/operations/${id}/360`);
