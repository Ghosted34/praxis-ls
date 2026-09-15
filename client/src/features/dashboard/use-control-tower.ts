/**
 * Control Tower data layer.
 *
 * COLD LOAD IS THREE REQUESTS, not seven. The iframe build fetched
 * `/final-invoices`, `/clients`, `/operations` and `/vehicles` on every mount to
 * pre-build four KPI drill-downs, whether or not anyone opened one — four full
 * list payloads on the app's most-visited screen, every visit, for a modal that
 * is usually never opened. Those four now load on demand (`useKpiDrilldown`),
 * and because they go through the shared QueryClient they are then cached and
 * reused by the Finance hub, Operations and Fleet rather than fetched again.
 *
 * `/dashboard/control-tower` is the page: if it fails, the screen shows the
 * error, including the permission message for a user without the MOD-00A grant.
 * `/dashboard/kpis` and `/receivables/overdue` are ADDITIVE — a tenant with the
 * accounting module switched off gets no receivables card, not a broken tower —
 * so those two are tolerant and resolve to null on failure.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tenant } from "@/lib/api-client";
import { tenantKey } from "@/lib/query-client";
import { errMsg, useList, useListPaged } from "@/lib/use-resource";
import {
  buildApprovalsDrill,
  buildComplianceDrill,
  buildFleetDrill,
  buildFilesActiveDrill,
  buildJournalsDrill,
  buildNeedsLocationDrill,
  buildOverdueDrill,
  buildProformasDrill,
  buildRevenueDrill,
  buildSlaDrill,
  // PR-2 — Operations, Fleet & Warehouse
  // Money + Sales & Procurement (PR-3)
  buildCashCollectedDrill,
  buildCashRequestsDrill,
  buildDsoDrill,
  buildMarginDrill,
  buildPayablesDrill,
  buildPipelineWonDrill,
  buildPosInFlightDrill,
  buildPurchaseRequestsDrill,
  buildQuoteRequestsDrill,
  buildDwellDrill,
  buildFleetDocsDrill,
  buildLateVsEtaDrill,
  buildWarehouseOccupancyDrill,
  buildWorkOrdersDrill,
  // Human Capital (PR-4) — one builder per HR tile.
  buildAttendanceDrill,
  buildAttritionDrill,
  buildHeadcountDrill,
  buildLeaveDrill,
  buildPayrollDrill,
  buildVacanciesDrill,
  type ClientNames,
  type Drill,
  type KpiId,
} from "./drilldowns";
import { type BandSlot, type KpiBand, type KpiCatalog } from "./kpi-model";
import {
  legsByFile,
  numOrNull,
  str,
  toActivityRecords,
  toLanes,
  toLiveShipment,
  type ActivityRecord,
  type ItineraryLeg,
  type Lane,
  type LiveShipment,
  type Row,
} from "./model";

export type OverduePayload = {
  total?: number;
  count?: number;
  clients?: number;
  invoices?: Row[];
};

export type ControlTowerKpis = {
  revenue: number | null;
  currency: string;
  sla: number | null;
  overdue: number | null;
  fleetActive: number | null;
  fleetTotal: number | null;
};

export type ControlTowerFilters = {
  mode?: "AIR" | "SEA" | "LAND" | "RAIL" | "OTHER";
  territory?: string;
  service_type_id?: string;
  date_field?: "created" | "updated" | "arrival" | "delivery";
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
  include_completed?: boolean;
  /** Movement files, or the facility/activity ones. Server-side, so the counts
   *  and the pager agree with the list. */
  layer?: "MOVEMENT" | "ACTIVITY";
  /** Whether every named endpoint resolves to a verified place. */
  verified?: "VERIFIED" | "UNVERIFIED";
};

