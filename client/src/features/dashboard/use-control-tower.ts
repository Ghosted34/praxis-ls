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
import { useQuery } from "@tanstack/react-query";
import { tenant } from "@/lib/api-client";
import { tenantKey } from "@/lib/query-client";
import { errMsg, useList, useListPaged } from "@/lib/use-resource";
import {
  buildFleetDrill,
  buildOverdueDrill,
  buildRevenueDrill,
  buildSlaDrill,
  type ClientNames,
  type Drill,
  type KpiId,
} from "./drilldowns";
import { numOrNull, str, toLanes, toLiveShipment, type Lane, type LiveShipment, type Row } from "./model";

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
  mode?: "AIR" | "SEA" | "LAND";
  territory?: string;
  service_type_id?: string;
  date_field?: "created" | "updated" | "arrival" | "delivery";
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
  include_completed?: boolean;
};

export type ControlTowerData = {
  shipments: LiveShipment[];
  lanes: Lane[];
  activeFiles: number;
  approvals: number;
  complianceFlags: number;
  unpostedJournals: number;
  kpis: ControlTowerKpis;
  page: { limit: number; has_more: boolean; next_cursor: string | null };
};

/** A query whose failure must not take the page down (feature-gated module,
 *  missing grant) — resolves to null instead of throwing. */
function tolerant<T>(path: string) {
  return {
    queryKey: tenantKey(`${path}#tolerant`),
    queryFn: () => tenant<T>(path).then((d) => d ?? null).catch(() => null),
  };
}

const EMPTY_FILTERS: ControlTowerFilters = {};

export function useControlTower(filters: ControlTowerFilters = EMPTY_FILTERS): {
  data: ControlTowerData | null;
  error: string | null;
  loading: boolean;
} {
  const query = React.useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); });
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
    const raw = Array.isArray(ct.live_shipments) ? (ct.live_shipments as Row[]) : [];
    const shipments = raw.map(toLiveShipment);
    const files = (ct.operation_files as Row) || {};

    return {
      shipments,
      lanes: toLanes(raw),
      activeFiles: Number(files.active ?? files.open ?? shipments.length) || shipments.length,
      approvals: Number(ct.approvals_awaiting ?? k.approvals_awaiting ?? 0) || 0,
      complianceFlags: Number(k.open_compliance_flags ?? k.compliance_flags ?? 0) || 0,
      // The repo sends `unposted_journal_entries`; the iframe read
      // `unposted_journals`, which is not a key the payload has ever carried, so
      // the briefing silently never mentioned unposted journals. Both are read
      // now, real key first.
      unpostedJournals: Number(k.unposted_journal_entries ?? k.unposted_journals ?? 0) || 0,
      page: (ct.page as ControlTowerData["page"]) || { limit: 50, has_more: false, next_cursor: null },
      kpis: {
        revenue: numOrNull(k.revenue_final_ttc),
        currency: str(k.revenue_currency) || "XAF",
        sla: numOrNull(k.sla_on_time_pct),
        overdue: overdue.data ? numOrNull(overdue.data.total) : null,
        fleetActive: numOrNull(k.fleet_active),
        fleetTotal: numOrNull(k.fleet_total),
      },
    };
  }, [tower.data, kpis.data, overdue.data]);

  return {
    data,
    error: tower.error ? errMsg(tower.error) : null,
    // Only the page-critical query gates the skeleton. Waiting on the two
    // additive ones would hold the whole tower behind a module that may be
    // switched off for this tenant.
    loading: tower.data === undefined && !tower.error,
  };
}

/** Rows that back the revenue ranking. 200 is the API's hard cap on a page. */
const REVENUE_SCAN = 200;

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
  const needsClients = id === "revenue" || id === "overdue";

  const invoices = useListPaged<Row>(id === "revenue" ? "/final-invoices" : null, { pageSize: REVENUE_SCAN });
  const clients = useList<Row>(needsClients ? "/clients" : null);
  const dossiers = useList<Row>(id === "sla" ? "/operations" : null);
  const vehicles = useList<Row>(id === "fleet" ? "/vehicles" : null);
  const overdue = useQuery({ ...tolerant<OverduePayload>("/receivables/overdue"), enabled: id === "overdue" });

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
        if (invoices.loading || clients.loading) return { drill: null, loading: true, error: null };
        return {
          drill: buildRevenueDrill(invoices.rows, clientNames, currency, kpis?.revenue ?? null, invoices.total),
          loading: false,
          error: null,
        };
      }
      case "sla": {
        if (dossiers.error) return { drill: null, loading: false, error: dossiers.error };
        if (dossiers.loading) return { drill: null, loading: true, error: null };
        return { drill: buildSlaDrill(dossiers.rows), loading: false, error: null };
      }
      case "overdue": {
        if (clients.error) return { drill: null, loading: false, error: clients.error };
        if (clients.loading || overdue.isPending) return { drill: null, loading: true, error: null };
        return {
          drill: buildOverdueDrill(overdue.data ?? null, clientNames, currency),
          loading: false,
          error: null,
        };
      }
      case "fleet": {
        // A 403 here surfaces as "You don't have permission to do this." The
        // iframe rendered its "All clear" empty state instead, so a user without
        // the fleet grant was told the fleet was fine — a reassuring answer to a
        // question that was never asked.
        if (vehicles.error) return { drill: null, loading: false, error: vehicles.error };
        if (vehicles.loading) return { drill: null, loading: true, error: null };
        return { drill: buildFleetDrill(vehicles.rows), loading: false, error: null };
      }
      default:
        return { drill: null, loading: false, error: null };
    }
  }, [id, kpis, invoices.rows, invoices.error, invoices.loading, invoices.total, clients.error, clients.loading, clientNames, dossiers.rows, dossiers.error, dossiers.loading, vehicles.rows, vehicles.error, vehicles.loading, overdue.data, overdue.isPending]);
}
