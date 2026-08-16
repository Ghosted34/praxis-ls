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
export const getDossier = (id: string) =>
  tenant<Dossier & { lines?: unknown[] }>(`/operations/${id}`);
export const dossier360 = (id: string) =>
  tenant<Record<string, unknown>>(`/operations/${id}/360`);
export const createDossier = (body: DossierInput) =>
  tenant<Dossier>("/operations", { method: "POST", body });
/**
 * The creation wizard's two halves.
 *
 * `createDossierDraft` opens a DRAFT so documents can be attached before the
 * file is finished — the vault needs a real `dossier_id`, and the alternative is
 * that nothing is ever attached at creation. It burns no ref and fires no
 * `dossier.created`, so an abandoned draft leaves no gap in the numbering and
 * schedules no milestones.
 *
 * `promoteDossier` is where it becomes a file: the ref is allocated, the service
 * type's required fields are enforced, and the milestone chain is instantiated.
 * Deliberately NOT reachable through `transitionDossier` — going that way would
 * skip all three.
 */
export const createDossierDraft = (body: DossierInput) =>
  tenant<Dossier>("/operations/drafts", { method: "POST", body });
export const promoteDossier = (
  id: string,
  body: Partial<DossierInput> & { details?: Record<string, unknown> },
) => tenant<Dossier>(`/operations/${id}/promote`, { method: "POST", body });
export const updateDossier = (id: string, body: Partial<DossierInput>) =>
  tenant<Dossier>(`/operations/${id}`, { method: "PATCH", body });
export const transitionDossier = (
  id: string,
  to: "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
) =>
  tenant<Dossier>(`/operations/${id}/transition`, {
    method: "POST",
    body: { to },
  });

/* ── Transit orders(/transit-orders) ── */
/**
 * The transit order is a lifecycle document, not a row: DRAFT → ISSUED →
 * SIGNED → LODGED (or CANCELLED). A number is allocated at ISSUE, so a draft
 * has `ref: null` — the list must not assume one is there.
 */
export const TRANSIT_STATUSES = [
  "DRAFT",
  "ISSUED",
  "SIGNED",
  "LODGED",
  "CANCELLED",
] as const;
export type TransitStatus = (typeof TRANSIT_STATUSES)[number];

export const CUSTOMS_REGIMES = ["IM4", "IM7", "IM8", "EX1", "EX2"] as const;

export type TransitOrderLine = {
  transit_order_line_id?: string;
  inventory_item_id?: string | null;
  label: string;
  marks?: string | null;
  hs_code?: string | null;
  packages?: number | null;
  weight?: string | null;
  value_amount?: number | null;
  line_no?: number | null;
};

export type TransitOrder = {
  transit_order_id: string;
  ref?: string | null;
  dossier_id?: string | null;
  entity_id?: string | null;
  status: TransitStatus;
  customs_regime?: string | null;
  customs_regime_other?: string | null;
  service_direction?: string | null;
  declared_value?: number | null;
  declared_currency?: string | null;
  declared_fx_to_xaf?: number | null;
  insurance_type?: string | null;
  surveyor_party?: string | null;
  departure_date?: string | null;
  instructions?: string | null;
  submitted_docs?: { code: string; note?: string }[] | null;
  issued_at?: string | null;
  signed_at?: string | null;
  signed_by_name?: string | null;
  signature_vault_id?: string | null;
  lodged_at?: string | null;
  declaration_ref?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_at?: string;
  // Joined for display — never stored, so a renamed client does not leave a
  // stale name on an order.
  dossier_ref?: string | null;
  client_name?: string | null;
  entity_name?: string | null;
  // Present on GET /:id only.
  lines?: TransitOrderLine[];
  totals?: {
    lines_total: number;
    declared_value: number | null;
    declared_value_xaf: number | null;
    reconciles: boolean;
  };
  shipment_details?: ShipmentDetails | null;
  /** Whether the facts shown are the frozen copy or the live file. */
  shipment_details_source?: "SNAPSHOT" | "LIVE" | null;
  /** What the server would actually accept — the buttons bind to this. */
  allowed_transitions?: TransitStatus[];
  /** Why the Issue button is disabled, in words. */
  issue_blockers?: string[];
};

export type TransitOrderInput = {
  entity_id?: string;
  dossier_id?: string;
  customs_regime?: string | null;
  customs_regime_other?: string | null;
  service_direction?: string | null;
  declared_value?: number | null;
  declared_currency?: string;
  declared_fx_to_xaf?: number;
  insurance_type?: string;
  surveyor_party?: string;
  departure_date?: string | null;
  instructions?: string | null;
  submitted_docs?: (string | { code: string; note?: string })[];
  lines?: TransitOrderLine[];
  allow_duplicate?: boolean;
};

