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
  ]);
}