export type ControlTowerData = {
  shipments: LiveShipment[];
  /** One per plottable itinerary leg, falling back to the parent POL→POD lane. */
  lanes: Lane[];
  /** Files with no drawable route: facility work, and unverified locations. */
  activity: ActivityRecord[];
  /** Each file's legs, keyed by dossier id — what the itinerary panel reads. */
  legs: Record<string, ItineraryLeg[]>;
  /** Files by dossier id, for the map's hover card and the panel header. */
  byId: Record<string, LiveShipment>;
  activeFiles: number;
  /** Server-side counts over the WHOLE filtered set, not the visible page. */
  movementFiles: number;
  activityFiles: number;
  needsLocation: number;
  approvals: number;
  complianceFlags: number;
  unpostedJournals: number;
  kpis: ControlTowerKpis;
  /** The resolved headline band (kpi guide §8): the picker reads it, the strip
   *  paints it, and `null` means "not resolved yet / payload unparseable" —
   *  never "empty band", which is a real value with `slots: []`. */
  band: KpiBand | null;
  page: { limit: number; has_more: boolean; next_cursor: string | null };
};

/** A query whose failure must not take the page down (feature-gated module,
 *  missing grant) — resolves to null instead of throwing. */
function tolerant<T>(path: string) {
  return {
    queryKey: tenantKey(`${path}#tolerant`),
    queryFn: () =>
      tenant<T>(path)
        .then((d) => d ?? null)
        .catch(() => null),
  };
}

/**
 * Validate a server-resolved band into renderable slots — or null.
 *
 * The parse is a WHITELIST, not a cast: this payload crosses a network
 * boundary and lands on the app's busiest screen, where a `null` label would
 * render as the string "null" beside a big number and an un-`isFinite` value
 * would render `NaN M XAF`. Every field either survives the shape check or
 * falls to a defined default — and a slot with a non-numeric `value` is
 * DROPPED rather than zeroed, because the zero policy is a promise about
 * numbers the server vouches for, not about garbage. (`Object.defineProperty`
 * discipline lives in the map's `byId`; here the ids are read out of the
 * object rather than spread into property positions, so nothing needs it.)
 */
export function parseBand(raw: unknown): KpiBand | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Row;
  const slotsRaw = Array.isArray(b.slots) ? (b.slots as Row[]) : null;
  if (!slotsRaw) return null;
  const slots: BandSlot[] = [];
  for (const s of slotsRaw) {
    if (!s || typeof s !== "object") continue;
    const t = s as Row;
    if (typeof t.id !== "string" || !t.id) continue;
    const value = Number(t.value);
    if (!Number.isFinite(value)) continue;
    const denom = Number(t.denominator);
    slots.push({
      id: t.id,
      domain: (t.domain as BandSlot["domain"]) ?? "operations",
      unit: (t.unit as BandSlot["unit"]) ?? "count",
      module: str(t.module),
      status: "live",
      tone: (t.tone as BandSlot["tone"]) ?? "mute",
      icon: str(t.icon),
      labelKey: str(t.labelKey),
      hintKey: str(t.hintKey),
      badgeKey: typeof t.badgeKey === "string" ? t.badgeKey : null,
      drillTo: typeof t.drillTo === "string" ? t.drillTo : null,
      value,
      denominator: Number.isFinite(denom) ? denom : null,
      measurable: t.measurable !== false,
    });
  }
  const hidden = Array.isArray(b.hidden)
    ? (b.hidden as unknown[]).filter((h): h is string => typeof h === "string")
    : [];
  const source = b.source === "user" || b.source === "role" ? b.source : "default";
  return { source, currency: str(b.currency) || "XAF", slots, hidden };
}

const EMPTY_FILTERS: ControlTowerFilters = {};