export type TransitDocType = {
  code: string;
  label_fr: string;
  label_en: string;
};
export type TransitSummary = Record<TransitStatus | "TOTAL", number>;

export const listTransitOrders = (q?: Record<string, string>) =>
  tenant<TransitOrder[]>(
    `/transit-orders${q && Object.keys(q).length ? `?${new URLSearchParams(q)}` : ""}`,
  );
export const getTransitOrder = (id: string) =>
  tenant<TransitOrder>(`/transit-orders/${id}`);
/** Counted in the database — the tiles must not count one loaded page. */
export const transitOrderSummary = () =>
  tenant<TransitSummary>("/transit-orders/summary");
/** The checklist vocabulary, served so the form is not a hard-coded copy. */
export const transitDocTypes = () =>
  tenant<TransitDocType[]>("/transit-orders/document-types");
export const createTransitOrder = (body: TransitOrderInput) =>
  tenant<TransitOrder>("/transit-orders", { method: "POST", body });
export const updateTransitOrder = (
  id: string,
  body: Partial<TransitOrderInput>,
) => tenant<TransitOrder>(`/transit-orders/${id}`, { method: "PATCH", body });
export const issueTransitOrder = (id: string) =>
  tenant<TransitOrder>(`/transit-orders/${id}/issue`, {
    method: "POST",
    body: {},
  });
export const signTransitOrder = (
  id: string,
  body: {
    signature_vault_id?: string;
    signed_by_name?: string;
    signed_at?: string;
  },
) => tenant<TransitOrder>(`/transit-orders/${id}/sign`, { method: "POST", body });
export const lodgeTransitOrder = (id: string, declaration_ref: string) =>
  tenant<TransitOrder>(`/transit-orders/${id}/lodge`, {
    method: "POST",
    body: { declaration_ref },
  });
export const cancelTransitOrder = (id: string, reason: string) =>
  tenant<TransitOrder>(`/transit-orders/${id}/cancel`, {
    method: "POST",
    body: { reason },
  });

/* ── Delivery notes(/delivery-notes) ── */
/**
 * The delivery note is a lifecycle document: DRAFT → ISSUED → DELIVERED (or
 * CANCELLED). The number is allocated at ISSUE, so a draft has `ref: null`.
 *
 * DELIVERED is the state that matters — it means somebody signed for the goods,
 * and it is the only thing that makes this document evidence rather than a
 * printout.
 */
export const DELIVERY_STATUSES = [
  "DRAFT",
  "ISSUED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type DeliveryNoteLine = {
  delivery_note_line_id?: string;
  inventory_item_id?: string | null;
  label?: string | null;
  qty?: number | null;
};

/**
 * A container on the note. Normally a pick from the file
 * (`dossier_container_unit_id`), but a hand-typed `container_no` is allowed —
 * boxes do turn up that were never captured on the file.
 */
export type DeliveryNoteContainer = {
  delivery_note_container_id?: string;
  dossier_container_unit_id?: string | null;
  container_no?: string | null;
  seal_no?: string | null;
  gross_weight_kg?: number | null;
  notes?: string | null;
};

/** A container on the FILE, as offered by the picker. */
export type AvailableContainer = {
  dossier_container_unit_id: string;
  container_no: string | null;
  seal_no: string | null;
  gross_weight_kg?: number | null;
  container_type_code?: string | null;
  container_type_en?: string | null;
  /** Note numbers this box is already on — a split load, not necessarily wrong. */
  already_on?: string[];
};

export type DeliveryNote = {
  delivery_note_id: string;
  ref?: string | null;
  doc_number?: string | null;
  dossier_id?: string | null;
  dossier_ref?: string | null;
  entity_id?: string | null;
  client_name?: string | null;
  consignee?: string | null;
  city_zone?: string | null;
  contact_person?: string | null;
  /** Where the goods actually went. `city_zone` is a routing bucket, not this. */
  address?: string | null;
  phone?: string | null;
  /** When the goods arrived — NOT `created_at`, which is when the note was raised. */
  delivery_date?: string | null;
  status: DeliveryStatus;
  /** Who signed for the goods. The point of the whole document. */
  received_by_name?: string | null;
  received_at?: string | null;
  /** The client's own words at handover ("carton 3 crushed"). */
  reservations?: string | null;
  cancel_reason?: string | null;
  created_at?: string;
  /** Present on the detail read only. */
  lines?: DeliveryNoteLine[];
  containers?: DeliveryNoteContainer[];
  allowed_transitions?: DeliveryStatus[];
  issue_blockers?: string[];
};

