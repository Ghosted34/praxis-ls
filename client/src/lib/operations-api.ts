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
  // The carrier this job moves on (MOD-10 rate_provider) — scopes every
  // costing line's expense-rate lookup. NULL until confirmed.
  rate_provider_id?: string | null;
  // enriched by list() join (read-only display fields)
  rate_provider_name?: string | null;
  rate_provider_kind?: string | null;
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
  // Nullable, not just optional: clearing a picked carrier must send an
  // explicit null so the stale reference is dropped, same convention as
  // pol_place_id/pod_place_id above.
  rate_provider_id?: string | null;
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

/* ── Service taxonomy (/service-types) ────────────────────────────────────────
 * "Services as DATA, not code" (0310_operations.sql:7). Had no module until
 * 2026-08-01, so a fresh tenant could not define its own services — and because
 * milestone templates hang off a service type, could not have milestone chains
 * either. `has_active_template` is surfaced because a service type without one
 * silently yields dossiers with no milestones.
 */
export type ServiceType = {
  service_type_id: string;
  key: string;
  name_fr: string;
  name_en?: string | null;
  territory?: string | null;
  is_system?: boolean;
  is_active?: boolean;
  created_at?: string | null;
  template_versions?: number;
  has_active_template?: boolean;
};
export type ServiceTypeInput = {
  key?: string;
  name_fr?: string;
  name_en?: string | null;
  territory?: string | null;
  is_active?: boolean;
};
// Kept in step with TERRITORY in src/modules/operations/service_type/
// service_type.validator.js — the seeded service types (9080) use the last
// three, and a picker that cannot offer them makes those rows uneditable.
export const TERRITORIES = [
  "INTERNATIONAL_IMPORT",
  "INTERNATIONAL_EXPORT",
  "DOMESTIC_INLAND",
  "CROSS_BORDER",
  "TRANSIT_HINTERLAND",
  "PORT_AIRPORT_ZONE",
  "END_TO_END_INTERNATIONAL",
  "OTHER",
] as const;