export function useControlTower(filters: ControlTowerFilters = EMPTY_FILTERS): {
  data: ControlTowerData | null;
  error: string | null;
  loading: boolean;
  /** Refetch on demand — meeting mode's manual button and its pausable timer. */
  refresh: () => void;
} {
  const queryClient = useQueryClient();
  const query = React.useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    });
    return p.toString();
  }, [filters]);
  const towerPath = `/dashboard/control-tower${query ? `?${query}` : ""}`;
  const tower = useQuery({
    queryKey: tenantKey(towerPath),
    queryFn: () => tenant<Row>(towerPath),
  });
  const kpis = useQuery(tolerant<Row>("/dashboard/kpis"));
  const overdue = useQuery(tolerant<OverduePayload>("/receivables/overdue"));

  const data = React.useMemo<ControlTowerData | null>(() => {
    if (!tower.data) return null;
    const ct = tower.data;
    const k = (kpis.data || {}) as Row;
    const raw = Array.isArray(ct.live_shipments)
      ? (ct.live_shipments as Row[])
      : [];
    const shipments = raw.map(toLiveShipment);
    const files = (ct.operation_files as Row) || {};
    const byId: Record<string, LiveShipment> = {};
    shipments.forEach((s) => {
      if (!s.dossierId) return;
      // A payload key used as a property NAME is remote property injection
      // (js/remote-property-injection); defineProperty keeps it a value.
      Object.defineProperty(byId, s.dossierId, {
        value: s,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });

    return {
      shipments,
      lanes: toLanes(raw),
      activity: toActivityRecords(raw),
      legs: legsByFile(raw),
      byId,
      activeFiles:
        Number(files.active ?? files.open ?? shipments.length) ||
        shipments.length,
      movementFiles: Number(files.movement ?? 0) || 0,
      activityFiles: Number(files.activity ?? 0) || 0,
      needsLocation: Number(files.needs_location ?? 0) || 0,
      approvals:
        Number(ct.approvals_awaiting ?? k.approvals_awaiting ?? 0) || 0,
      complianceFlags:
        Number(k.open_compliance_flags ?? k.compliance_flags ?? 0) || 0,
      // The repo sends `unposted_journal_entries`; the iframe read
      // `unposted_journals`, which is not a key the payload has ever carried, so
      // the briefing silently never mentioned unposted journals. Both are read
      // now, real key first.
      unpostedJournals:
        Number(k.unposted_journal_entries ?? k.unposted_journals ?? 0) || 0,
      page: (ct.page as ControlTowerData["page"]) || {
        limit: 50,
        has_more: false,
        next_cursor: null,
      },
      kpis: {
        revenue: numOrNull(k.revenue_final_ttc),
        currency: str(k.revenue_currency) || "XAF",
        sla: numOrNull(k.sla_on_time_pct),
        overdue: overdue.data ? numOrNull(overdue.data.total) : null,
        fleetActive: numOrNull(k.fleet_active),
        fleetTotal: numOrNull(k.fleet_total),
      },
      band: parseBand(k.band),
    };
  }, [tower.data, kpis.data, overdue.data]);

  const refresh = React.useCallback(() => {
    // Invalidate rather than refetch by key: the tower path changes with every
    // filter, and the two additive queries have their own keys. Invalidating the
    // tenant scope refreshes whatever is currently mounted without this hook
    // having to know which paths those are.
    void queryClient.invalidateQueries();
  }, [queryClient]);

  return {
    data,
    error: tower.error ? errMsg(tower.error) : null,
    // Only the page-critical query gates the skeleton. Waiting on the two
    // additive ones would hold the whole tower behind a module that may be
    // switched off for this tenant.
    loading: tower.data === undefined && !tower.error,
    refresh,
  };
}

/** Rows that back the revenue ranking. 200 is the API's hard cap on a page. */
const REVENUE_SCAN = 200;

/** Human Capital drills scan one page of their module list — the same cap the
 *  revenue ranking lives under, and the note in each drill names the basis. */
const HR_SCAN = 200;

/**
 * The picker's catalog — fetched ONLY while the panel is open.
 *
 * Same cold-load lesson as the drills: the tower's first paint must not pay
 * for a surface the user opens twice a month. `enabled` gates the query, and
 * because it rides the shared QueryClient the band's next refetch after Apply
 * sees the fresh answer rather than a stale one (the picker invalidates on
 * save; a save that failed leaves the old band painted — nothing to unwind).
 */
export function useKpiCatalog(enabled: boolean): {
  catalog: KpiCatalog | null;
  loading: boolean;
  error: string | null;
} {
  const q = useQuery({
    queryKey: tenantKey("/dashboard/kpi-catalog#picker"),
    queryFn: () => tenant<KpiCatalog>("/dashboard/kpi-catalog"),
    enabled,
  });
  return {
    catalog: q.data ?? null,
    loading: enabled && q.isPending,
    error: q.error ? errMsg(q.error) : null,
  };
}

/**
 * The open card's drill-down, and only the open card's.
 *
 * Every hook below is called unconditionally (rules of hooks) but passed a null
 * path unless its card is open, which is how `useList`/`useListPaged` disable
 * themselves. `loading` is therefore read only from the sources the active drill
 * actually needs — a disabled list reports `loading: true` forever by design.
 */
export function useKpiDrilldown(
  id: KpiId | null,
  kpis: ControlTowerKpis | null,
  /** The painted band, for drills whose headline IS the tile's resolved
   *  figure (an average, a ratio pair) rather than something a list scan can
   *  recompute — the modal must not contradict the card. Optional so the
   *  legacy call sites and tests keep compiling. */
  band: KpiBand | null = null,
): { drill: Drill | null; loading: boolean; error: string | null } {
  // Legacy card keys stay live aliases of the catalog keys — a bookmark, a
  // test, or a half-refreshed client still holds the four old ids, and a
  // drill answering under both names is cheaper than a migration note.
  const is = (...keys: string[]) => id !== null && keys.includes(id);
  const needsClients = is("revenue", "overdue", "receivables_overdue");

  const invoices = useListPaged<Row>(
    is("revenue") ? "/final-invoices" : null,
    { pageSize: REVENUE_SCAN },
  );
  const clients = useList<Row>(needsClients ? "/clients" : null);
  const dossiers = useList<Row>(is("sla", "sla_on_time", "files_active") ? "/operations" : null);
  const vehicles = useList<Row>(is("fleet", "fleet_utilisation") ? "/vehicles" : null);
  const overdue = useQuery({
    ...tolerant<OverduePayload>("/receivables/overdue"),
    enabled: is("overdue", "receivables_overdue"),
  });
  // The band's second six — each on demand, each through a list the caller
  // can already read (the same entitlement rule as the originals).
  const unverified = useQuery({
    ...tolerant<Row>("/dashboard/control-tower?verified=UNVERIFIED&limit=20"),
    enabled: is("needs_location"),
  });
  const approvals = useList<Row>(is("approvals_awaiting") ? "/approvals" : null);
  const flags = useList<Row>(is("compliance_open") ? "/compliance" : null);
  const proformas = useList<Row>(is("proformas_open") ? "/proformas" : null);
  const journals = useList<Row>(is("journals_unposted") ? "/journal-entries" : null);
  // PR-2 — Operations, Fleet & Warehouse. Each through the module's own list
  // (or its one aggregate read), each disabled unless its card is open. NOT
  // `tolerant`: a 403 must surface as the permission message, per the fleet
  // lesson above — an empty table here would read as "all clear".
  const lateFiles = useListPaged<Row>(is("late_vs_eta") ? "/operations" : null, { pageSize: REVENUE_SCAN });
  const attribution = useQuery({
    queryKey: tenantKey("/milestones/attribution"),
    queryFn: () => tenant<{ by_tier?: Row[]; by_stage?: Row[] }>("/milestones/attribution"),
    enabled: is("dwell_days"),
  });
  const expiringDocs = useList<Row>(is("fleet_docs_expiring") ? "/vehicle-compliance/expiring?days=30" : null);
  const workOrders = useListPaged<Row>(is("work_orders_open") ? "/work-orders" : null, { pageSize: REVENUE_SCAN });
  const locations = useListPaged<Row>(is("warehouse_occupancy") ? "/locations" : null, { pageSize: REVENUE_SCAN });
  const inventory = useListPaged<Row>(is("warehouse_occupancy") ? "/inventory" : null, { pageSize: REVENUE_SCAN });
  // PR-3 — Money, Sales & Procurement. One module list each, disabled unless
  // its card is open, and NOT `tolerant`: a 403 must reach the reader as the
  // permission message rather than an empty table that reads as "all clear".
  const receipts = useListPaged<Row>(is("cash_collected") ? "/payments" : null, { pageSize: REVENUE_SCAN });
  const payables = useListPaged<Row>(is("payables_overdue") ? "/supplier-invoices" : null, { pageSize: REVENUE_SCAN });
  const cashRequests = useListPaged<Row>(is("cash_requests_awaiting") ? "/cash-requests" : null, { pageSize: REVENUE_SCAN });
  const marginSims = useListPaged<Row>(is("margin_closed") ? "/margin-simulations" : null, { pageSize: REVENUE_SCAN });
  const dsoInvoices = useListPaged<Row>(is("dso") ? "/final-invoices" : null, { pageSize: REVENUE_SCAN });
  const opportunities = useListPaged<Row>(is("pipeline_won") ? "/opportunities" : null, { pageSize: REVENUE_SCAN });
  const quoteRequests = useListPaged<Row>(is("quote_requests_open") ? "/quote-requests" : null, { pageSize: REVENUE_SCAN });
  const purchaseOrders = useListPaged<Row>(is("pos_in_flight") ? "/purchase-orders" : null, { pageSize: REVENUE_SCAN });
  const purchaseRequests = useListPaged<Row>(is("purchase_requests") ? "/purchase-requests" : null, { pageSize: REVENUE_SCAN });
  const bandSlot = React.useCallback(
    (slotId: string) => (band?.slots ?? []).find((s) => s.id === slotId) ?? null,
    [band],
  );
  // Human Capital (PR-4) — one list per tile, each the module page the role
  // can already read. The payroll drill additionally opens the LATEST
  // IN-FLIGHT run's payslips (the money figures); that read is tolerant, so a
  // failure costs the figures ("—"), never the runs table. A 403 on the list
  // itself still surfaces as the permission error — never "all clear".
  const employees = useListPaged<Row>(
    is("headcount") ? "/employees" : null,
    { pageSize: HR_SCAN, active: "true" },
  );
  const departed = useListPaged<Row>(
    is("attrition_90d") ? "/employees" : null,
    { pageSize: HR_SCAN, status: "TERMINATED,SUSPENDED" },
  );
  const punches = useListPaged<Row>(
    is("attendance_today") ? "/attendance" : null,
    { pageSize: HR_SCAN, date: new Date().toISOString().slice(0, 10) },
  );
  const leaveRequests = useListPaged<Row>(
    is("leave_pending") ? "/leave" : null,
    { pageSize: HR_SCAN, status: "REQUESTED", exclude_kind: "salary_advance" },
  );
  const vacancies = useListPaged<Row>(
    is("vacancies_open") ? "/vacancies" : null,
    { pageSize: HR_SCAN },
  );
  const payrollRuns = useListPaged<Row>(
    is("payroll_run_state") ? "/payroll" : null,
    { pageSize: HR_SCAN },
  );
  const payrollInFlight = React.useMemo(() => {
    const runs = payrollRuns.rows || [];
    const terminal = (s: unknown) => {
      const t = String(s ?? "").toUpperCase();
      return t === "DISBURSED" || t === "REJECTED";
    };
    return runs.find((r) => !terminal(r.status)) || null;
  }, [payrollRuns.rows]);
  const payrollDetail = useQuery({
    ...tolerant<Row>(
      `/payroll/${payrollInFlight ? String(payrollInFlight.payroll_run_id) : ""}`,
    ),
    enabled: is("payroll_run_state") && !!payrollInFlight,
  });

  const clientNames = React.useMemo<ClientNames>(() => {
    const m: ClientNames = {};
    (clients.rows || []).forEach((c) => {
      m[str(c.client_id)] = str(c.name);
    });
    return m;
  }, [clients.rows]);

  return React.useMemo(() => {
    if (!id) return { drill: null, loading: false, error: null };
    const currency = kpis?.currency || "XAF";

    switch (id) {
      case "revenue": {
        const error = invoices.error || clients.error;
        if (error) return { drill: null, loading: false, error };
        if (invoices.loading || clients.loading)
          return { drill: null, loading: true, error: null };
        return {
          drill: buildRevenueDrill(
            invoices.rows,
            clientNames,
            currency,
            kpis?.revenue ?? null,
            invoices.total,
          ),
          loading: false,
          error: null,
        };
      }
      case "sla":
      case "sla_on_time": {
        if (dossiers.error)
          return { drill: null, loading: false, error: dossiers.error };
        if (dossiers.loading)
          return { drill: null, loading: true, error: null };
        return {
          drill: buildSlaDrill(dossiers.rows),
          loading: false,
          error: null,
        };
      }
      case "overdue":
      case "receivables_overdue": {
        if (clients.error)
          return { drill: null, loading: false, error: clients.error };
        if (clients.loading || overdue.isPending)
          return { drill: null, loading: true, error: null };
        return {
          drill: buildOverdueDrill(overdue.data ?? null, clientNames, currency),
          loading: false,
          error: null,
        };
      }
      case "fleet":
      case "fleet_utilisation": {
        // A 403 here surfaces as "You don't have permission to do this." The
        // iframe rendered its "All clear" empty state instead, so a user without
        // the fleet grant was told the fleet was fine — a reassuring answer to a
        // question that was never asked.
        if (vehicles.error)
          return { drill: null, loading: false, error: vehicles.error };
        if (vehicles.loading)
          return { drill: null, loading: true, error: null };
        return {
          drill: buildFleetDrill(vehicles.rows),
          loading: false,
          error: null,
        };
      }
      case "files_active": {
        if (dossiers.error)
          return { drill: null, loading: false, error: dossiers.error };
        if (dossiers.loading)
          return { drill: null, loading: true, error: null };
        return {
          drill: buildFilesActiveDrill(dossiers.rows),
          loading: false,
          error: null,
        };
      }
      case "needs_location": {
        if (unverified.isError)
          return { drill: null, loading: false, error: errMsg(unverified.error) };
        if (unverified.isPending)
          return { drill: null, loading: true, error: null };
        const ct = (unverified.data ?? {}) as Row;
        const rows = Array.isArray(ct.live_shipments)
          ? (ct.live_shipments as Row[])
          : [];
        return { drill: buildNeedsLocationDrill(rows), loading: false, error: null };
      }
      case "approvals_awaiting": {
        if (approvals.error)
          return { drill: null, loading: false, error: approvals.error };
        if (approvals.loading)
          return { drill: null, loading: true, error: null };
        return { drill: buildApprovalsDrill(approvals.rows), loading: false, error: null };
      }
      case "compliance_open": {
        if (flags.error)
          return { drill: null, loading: false, error: flags.error };
        if (flags.loading)
          return { drill: null, loading: true, error: null };
        return { drill: buildComplianceDrill(flags.rows), loading: false, error: null };
      }
      case "proformas_open": {
        if (proformas.error)
          return { drill: null, loading: false, error: proformas.error };
        if (proformas.loading)
          return { drill: null, loading: true, error: null };
        return {
          // No authoritative-count plumbing: the band payload does not carry
          // `proformas` on ControlTowerKpis, and inventing a field for a
          // badge-string fallback would be the worse trade. The builder's
          // badge degrades to the page count and the note stays silent.
          drill: buildProformasDrill(proformas.rows, currency, null),
          loading: false,
          error: null,
        };
      }
      case "journals_unposted": {
        if (journals.error)
          return { drill: null, loading: false, error: journals.error };
        if (journals.loading)
          return { drill: null, loading: true, error: null };
        return { drill: buildJournalsDrill(journals.rows), loading: false, error: null };
      }
      // ── PR-2 — Operations, Fleet & Warehouse ──────────────────────────────
      case "late_vs_eta": {
        if (lateFiles.error) return { drill: null, loading: false, error: lateFiles.error };
        if (lateFiles.loading) return { drill: null, loading: true, error: null };
        return { drill: buildLateVsEtaDrill(lateFiles.rows), loading: false, error: null };
      }
      case "dwell_days": {
        if (attribution.isError) return { drill: null, loading: false, error: errMsg(attribution.error) };
        if (attribution.isPending) return { drill: null, loading: true, error: null };
        const slot = bandSlot("dwell_days");
        return {
          drill: buildDwellDrill(attribution.data ?? null, slot ? slot.value : null),
          loading: false,
          error: null,
        };
      }
      case "fleet_docs_expiring": {
        if (expiringDocs.error) return { drill: null, loading: false, error: expiringDocs.error };
        if (expiringDocs.loading) return { drill: null, loading: true, error: null };
        return { drill: buildFleetDocsDrill(expiringDocs.rows), loading: false, error: null };
      }
      case "work_orders_open": {
        if (workOrders.error) return { drill: null, loading: false, error: workOrders.error };
        if (workOrders.loading) return { drill: null, loading: true, error: null };
        return { drill: buildWorkOrdersDrill(workOrders.rows), loading: false, error: null };
      }
      case "warehouse_occupancy": {
        const error = locations.error || inventory.error;
        if (error) return { drill: null, loading: false, error };
        if (locations.loading || inventory.loading) return { drill: null, loading: true, error: null };
        const slot = bandSlot("warehouse_occupancy");
        const pair = slot ? { value: slot.value, denominator: slot.denominator ?? 0 } : null;
        return {
          drill: buildWarehouseOccupancyDrill(locations.rows, inventory.rows, pair),
          loading: false,
          error: null,
        };
      }
      // ── Human Capital (PR-4) ────────────────────────────────────────────
      case "headcount": {
        if (employees.error)
          return { drill: null, loading: false, error: employees.error };
        if (employees.loading)
          return { drill: null, loading: true, error: null };
        // An honest page scan: `/employees` predates the paged shape and
        // sends no `meta.total`, so the builder counts the page and its note
        // names the basis at the cap — the tile keeps the true count.
        return { drill: buildHeadcountDrill(employees.rows), loading: false, error: null };
      }
      case "attendance_today": {
        if (punches.error)
          return { drill: null, loading: false, error: punches.error };
        if (punches.loading)
          return { drill: null, loading: true, error: null };
        return { drill: buildAttendanceDrill(punches.rows), loading: false, error: null };
      }
      case "leave_pending": {
        if (leaveRequests.error)
          return { drill: null, loading: false, error: leaveRequests.error };
        if (leaveRequests.loading)
          return { drill: null, loading: true, error: null };
        return { drill: buildLeaveDrill(leaveRequests.rows), loading: false, error: null };
      }
      case "vacancies_open": {
        if (vacancies.error)
          return { drill: null, loading: false, error: vacancies.error };
        if (vacancies.loading)
          return { drill: null, loading: true, error: null };
        return { drill: buildVacanciesDrill(vacancies.rows), loading: false, error: null };
      }
      case "payroll_run_state": {
        if (payrollRuns.error)
          return { drill: null, loading: false, error: payrollRuns.error };
        if (payrollRuns.loading)
          return { drill: null, loading: true, error: null };
        // The payslip figures are ADDITIVE: an unreadable or uncomputed
        // detail degrades the money to "—" in the builder, and the runs
        // table still paints.
        return {
          drill: buildPayrollDrill(payrollRuns.rows, (payrollDetail.data ?? null) as Row | null, currency),
          loading: false,
          error: null,
        };
      }
      case "attrition_90d": {
        if (departed.error)
          return { drill: null, loading: false, error: departed.error };
        if (departed.loading)
          return { drill: null, loading: true, error: null };
        return { drill: buildAttritionDrill(departed.rows), loading: false, error: null };
      }
      // ── PR-3 — Money, Sales & Procurement ────────────────────────────────
      case "cash_collected": {
        if (receipts.error) return { drill: null, loading: false, error: receipts.error };
        if (receipts.loading) return { drill: null, loading: true, error: null };
        return { drill: buildCashCollectedDrill(receipts.rows, currency), loading: false, error: null };
      }
      case "payables_overdue": {
        if (payables.error) return { drill: null, loading: false, error: payables.error };
        if (payables.loading) return { drill: null, loading: true, error: null };
        return { drill: buildPayablesDrill(payables.rows, currency), loading: false, error: null };
      }
      case "cash_requests_awaiting": {
        if (cashRequests.error) return { drill: null, loading: false, error: cashRequests.error };
        if (cashRequests.loading) return { drill: null, loading: true, error: null };
        return { drill: buildCashRequestsDrill(cashRequests.rows, currency), loading: false, error: null };
      }
      case "margin_closed": {
        if (marginSims.error) return { drill: null, loading: false, error: marginSims.error };
        if (marginSims.loading) return { drill: null, loading: true, error: null };
        // The average and its denominator are the TILE's, computed over every
        // closed file; the page only explains them.
        const slot = bandSlot("margin_closed");
        return {
          drill: buildMarginDrill(
            marginSims.rows,
            slot && slot.measurable ? slot.value : null,
            slot ? (slot.denominator ?? 0) : 0,
          ),
          loading: false,
          error: null,
        };
      }
      case "dso": {
        if (dsoInvoices.error) return { drill: null, loading: false, error: dsoInvoices.error };
        if (dsoInvoices.loading) return { drill: null, loading: true, error: null };
        const slot = bandSlot("dso");
        return {
          drill: buildDsoDrill(dsoInvoices.rows, slot ? slot.value : null, currency),
          loading: false,
          error: null,
        };
      }
      case "pipeline_won": {
        if (opportunities.error) return { drill: null, loading: false, error: opportunities.error };
        if (opportunities.loading) return { drill: null, loading: true, error: null };
        return { drill: buildPipelineWonDrill(opportunities.rows, currency), loading: false, error: null };
      }
      case "quote_requests_open": {
        if (quoteRequests.error) return { drill: null, loading: false, error: quoteRequests.error };
        if (quoteRequests.loading) return { drill: null, loading: true, error: null };
        return { drill: buildQuoteRequestsDrill(quoteRequests.rows), loading: false, error: null };
      }
      case "pos_in_flight": {
        if (purchaseOrders.error) return { drill: null, loading: false, error: purchaseOrders.error };
        if (purchaseOrders.loading) return { drill: null, loading: true, error: null };
        // The in-flight COUNT is the tile's (it measures the absence of a GRN,
        // which this page cannot see); the table lists the issued orders.
        const slot = bandSlot("pos_in_flight");
        return {
          drill: buildPosInFlightDrill(purchaseOrders.rows, slot ? slot.value : 0, currency),
          loading: false,
          error: null,
        };
      }
      case "purchase_requests": {
        if (purchaseRequests.error) return { drill: null, loading: false, error: purchaseRequests.error };
        if (purchaseRequests.loading) return { drill: null, loading: true, error: null };
        return { drill: buildPurchaseRequestsDrill(purchaseRequests.rows), loading: false, error: null };
      }
      default:
        return { drill: null, loading: false, error: null };
    }
  }, [
    id,
    kpis,
    invoices.rows,
    invoices.error,
    invoices.loading,
    invoices.total,
    clients.error,
    clients.loading,
    clientNames,
    dossiers.rows,
    dossiers.error,
    dossiers.loading,
    vehicles.rows,
    vehicles.error,
    vehicles.loading,
    overdue.data,
    overdue.isPending,
    unverified.data,
    unverified.isPending,
    unverified.isError,
    unverified.error,
    approvals.rows,
    approvals.error,
    approvals.loading,
    flags.rows,
    flags.error,
    flags.loading,
    proformas.rows,
    proformas.error,
    proformas.loading,
    journals.rows,
    journals.error,
    journals.loading,
    // PR-2
    bandSlot,
    lateFiles.rows,
    lateFiles.error,
    lateFiles.loading,
    attribution.data,
    attribution.isPending,
    attribution.isError,
    attribution.error,
    expiringDocs.rows,
    expiringDocs.error,
    expiringDocs.loading,
    workOrders.rows,
    workOrders.error,
    workOrders.loading,
    locations.rows,
    locations.error,
    locations.loading,
    inventory.rows,
    inventory.error,
    inventory.loading,
    // PR-3
    receipts.rows, receipts.error, receipts.loading,
    payables.rows, payables.error, payables.loading,
    cashRequests.rows, cashRequests.error, cashRequests.loading,
    marginSims.rows, marginSims.error, marginSims.loading,
    dsoInvoices.rows, dsoInvoices.error, dsoInvoices.loading,
    opportunities.rows, opportunities.error, opportunities.loading,
    quoteRequests.rows, quoteRequests.error, quoteRequests.loading,
    purchaseOrders.rows, purchaseOrders.error, purchaseOrders.loading,
    purchaseRequests.rows, purchaseRequests.error, purchaseRequests.loading,
    employees.rows,
    employees.error,
    employees.loading,
    departed.rows,
    departed.error,
    departed.loading,
    punches.rows,
    punches.error,
    punches.loading,
    leaveRequests.rows,
    leaveRequests.error,
    leaveRequests.loading,
    vacancies.rows,
    vacancies.error,
    vacancies.loading,
    payrollRuns.rows,
    payrollRuns.error,
    payrollRuns.loading,
    payrollDetail.data,
  ]);
}