export type DeliveryNoteInput = {
  entity_id?: string;
  dossier_id?: string;
  consignee?: string;
  city_zone?: string;
  contact_person?: string;
  address?: string;
  phone?: string;
  /** ISO `YYYY-MM-DD`. */
  delivery_date?: string;
  reservations?: string;
  /**
   * G23 — `inventory_item_id` was REQUIRED here, which is the dropped-line bug
   * stated in the type system: a hand-typed line could not even be expressed.
   * A line is its `label`; the stock link is optional. One of the two must be
   * present, and the server returns a field-keyed 422 naming the row if neither
   * is.
   */
  lines?: { inventory_item_id?: string | null; label?: string; qty?: number }[];
  containers?: DeliveryNoteContainer[];
};

export type DeliverySummary = Record<DeliveryStatus | "TOTAL", number>;

export const listDeliveryNotes = (q?: Record<string, string>) =>
  tenant<DeliveryNote[]>(
    `/delivery-notes${q && Object.keys(q).length ? `?${new URLSearchParams(q)}` : ""}`,
  );
export const getDeliveryNote = (id: string) =>
  tenant<DeliveryNote>(`/delivery-notes/${id}`);
/** Counted in the database — the tiles must not count one loaded page. */
export const deliveryNoteSummary = () =>
  tenant<DeliverySummary>("/delivery-notes/summary");
/** The file's containers, for the picker that replaced the legacy paste box. */
export const availableContainers = (dossierId: string, excludeNoteId?: string) =>
  tenant<AvailableContainer[]>(
    `/delivery-notes/available-containers?${new URLSearchParams({
      dossier_id: dossierId,
      ...(excludeNoteId ? { exclude_note_id: excludeNoteId } : {}),
    })}`,
  );
export const createDeliveryNote = (body: DeliveryNoteInput) =>
  tenant<DeliveryNote>("/delivery-notes", { method: "POST", body });
export const updateDeliveryNote = (id: string, body: Partial<DeliveryNoteInput>) =>
  tenant<DeliveryNote>(`/delivery-notes/${id}`, { method: "PATCH", body });
export const issueDeliveryNote = (id: string) =>
  tenant<DeliveryNote>(`/delivery-notes/${id}/issue`, { method: "POST", body: {} });
export const confirmDelivery = (
  id: string,
  body: {
    received_by_name: string;
    received_at?: string;
    reservations?: string;
    signature_vault_id?: string;
  },
) => tenant<DeliveryNote>(`/delivery-notes/${id}/deliver`, { method: "POST", body });
export const cancelDeliveryNote = (id: string, reason: string) =>
  tenant<DeliveryNote>(`/delivery-notes/${id}/cancel`, {
    method: "POST",
    body: { reason },
  });

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
  /** The two characters that close this service's operation-file references
   *  (`SM` in `SL7Z3K9QW2M4XBSM`). Frozen once a file has used it. */
  ops_reference_code?: string | null;
};
export type ServiceTypeInput = {
  key?: string;
  name_fr?: string;
  name_en?: string | null;
  territory?: string | null;
  is_active?: boolean;
  ops_reference_code?: string;
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

export const listServiceTypes = (
  opts: { q?: string; includeInactive?: boolean } = {},
) => {
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
  planned: {
    currency: string;
    planned_total: number | string;
    planned_disbursement: number | string;
  }[];
  billed: {
    currency: string;
    billed_ttc: number | string;
    revenue_ht: number | string;
    invoice_count: number;
  }[];
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
    /** A service type with no published detail form produces files that capture
     *  nothing beyond client and carrier — the same trap as a missing milestone
     *  template, surfaced in the same banner. */
    has_active_field_set: boolean;
    active_field_set_version: number | null;
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
  /** The shipment/service-detail form (0660): every version, plus the fields of
   *  whichever one is live. */
  field_sets?: ServiceTypeFieldSet[];
  field_set?: (ServiceTypeFieldSet & { fields: ServiceTypeField[] }) | null;
  containers?: {
    captures_containers: boolean;
    container_detail_mode: "GROUPED" | "PER_BOX";
  };
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
export const setServiceTypeDictionaryTier = (
  serviceTypeId: string,
  itemId: string,
  tier: Tier,
) =>
  tenant<ServiceTypeTierLink>(
    `/service-types/${serviceTypeId}/dictionary/${itemId}`,
    {
      method: "PUT",
      body: { tier },
    },
  );
export const removeServiceTypeDictionaryTier = (
  serviceTypeId: string,
  itemId: string,
) =>
  tenant<ServiceTypeTierLink>(
    `/service-types/${serviceTypeId}/dictionary/${itemId}`,
    { method: "DELETE" },
  );

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
}) =>
  tenant<MilestoneTemplate[]>("/milestones/templates", {
    method: "POST",
    body,
  });

/* ── Places (/geo-places) — the verified place catalogue behind every location
      field on a file: POL/POD, airports, inland terminals, custody sites ──── */

/** The place kinds migration 0674 allows. Ordered as the picker groups them:
 *  freight infrastructure first, then places people live, then doors. */