export const listServiceTypes = (opts: { q?: string; includeInactive?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set("q", opts.q);
  if (opts.includeInactive) p.set("includeInactive", "1");
  const qs = p.toString();
  return tenant<ServiceType[]>(`/service-types${qs ? `?${qs}` : ""}`);
};
export const createServiceType = (body: ServiceTypeInput) =>
  tenant<ServiceType>("/service-types", { method: "POST", body });
export const updateServiceType = (id: string, body: ServiceTypeInput) =>
  tenant<ServiceType>(`/service-types/${id}`, { method: "PATCH", body });
/** Deactivates, not deletes — dossiers reference service types by FK. */
export const archiveServiceType = (id: string) =>
  tenant<ServiceType>(`/service-types/${id}`, { method: "DELETE" });

/* ── Service type 360° — every collection returned defaults to [] for a brand
 * new service type, and money keys arrive masked (`money.masked`) for callers
 * without finance visibility (MOD-09). Mirrors the party-360 shape. */
export type ServiceTypeTemplateStage = {
  stage_id: string;
  stage_seq: number | string;
  code: string;
  label_fr: string;
  label_en?: string | null;
  default_offset_days: number;
};
export type ServiceTypeTemplate = {
  milestone_template_id: string;
  version: number;
  is_active: boolean;
  created_at?: string;
  stages: ServiceTypeTemplateStage[];
};
export type ServiceTypeDictionaryItem = {
  dictionary_item_id: string;
  code: string;
  label_fr: string;
  label_en?: string | null;
  category: "disbursement" | "service" | "overhead" | "asset" | "other";
  is_disbursement: boolean;
  is_billable: boolean;
  default_price?: number | string | null;
  currency?: string | null;
  shipping_line?: string | null;
  service_type_key?: string | null;
  /**
   * The lowest bundle this line belongs to, from service_type_dictionary_item
   * (0630). Nested: BASIC ⊆ ADVANCED ⊆ FULL, so a line tagged BASIC surfaces at
   * every tier and a FULL one only at FULL. Present on SCOPED rows only — the
   * "applies to any service" bucket has no tier because it is not scoped to
   * this service at all.
   */
  tier?: "BASIC" | "ADVANCED" | "FULL" | null;
  is_active: boolean;
};
export type ServiceTypeDossierRow = {
  dossier_id: string;
  ref: string;
  title?: string | null;
  status: string;
  created_at?: string;
  client_id?: string | null;
  client_name?: string | null;
  billed_ttc: number | string;
  milestone_total: number;
  milestone_done: number;
  current_milestone?: string | null;
};
export type ServiceTypeMarginSim = {
  margin_simulation_id: string;
  dossier_id?: string | null;
  dossier_ref?: string | null;
  currency: string;
  margin_percent?: number | string | null;
  total_cost: number | string;
  total_price: number | string;
  created_at?: string;
};
export type ServiceTypeInvoiceRow = {
  invoice_id: string;
  doc_number?: string | null;
  currency: string;
  total_ttc: number | string;
  status: string;
  payment_due_on?: string | null;
  created_at?: string;
  dossier_id?: string | null;
  dossier_ref?: string | null;
  client_name?: string | null;
};
export type ServiceTypeMoneyRollup = {
  planned: { currency: string; planned_total: number | string; planned_disbursement: number | string }[];
  billed: { currency: string; billed_ttc: number | string; revenue_ht: number | string; invoice_count: number }[];
  actual_total: number;
  masked: boolean;
};
export type ServiceTypeDossier = {
  service_type: ServiceType;
  stats: {
    dossiers_total: number;
    dossiers_open: number;
    dossiers_in_progress: number;
    dossiers_completed: number;
    dossiers_cancelled: number;
    template_versions: number;
    active_template_version: number | null;
    dictionary_items: number;
    margin_simulations: number;
  };
  readiness: {
    has_active_template: boolean;
    active_template_version: number | null;
    has_dictionary_line: boolean;
    ever_used: boolean;
    /** null when finance is masked — the UI should not imply "no revenue" from a masked view. */
    ever_billed: boolean | null;
  };
  templates: ServiceTypeTemplate[];
  dictionary_items: ServiceTypeDictionaryItem[];
  dictionary_items_generic: ServiceTypeDictionaryItem[];
  dossiers: ServiceTypeDossierRow[];
  dossiers_more: number;
  margin_simulations: ServiceTypeMarginSim[];
  margin_simulations_more: number;
  invoices: ServiceTypeInvoiceRow[];
  money: ServiceTypeMoneyRollup;
};

export const getServiceTypeDossier = (id: string) =>
  tenant<ServiceTypeDossier>(`/service-types/${id}/360`);

/* ── The tier matrix (ST-360 → Dictionary) ─────────────────────────────────
 * `tier` is the LOWEST bundle a line appears in: the sets nest, so moving a
 * line to BASIC makes every ADVANCED and FULL costing pull it too. PUT is an
 * upsert, so "add this line at Basic" and "move it from Full to Basic" are the
 * same call. DELETE unlinks the line from this service — it never deletes the
 * catalogue row, which stays available to every other service. */
/** The three nested bundles. Mirrors `Tier` in masterdata-api (the dictionary
 *  side of the same join) — declared here so this module has no cross-import
 *  just for a string union. */
export type Tier = "BASIC" | "ADVANCED" | "FULL";
export type ServiceTypeTierLink = {
  service_type_id: string;
  dictionary_item_id: string;
  tier: Tier;
  sort_order?: number;
};
export const setServiceTypeDictionaryTier = (serviceTypeId: string, itemId: string, tier: Tier) =>
  tenant<ServiceTypeTierLink>(`/service-types/${serviceTypeId}/dictionary/${itemId}`, {
    method: "PUT",
    body: { tier },
  });
export const removeServiceTypeDictionaryTier = (serviceTypeId: string, itemId: string) =>
  tenant<ServiceTypeTierLink>(`/service-types/${serviceTypeId}/dictionary/${itemId}`, { method: "DELETE" });

/**
 * Publish a NEW active milestone-template version for a service type.
 *
 * The endpoint has existed since the milestone module was written; nothing in
 * the client ever called it, so templates could only be created by the sandbox
 * seed. Publishing supersedes the previous version (`deactivateOthers`) — it
 * does not edit in place, so dossiers already instantiated keep their stages.
 */
/**
 * Publish a new ACTIVE template version.
 *
 * The body carries the whole scheduling shape, not just labels — the backend
 * validator (milestone.validator.js) bounds it at 3..15 stages, weight 0..100
 * and a known owner tier, and the DB caps the count at 15 as well.
 */
export const publishMilestoneTemplate = (body: {
  service_type_id: string;
  stages: MilestoneStage[];
}) => tenant<MilestoneTemplate[]>("/milestones/templates", { method: "POST", body });

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

/** Who a stage's delay is charged to when it slips (0650). */
export type OwnerTier = "INTERNAL" | "CARRIER" | "TERMINAL" | "AUTHORITY" | "CLIENT";
export const OWNER_TIERS: OwnerTier[] = ["INTERNAL", "CARRIER", "TERMINAL", "AUTHORITY", "CLIENT"];

/** Human labels — never render the SCREAMING_ENUM (FRONTEND_GUIDE §5). */
export const OWNER_TIER_LABEL: Record<OwnerTier, string> = {
  INTERNAL: "Internal ops",
  CARRIER: "Carrier",
  TERMINAL: "Terminal / port",
  AUTHORITY: "Customs / authority",
  CLIENT: "Client",
};

export const CADENCES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type Cadence = (typeof CADENCES)[number];

/**
 * One stage of a milestone template.
 *
 * `weight` and `min_duration_hours` are the scheduling half: weight is the
 * stage's share of the chain's horizon (summing to 100 per segment), and the
 * floor is what stops a locked SLA compressing it into an impossible schedule.
 */
export type MilestoneStage = {
  stage_id?: string;
  stage_seq?: number;
  code: string;
  label_fr: string;
  label_en?: string | null;
  default_offset_days?: number | null;
  weight?: number | null;
  min_duration_hours?: number | null;
  owner_tier?: OwnerTier | null;
  is_anchor?: boolean;
  is_target_lock?: boolean;
  is_client_visible?: boolean;
  is_optional?: boolean;
  chain_segment?: string | null;
  cadence?: Cadence | null;
  required_evidence_doc_type?: string | null;
  auto_advance_on_event?: string | null;
  is_system?: boolean;
  system_code?: string | null;
};

export type MilestoneTemplate = {
  milestone_template_id?: string;
  code?: string;
  label_fr?: string;
  label_en?: string | null;
  stage_seq?: number;
  default_offset_days?: number | null;
  service_type_id?: string | null;
};

/** The shipped default chain — drift comparison and "restore the default". */
export const milestoneSystemDefault = (serviceTypeId: string) =>
  tenant<MilestoneStage[]>(`/milestones/system-default/${serviceTypeId}`);
/**
 * One milestone on a dossier.
 *
 * THE THREE DATES are the shape everything else here follows: `baseline_due` is
 * frozen at instantiation and is the yardstick variance is measured against;
 * `planned_due` is the commitment the client was given; `forecast_due` is what
 * we actually believe. They diverge on purpose — a delay moves the commitment,
 * an early finish moves only the forecast.
 */
export type MilestoneInstance = {
  milestone_instance_id: string;
  dossier_id: string;
  code?: string;
  label?: string;
  label_fr?: string;
  label_en?: string | null;
  status: string;
  stage_seq?: number;
  due_date?: string | null;
  baseline_due?: string | null;
  planned_due?: string | null;
  forecast_due?: string | null;
  completed_at?: string | null;
  health?: string | null;
  owner_tier?: OwnerTier | null;
  weight?: number | null;
  is_anchor?: boolean;
  is_target_lock?: boolean;
  is_client_visible?: boolean;
  is_ad_hoc?: boolean;
  variance_hours?: number | null;
  attributed_to?: OwnerTier | null;
  cause_reason_code?: string | null;
  required_evidence_doc_type?: string | null;
  reopen_reason?: string | null;
};

/** Health of an open milestone against its commitment (milestone.schedule). */
export const MILESTONE_HEALTH_LABEL: Record<string, string> = {
  OK: "On plan",
  DUE: "Due soon",
  AT_RISK: "At risk",
  DELAYED: "Late",
  BREACH_FORECAST: "Will miss the SLA",
  DONE: "Done",
  BLOCKED: "Blocked",
};

export const milestoneHealthTone = (health?: string | null): "ok" | "warn" | "bad" | "orange" | "mute" => {
  switch (String(health || "").toUpperCase()) {
    case "DONE": return "ok";
    case "DUE": return "warn";
    case "AT_RISK": return "orange";
    case "DELAYED":
    case "BREACH_FORECAST": return "bad";
    case "BLOCKED": return "mute";
    default: return "ok";
  }
};

/** Un-complete a milestone marked DONE in error. The reason is the point. */
export const reopenMilestone = (id: string, reason: string) =>
  tenant<MilestoneInstance>(`/milestones/${id}/reopen`, { method: "POST", body: { reason } });

/** Insert a stage into a LIVE chain, between two existing ones. */
export const addDossierMilestone = (
  dossierId: string,
  body: {
    after_seq: number;
    code: string;
    label: string;
    label_en?: string;
    weight?: number;
    min_duration_hours?: number;
    owner_tier?: OwnerTier;
    is_client_visible?: boolean;
  },
) => tenant<MilestoneInstance>(`/milestones/dossier/${dossierId}/stages`, { method: "POST", body });

/** Force a re-baseline — used after a promised date changes. */
export const recalculateMilestones = (dossierId: string) =>
  tenant<{ changed: number; meta: unknown }>(`/milestones/dossier/${dossierId}/recalculate`, {
    method: "POST",
    body: { trigger: "MANUAL" },
  });
export const listMilestoneTemplates = () => tenant<MilestoneTemplate[]>("/milestones/templates");
export const milestonesByDossier = (dossierId: string) => tenant<MilestoneInstance[]>(`/milestones/dossier/${dossierId}`);
export type MilestoneStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "BLOCKED";

/**
 * Legal transitions — mirrors `milestone.rules.js` ALLOWED. Kept in step with the
 * backend deliberately: the server rejects anything else with 422 BAD_TRANSITION,
 * so guessing here (an earlier version defaulted straight to DONE) produces a
 * button that silently does nothing.
 */
export const MILESTONE_TRANSITIONS: Record<string, MilestoneStatus[]> = {
  PENDING: ["IN_PROGRESS", "BLOCKED"],
  IN_PROGRESS: ["DONE", "BLOCKED"],
  BLOCKED: ["IN_PROGRESS", "PENDING"],
  DONE: [],
};

/** The forward step for a status — PENDING → IN_PROGRESS → DONE. Null when done. */
export const nextMilestoneStatus = (status?: string | null): MilestoneStatus | null => {
  const s = String(status || "PENDING").toUpperCase();
  if (s === "PENDING" || s === "BLOCKED") return "IN_PROGRESS";
  if (s === "IN_PROGRESS") return "DONE";
  return null;
};

/** Verb for the forward step, so the button says what it will actually do. */
export const milestoneAdvanceLabel = (status?: string | null): string =>
  nextMilestoneStatus(status) === "DONE" ? "Complete" : "Start";

/**
 * Move a milestone to a new status.
 *
 * `to` is REQUIRED by the validator (`milestone.validator.js:7`) and this helper
 * never sent it, so every advance from the UI returned 422 VALIDATION_ERROR — the
 * button had never worked. It is now explicit: callers pass the target state,
 * which must be legal for the current one (see MILESTONE_TRANSITIONS).
 */
export const advanceMilestone = (
  id: string,
  body: { to: MilestoneStatus; evidence_vault_id?: string },
) =>
  tenant<MilestoneInstance>(`/milestones/${id}/advance`, {
    method: "POST",
    body: { to: body.to, ...(body.evidence_vault_id ? { evidence_vault_id: body.evidence_vault_id } : {}) },
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
    disbursement_total?: number | null;
    vat_total?: number | null;
    revenue_ht?: number | null;
    billed_ttc?: number | null;
    planned_service_cost?: number | null;
    planned_disbursement?: number | null;
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