export const PLACE_KINDS = [
  "SEAPORT",
  "AIRPORT",
  "TERMINAL",
  "RAIL_TERMINAL",
  "BORDER_POST",
  "WAREHOUSE",
  "INLAND",
  "CITY",
  "ADDRESS",
  "OTHER",
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Human labels — never render the SCREAMING_ENUM (FRONTEND_GUIDE §5). */
export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  SEAPORT: "Seaport",
  AIRPORT: "Airport",
  TERMINAL: "Terminal",
  RAIL_TERMINAL: "Rail terminal",
  BORDER_POST: "Border post",
  WAREHOUSE: "Warehouse",
  INLAND: "Inland point",
  CITY: "City",
  ADDRESS: "Address",
  OTHER: "Other",
};

export type GeoPlace = {
  geo_place_id: string;
  /** Normalised lookup key. The dossier stores `name`; this is what matches it. */
  query_key?: string | null;
  name: string;
  country?: string | null;
  region?: string | null;
  kind?: string | null;
  /** UN/LOCODE where the place has one — CMDLA, NLRTM, SGSIN. */
  unlocode?: string | null;
  /** The provider's formatted address, or (for airports) the IATA code line. */
  formatted?: string | null;
  latitude: string | number;
  longitude: string | number;
  source?: string | null;
  provenance?: string | null;
  confidence?: string | number | null;
  /** True when this is a point NEAR the real place, agreed as a stand-in. */
  is_reference_point?: boolean | null;
  is_active?: boolean | null;
  /** When a human last confirmed it. Null = it arrived by background geocoding. */
  verified_at?: string | null;
  resolved_at?: string | null;
};

/**
 * A provider candidate. NOT a place yet — nothing is stored until the operator
 * confirms it, and the confirm call re-fetches the coordinate from the provider
 * rather than trusting anything here.
 */
export type PlaceSuggestion = {
  provider_place_id: string;
  name: string;
  formatted?: string | null;
  country?: string | null;
  region?: string | null;
  latitude: number;
  longitude: number;
  kind?: string | null;
  result_type?: string | null;
  confidence?: number | null;
};

/** Why a worldwide search returned nothing — each one a different action. */
export type PlaceProviderStatus =
  | "NOT_REQUESTED"
  | "OK"
  | "NO_KEY"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UNAUTHORISED"
  | "PROVIDER_ERROR"
  | "QUERY_TOO_SHORT";

export type PlaceSearchResult = {
  places: GeoPlace[];
  /** The catalogue already holds an exact match, so no provider call is offered. */
  has_exact: boolean;
  provider: {
    requested: boolean;
    status: PlaceProviderStatus;
    /** Operator-facing sentence, composed server-side so there is one copy. */
    message?: string | null;
    results: PlaceSuggestion[];
  };
};

/** The legacy list, still used by `SearchSelect` callers outside operations. */
export const listGeoPlaces = (q?: string) =>
  tenant<GeoPlace[]>(`/geo-places${q ? `?q=${encodeURIComponent(q)}` : ""}`);

/**
 * Search the catalogue, and — only when `provider` is true — ask Geoapify for
 * what it does not hold.
 *
 * `provider` is opt-in on purpose. Typing must never spend provider quota, and
 * the decision to search the whole world should be one a person made.
 */
export const searchGeoPlaces = (params: {
  q?: string;
  country?: string;
  kind?: PlaceKind[];
  limit?: number;
  provider?: boolean;
}) => {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.country) qs.set("country", params.country);
  (params.kind || []).forEach((k) => qs.append("kind", k));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.provider) qs.set("provider", "true");
  const query = qs.toString();
  return tenant<PlaceSearchResult>(
    `/geo-places/search${query ? `?${query}` : ""}`,
  );
};

/**
 * Cache a suggestion the operator confirmed, and get back the real place.
 *
 * Carries no coordinate: the server re-queries the provider and uses ITS answer,
 * so a coordinate cannot be forged into the catalogue with a provider's name on
 * it. `query` therefore has to be the same text the suggestion came from.
 */
export const confirmGeoPlace = (body: {
  query: string;
  provider_place_id: string;
  country?: string;
  kind?: PlaceKind;
  is_reference_point?: boolean;
}) => tenant<GeoPlace>("/geo-places/confirm", { method: "POST", body });

export const createGeoPlace = (body: {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  region?: string;
  kind?: PlaceKind;
  formatted?: string;
  unlocode?: string;
  is_reference_point?: boolean;
}) => tenant<GeoPlace>("/geo-places", { method: "POST", body });

/* ── Milestones(/milestones) — templates + per-dossier instances ── */

/** Who a stage's delay is charged to when it slips (0650). */
export type OwnerTier =
  "INTERNAL" | "CARRIER" | "TERMINAL" | "AUTHORITY" | "CLIENT";
export const OWNER_TIERS: OwnerTier[] = [
  "INTERNAL",
  "CARRIER",
  "TERMINAL",
  "AUTHORITY",
  "CLIENT",
];

/** Human labels — never render the SCREAMING_ENUM (FRONTEND_GUIDE §5). */
export const OWNER_TIER_LABEL: Record<OwnerTier, string> = {
  INTERNAL: "Internal ops",
  CARRIER: "Carrier",
  TERMINAL: "Terminal / port",
  AUTHORITY: "Customs / authority",
  CLIENT: "Client",
};

export const CADENCES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
] as const;
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

export const milestoneHealthTone = (
  health?: string | null,
): "ok" | "warn" | "bad" | "orange" | "mute" => {
  switch (String(health || "").toUpperCase()) {
    case "DONE":
      return "ok";
    case "DUE":
      return "warn";
    case "AT_RISK":
      return "orange";
    case "DELAYED":
    case "BREACH_FORECAST":
      return "bad";
    case "BLOCKED":
      return "mute";
    default:
      return "ok";
  }
};

/** Un-complete a milestone marked DONE in error. The reason is the point. */
export const reopenMilestone = (id: string, reason: string) =>
  tenant<MilestoneInstance>(`/milestones/${id}/reopen`, {
    method: "POST",
    body: { reason },
  });

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
) =>
  tenant<MilestoneInstance>(`/milestones/dossier/${dossierId}/stages`, {
    method: "POST",
    body,
  });

/** Force a re-baseline — used after a promised date changes. */
export const recalculateMilestones = (dossierId: string) =>
  tenant<{ changed: number; meta: unknown }>(
    `/milestones/dossier/${dossierId}/recalculate`,
    {
      method: "POST",
      body: { trigger: "MANUAL" },
    },
  );
export const listMilestoneTemplates = () =>
  tenant<MilestoneTemplate[]>("/milestones/templates");
export const milestonesByDossier = (dossierId: string) =>
  tenant<MilestoneInstance[]>(`/milestones/dossier/${dossierId}`);
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
export const nextMilestoneStatus = (
  status?: string | null,
): MilestoneStatus | null => {
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
    body: {
      to: body.to,
      ...(body.evidence_vault_id
        ? { evidence_vault_id: body.evidence_vault_id }
        : {}),
    },
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
export const instantiateMilestones = (body: {
  dossierId: string;
  serviceTypeId: string;
  baseDate?: string | null;
}) =>
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
  dossier: {
    dossier_id: string;
    ref: string;
    status: string;
    client_id?: string | null;
    service_type_id?: string | null;
  };
  /** Lifecycle readiness — powers the "ready to complete / fully collected" prompt. */
  readiness?: {
    milestones_complete: boolean;
    fully_collected: boolean;
    ready_to_complete: boolean;
  } | null;
  costing: { count: number; planned_cost?: number | null };
  costs: { actual_cost?: number | null; gl_entries: number };
  invoicing: {
    count: number;
    invoiced_ttc?: number | null;
    billed_ttc?: number | null;
    outstanding?: number | null;
  };
  economics?: {
    billed_ttc?: number | null;
    actual_cost?: number | null;
    gross_margin?: number | null;
    margin_percent?: number | null;
  } | null;
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
    budget?: {
      budget?: number | null;
      actual?: number | null;
      variance?: number | null;
      variance_percent?: number | null;
      over_budget?: boolean | null;
    } | null;
  } | null;
  /** SoD chain on the latest costing + latest locked final invoice. */
  people?: {
    costing?: {
      doc_number?: string | null;
      status?: string | null;
      validator: OverviewPerson;
      approver: OverviewPerson;
    } | null;
    invoice?: {
      doc_number?: string | null;
      status?: string | null;
      issuer: OverviewPerson;
      validator: OverviewPerson;
      approver: OverviewPerson;
    } | null;
  } | null;
  milestones: Record<string, number>;
  procurement: { po_count: number; po_total?: number | null };
  documents: { transit_orders: number; delivery_notes: number };
  document_rows?: {
    invoices?: {
      invoice_id: string;
      ref?: string | null;
      status?: string | null;
      total_ttc?: number | null;
      type?: string | null;
      created_at?: string;
    }[];
    transit: {
      transit_order_id: string;
      ref?: string | null;
      customs_regime?: string | null;
      service_direction?: string | null;
      declared_value?: number | null;
      created_at?: string;
    }[];
    delivery: {
      delivery_note_id: string;
      ref?: string | null;
      consignee?: string | null;
      city_zone?: string | null;
      created_at?: string;
    }[];
    vault: {
      doc_id: string;
      doc_type?: string | null;
      status?: string | null;
      entity_ref?: string | null;
      version_no?: number | null;
      created_at?: string;
    }[];
  } | null;
};
/** 360° rollup for one operation file; money fields are role-masked server-side. */
export const getOverview = (id: string) =>
  tenant<DossierOverview>(`/operations/${id}/360`);

/* ── The Shared Shipment/Service Detail Component (SSDC) ────────────────────
 *
 * The types below are the CONTRACT every consumer of an operations file binds
 * to — costing, quotation, proforma, invoice, transit order, delivery note, the
 * client portal, and whatever is built next. They are deliberately generic: a
 * consumer renders `facets` and `groups` without knowing which service type it
 * is looking at, which is what lets a service type invented years from now
 * display correctly in a screen written today.
 *
 * Backend: src/modules/operations/shipment_details/*.
 */

/** What a field MEANS to the shared panel, independent of what it is called on
 *  any particular service type. "Bill of Lading" on sea and "MAWB" on air are
 *  both TRANSPORT_REF. Mirrors chk_stf_facet_role (migration 0660). */
/**
 * Mirrors `chk_stf_facet_role` and the server's own enum.
 *
 * ORIGIN/DESTINATION are the MAIN CARRIAGE — the port pair on the bill of lading.
 * COLLECTION/FINAL_DELIVERY are the door legs either side of it (0678), and
 * DELIVERY_DATE is the commitment the milestone chain is scheduled against (0679),
 * distinct from ARRIVAL_DATE which is arrival at the port. Each is its own role
 * because the facet map is keyed by role: two fields sharing one would mean one of
 * them silently wins.
 */
export type FacetRole =
  | "TRANSPORT_REF"
  | "CONVEYANCE"
  | "CARRIER"
  | "ORIGIN"
  | "DESTINATION"
  | "ROUTE_VIA"
  | "COLLECTION"
  | "FINAL_DELIVERY"
  | "DEPARTURE_DATE"
  | "ARRIVAL_DATE"
  | "DELIVERY_DATE"
  | "CARGO_DESC"
  | "CARGO_WEIGHT"
  | "CARGO_VOLUME"
  | "CARGO_PACKAGES"
  | "CARGO_MARKS"
  | "CUSTODY_LOCATION"
  | "CUSTODY_STATUS"
  | "CUSTODY_IN"
  | "CUSTODY_OUT"
  | "INCOTERM"
  | "CUSTOMS_REF"
  | "CUSTOMS_REGIME"
  | "SCOPE_SUMMARY"
  | "COUNTERPARTY"
  | "PERIOD_START"
  | "PERIOD_END";

export type FieldDataType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "INTEGER"
  | "DATE"
  | "DATETIME"
  | "BOOLEAN"
  | "SELECT"
  | "MULTISELECT"
  | "GEO_PLACE"
  | "RATE_PROVIDER"
  | "REF"
  | "CURRENCY";

export type FieldOption = {
  value: string;
  label_fr: string;
  label_en?: string;
};

/** One field as the FORM renders it (definitions, no values). */
export type DetailFieldDef = {
  key: string;
  label: string;
  help?: string | null;
  placeholder?: string | null;
  data_type: FieldDataType;
  options?: FieldOption[];
  ref_kind?: string | null;
  validation?: {
    min?: number;
    max?: number;
    min_length?: number;
    max_length?: number;
    pattern?: string;
  };
  default_value?: unknown;
  is_required: boolean;
  is_client_visible: boolean;
  /** The system fills this one in (0670) — marks & numbers is the one that does
   *  today. Rendered locked with an unlock action; writing it is recorded as a
   *  deliberate override rather than refused. */
  is_readonly?: boolean;
  facet_role: FacetRole | null;
  column_name: string | null;
  width: "THIRD" | "HALF" | "FULL";
};
export type DetailGroupDef = {
  code: string;
  label: string;
  seq: number;
  fields: DetailFieldDef[];
};

export type DetailForm = {
  field_set: {
    service_type_field_set_id: string;
    version: number;
    name?: string | null;
  } | null;
  groups: DetailGroupDef[];
  containers: { enabled: boolean; mode: "GROUPED" | "PER_BOX" } | null;
};

/** One field as the PANEL renders it (definition + the file's value). */
export type DetailFieldValue = Omit<
  DetailFieldDef,
  | "help"
  | "placeholder"
  | "options"
  | "ref_kind"
  | "validation"
  | "default_value"
> & {
  value: unknown;
  display: string | null;
};
export type DetailGroupValue = {
  code: string;
  label: string;
  seq: number;
  fields: DetailFieldValue[];
};

/** A canonical fact about the file. `parts` names the fields behind it, so a
 *  panel can show "MSC ARUSHI / 128W" and still explain which is which. */
export type Facet = {
  role: FacetRole;
  label: string;
  value: string;
  parts: { key: string; label: string; value: string }[];
};

export type ContainerUnit = {
  dossier_container_unit_id?: string;
  container_no?: string | null;
  seal_no?: string | null;
  tare_kg?: number | null;
  gross_weight_kg?: number | null;
  temperature_c?: number | null;
  imdg_class?: string | null;
  discharged_on?: string | null;
  out_of_port_on?: string | null;
  returned_on?: string | null;
  notes?: string | null;
};
export type ContainerLine = {
  dossier_container_line_id?: string;
  seq?: number;
  container_type_ref_id: string;
  load_mode_ref_id?: string | null;
  qty: number;
  gross_weight_kg?: number | null;
  volume_cbm?: number | null;
  notes?: string | null;
  units?: ContainerUnit[];
  /** Joined from the registry (read-only). */
  container_type_code?: string;
  container_type_en?: string;
  container_type_fr?: string;
  container_type_extra?: {
    teu?: number;
    size?: string;
    family?: string;
    special?: boolean;
  };
  load_mode_code?: string | null;
  load_mode_en?: string | null;
};
export type ContainerBlock = {
  enabled: boolean;
  mode: "GROUPED" | "PER_BOX";
  lines: ContainerLine[];
  summary?: { lines: number; boxes: number; teu: number; identified: number };
};

export type ShipmentDetails = {
  dossier: {
    dossier_id: string;
    ref: string;
    title?: string | null;
    status: string;
    client_id?: string | null;
    client_name?: string | null;
    service_type_id?: string | null;
    service_type_key?: string | null;
    service_type_name?: string | null;
  };
  field_set: {
    service_type_field_set_id: string;
    version: number;
    is_active: boolean;
    is_stale: boolean;
  } | null;
  /** Only the roles this service type actually defines AND has a value for —
   *  absent, never blank, so a warehousing file renders no "Vessel: —". */
  facets: Partial<Record<FacetRole, Facet>>;
  /** `facets` in canonical reading order, already filtered to what exists. */
  facet_order: FacetRole[];
  route_label: string | null;
  groups: DetailGroupValue[];
  containers: ContainerBlock;
  completeness: {
    total: number;
    filled: number;
    percent: number;
    required_total: number;
    required_filled: number;
    missing_required: string[];
    is_complete: boolean;
  };
};

export const LEG_TYPES = [
  "PICKUP",
  "MAIN_CARRIAGE",
  "CUSTOMS",
  "INLAND_TRANSIT",
  "WAREHOUSE",
  "FINAL_DELIVERY",
  "OTHER",
] as const;
export type LegType = (typeof LEG_TYPES)[number];

export const LEG_MODES = ["AIR", "SEA", "LAND", "OTHER"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export const LEG_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "BLOCKED",
  "CANCELLED",
] as const;
export type LegStatus = (typeof LEG_STATUSES)[number];

/**
 * One leg of a file's itinerary.
 *
 * The server's read projection nests each endpoint (`origin: { name, state, … }`)
 * while the WRITE shape is flat (`origin` is the place name, `origin_place_id` the
 * reference). Both are declared here because the editor round-trips a leg it just
 * read, and check-response-contract.js verifies every snake_case field against
 * what the API actually emits.
 */
export type ItineraryEndpoint = {
  name?: string | null;
  place_id?: string | null;
  kind?: string | null;
  unlocode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** `verified` | `reference` | `unverified` | `unknown` — see geo_place. */
  state?: string | null;
};

export type ItineraryLeg = {
  itinerary_leg_id?: string;
  dossier_id?: string;
  seq?: number;
  leg_type: LegType;
  mode: LegMode;
  /** WRITE shape: the place's name, exactly as the catalogue spells it. */
  origin?: string | null;
  destination?: string | null;
  origin_place_id?: string | null;
  destination_place_id?: string | null;
  planned_departure?: string | null;
  planned_arrival?: string | null;
  actual_departure?: string | null;
  actual_arrival?: string | null;
  status?: LegStatus;
  provider_id?: string | null;
  provider_name?: string | null;
  notes?: string | null;
  is_optional?: boolean;
  /** `TEMPLATE` legs came from the service type; `MANUAL` ones a person added. */
  source?: "TEMPLATE" | "MANUAL";
  milestone_instance_id?: string | null;
  /** READ shape: the server's projection of each end, with its coordinate and
   *  verification state. Absent on a leg the editor has just built locally. */
  origin_endpoint?: ItineraryEndpoint;
  destination_endpoint?: ItineraryEndpoint;
  plottable?: boolean;
  needs_location?: boolean;
};
export const getItinerary = (dossierId: string) =>
  tenant<ItineraryLeg[]>(`/operations/${dossierId}/itinerary`);
export const replaceItinerary = (dossierId: string, legs: ItineraryLeg[]) =>
  tenant<ItineraryLeg[]>(`/operations/${dossierId}/itinerary`, {
    method: "PUT",
    body: { legs },
  });

export const getShipmentDetails = (dossierId: string, lang?: string) =>
  tenant<ShipmentDetails>(
    `/operations/${dossierId}/shipment-details${lang ? `?lang=${lang}` : ""}`,
  );
export const getDetailForm = (serviceTypeId: string, lang?: string) =>
  tenant<DetailForm>(
    `/service-types/${serviceTypeId}/detail-form${lang ? `?lang=${lang}` : ""}`,
  );
export const getDossierContainers = (dossierId: string) =>
  tenant<ContainerBlock>(`/operations/${dossierId}/containers`);
export const putDossierContainers = (
  dossierId: string,
  lines: ContainerLine[],
) =>
  tenant<ContainerBlock>(`/operations/${dossierId}/containers`, {
    method: "PUT",
    body: { lines },
  });

/* ── SSDC configuration (Service Types → Details) ─────────────────────────── */

export type ServiceTypeField = {
  service_type_field_id: string;
  service_type_field_set_id: string;
  group_code: string;
  group_label_fr?: string | null;
  group_label_en?: string | null;
  group_seq: number;
  seq: number | string;
  key: string;
  label_fr: string;
  label_en?: string | null;
  help_text_fr?: string | null;
  help_text_en?: string | null;
  placeholder?: string | null;
  data_type: FieldDataType;
  options_json: FieldOption[];
  ref_kind?: string | null;
  validation_json: Record<string, unknown>;
  is_required: boolean;
  is_client_visible: boolean;
  is_active: boolean;
  is_system: boolean;
  facet_role: FacetRole | null;
  column_name: string | null;
  width: "THIRD" | "HALF" | "FULL";
};
export type ServiceTypeFieldSet = {
  service_type_field_set_id: string;
  service_type_id: string;
  version: number;
  is_active: boolean;
  name?: string | null;
  source_version?: number | null;
  is_system: boolean;
  published_at?: string | null;
  created_at?: string;
  field_count?: number;
  dossier_count?: number;
  fields?: ServiceTypeField[];
  in_use?: boolean;
};

export const listFieldSets = (serviceTypeId: string) =>
  tenant<ServiceTypeFieldSet[]>(`/service-types/${serviceTypeId}/field-sets`);
export const getFieldSet = (serviceTypeId: string, setId: string) =>
  tenant<ServiceTypeFieldSet>(
    `/service-types/${serviceTypeId}/field-sets/${setId}`,
  );
/** Start a new draft — by default a clone of the live version, which is what
 *  "edit the form" means: a published version is never mutated in place. */
export const createFieldSetVersion = (
  serviceTypeId: string,
  body: { from?: string; name?: string } = {},
) =>
  tenant<ServiceTypeFieldSet>(`/service-types/${serviceTypeId}/field-sets`, {
    method: "POST",
    body,
  });
export const publishFieldSet = (serviceTypeId: string, setId: string) =>
  tenant<ServiceTypeFieldSet>(
    `/service-types/${serviceTypeId}/field-sets/${setId}/publish`,
    { method: "POST", body: {} },
  );
export const addFieldToSet = (
  serviceTypeId: string,
  setId: string,
  body: Partial<ServiceTypeField> & { key: string; label_fr: string },
) =>
  tenant<ServiceTypeField>(
    `/service-types/${serviceTypeId}/field-sets/${setId}/fields`,
    { method: "POST", body },
  );
export const updateFieldInSet = (
  serviceTypeId: string,
  setId: string,
  fieldId: string,
  body: Partial<ServiceTypeField>,
) =>
  tenant<ServiceTypeField>(
    `/service-types/${serviceTypeId}/field-sets/${setId}/fields/${fieldId}`,
    { method: "PATCH", body },
  );
export const removeFieldFromSet = (
  serviceTypeId: string,
  setId: string,
  fieldId: string,
) =>
  tenant<{ removed: boolean; deactivated: boolean }>(
    `/service-types/${serviceTypeId}/field-sets/${setId}/fields/${fieldId}`,
    { method: "DELETE" },
  );
export const configureServiceTypeContainers = (
  serviceTypeId: string,
  body: {
    captures_containers?: boolean;
    container_detail_mode?: "GROUPED" | "PER_BOX";
  },
) =>
  tenant<{
    captures_containers: boolean;
    container_detail_mode: "GROUPED" | "PER_BOX";
  }>(`/service-types/${serviceTypeId}/containers`, { method: "PUT", body });

/* The container-type registry is `dictionary_ref` kind CONTAINER_TYPE, already
 * exposed by `masterdata-api.listDictRefs` and already priced against by expense
 * rates (0634). It is NOT re-declared here: one reader means a file's equipment
 * and its rate card can never disagree about what a 40' HC is. */
