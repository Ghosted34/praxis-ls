/**
 * Operation files — the dossier list.
 *
 * PHASE 3, and this one is a CORRECTNESS fix, not a refactor (Addendum 3).
 *
 * The screen used to call `useList("/operations")` and filter the result in the
 * browser. The API's shared pagination helper clamps every list to 50 rows, so
 * on any tenant past its fiftieth dossier the search box was searching the fifty
 * most recent files and reporting "No operation files yet" for a dossier that
 * existed. Same shape as the Finance hub's defect, same fix: the search, the
 * status filter, the service-type filter and the paging all happen in SQL, and
 * the counts on the chips come from `X-Total-Count` rather than `rows.length`.
 *
 * The service-FAMILY chips are gone, and deliberately. They bucketed dossiers by
 * substring-matching `service_key` against four hardcoded families ("SEA",
 * "AIR", "HINTERLAND", "WAREHOUSING") — a guess that could only ever be made
 * over the rows already loaded, and that silently filed anything else under
 * "OTHER". A service-type select is exact, server-side, and reflects the types
 * the tenant actually configured.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { ListPage } from "@/components/list-page";
import type { Column } from "@/components/data-list";
import { Pill } from "@/components/ui/pill";
import { AiActions } from "@/components/ai-actions";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useList, useListPaged } from "@/lib/use-resource";
import { useFocusRow } from "@/lib/use-focus-row";
import { useDebounced } from "@/lib/use-debounced";
import { money0 } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { DossierForm } from "./dossier-form";
import { Dossier360Modal } from "./dossier-360";
import { routeLabel, serviceLabel, tone } from "./shared";
import { MilestoneCell } from "./components";

const OPS_FILES_AI: AiAction[] = [
  { label: "List / get dossiers", kind: "read", describe: "List operation files (dossiers) or fetch one." },
  { label: "Open / advance dossier", kind: "write", describe: "Open a dossier, update it, or advance its status." },
];

const PAGE_SIZE = 25;
/** Status chips, in lifecycle order. `null` is "all". */
const STATUS_CHIPS: { key: string; label: string; status?: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OPEN", label: "Open", status: "OPEN" },
  { key: "IN_PROGRESS", label: "In progress", status: "IN_PROGRESS" },
  { key: "COMPLETED", label: "Completed", status: "COMPLETED" },
];

export function OperationsFilesPage() {
  // `?ref=` deep-links a single dossier — the Control Tower's live-shipment rows
  // use it, since there's no dossier-detail route to send them to. It only seeds
  // the initial search; the user can clear or change it like any other query.
  const [searchParams] = useSearchParams();
  const [q, setQ] = React.useState(() => searchParams.get("ref") || "");
  const [status, setStatus] = React.useState("ALL");
  const [serviceTypeId, setServiceTypeId] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [editing, setEditing] = React.useState<api.Dossier | "new" | null>(null);
  const [view, setView] = React.useState<api.Dossier | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Search hits the API now, so it is debounced.
  const search = useDebounced(q, 300);
  // A new filter must restart at page 1. Without this, filtering while on page 3
  // asks for offset 50 of a result set that may hold two rows, and the table
  // renders empty for a query that matched.
  React.useEffect(() => setPage(0), [search, status, serviceTypeId]);

  const { rows: serviceTypes } = useList<api.ServiceType>("/service-types");

  const filters = { q: search, service_type_id: serviceTypeId || undefined };
  const active = STATUS_CHIPS.find((c) => c.key === status) ?? STATUS_CHIPS[0];
  const list = useListPaged<api.Dossier>("/operations", {
    ...filters,
    status: active.status,
    page,
    pageSize: PAGE_SIZE,
  });
  // `?focus=<dossier_id>` from the client 360's dossiers drill-in. Operations
  // already honours the friendlier `?ref=<ref>` (seeded into the search box
  // above); this is the fallback for links that only had the uuid at hand.
  const { focusId } = useFocusRow(list.rows);
  // Auto-open the 360 modal if the focus id matches — "select that file"
  // (parity with the click on any row here).
  React.useEffect(() => {
    if (!focusId || !list.rows) return;
    const hit = list.rows.find((d) => d.dossier_id === focusId);
    if (hit && !view) setView(hit);
    // Only trigger the auto-open once per focus id — the deps intentionally
    // exclude `view` so closing the modal doesn't re-pop it while the URL
    // param is still there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, list.rows]);

  /**
   * Chip counts, honestly.
   *
   * Each is a one-row request read purely for its `X-Total-Count`, so a chip
   * says how many dossiers match ACROSS THE TENANT rather than how many happen
   * to be on the loaded page. They share the search and service filters, so the
   * counts track what the user has narrowed to. Four ~200-byte responses,
   * deduplicated and cached by Query for 30s.
   */
  const countAll = useListPaged<api.Dossier>("/operations", { ...filters, pageSize: 1 });
  const countOpen = useListPaged<api.Dossier>("/operations", { ...filters, status: "OPEN", pageSize: 1 });
  const countProgress = useListPaged<api.Dossier>("/operations", { ...filters, status: "IN_PROGRESS", pageSize: 1 });
  const countDone = useListPaged<api.Dossier>("/operations", { ...filters, status: "COMPLETED", pageSize: 1 });
  const counts: Record<string, number> = {
    ALL: countAll.total,
    OPEN: countOpen.total,
    IN_PROGRESS: countProgress.total,
    COMPLETED: countDone.total,
  };

  const clientOf = (r: api.Dossier) => r.client_name || "—";

  // try/finally with no catch swallowed every failure here — see
  // doc/PERMISSION_SWEEP_BACKLOG.md §C and lib/use-action.ts.
  async function advance(d: api.Dossier) {
    const next = d.status === "OPEN" ? "IN_PROGRESS" : d.status === "IN_PROGRESS" ? "COMPLETED" : null;
    if (!next) return;
    setBusyId(d.dossier_id);
    setActionError(null);
    try {
      await api.transitionDossier(d.dossier_id, next);
      list.reload();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<api.Dossier>[] = [
    { key: "ref", label: "Reference", className: "whitespace-nowrap", render: (r) => <span className="num font-medium text-foreground">{r.ref}</span> },
    { key: "client", label: "Client", className: "whitespace-nowrap", render: (r) => clientOf(r) },
    {
      key: "service",
      label: "Service",
      className: "whitespace-nowrap",
      render: (r) =>
        r.service_key || r.service_name_en ? <Pill tone="mute">{serviceLabel(r)}</Pill> : <span className="text-muted-foreground">—</span>,
    },
    { key: "route", label: "Route", className: "whitespace-nowrap", render: (r) => <span className="text-muted-foreground">{routeLabel(r)}</span> },
    { key: "milestone", label: "Milestone", render: (r) => <MilestoneCell row={r} /> },
    { key: "costing", label: "Costing · XAF", className: "num whitespace-nowrap text-right", render: (r) => money0(r.costing_total) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()} role="presentation">
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
            Edit
          </Button>
          {(r.status === "OPEN" || r.status === "IN_PROGRESS") && (
            <Button size="sm" variant="outline" loading={busyId === r.dossier_id} onClick={() => advance(r)}>
              {r.status === "OPEN" ? "Start" : "Complete"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const filtered = !!search || status !== "ALL" || !!serviceTypeId;

  return (
    <ListPage<api.Dossier>
      eyebrow={<HubCrumb area="Operations" to="/operations" />}
      title="Operation files"
      description="The dossier is the centre of gravity — route, milestones, costing, money and documents in one 360° view."
      action={<Button onClick={() => setEditing("new")}>New file</Button>}
      tabs={<HubTabs />}
      toolbar={
        <>
          <div className="chips">
            {STATUS_CHIPS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setStatus(c.key)}
                aria-pressed={status === c.key}
                className={`chip ${status === c.key ? "on" : ""}`}
              >
                {c.label} <span className="ct num">{counts[c.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Select
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
              aria-label="Service type"
              className="w-full max-w-[14rem]"
            >
              <option value="">All service types</option>
              {(serviceTypes || []).map((s) => (
                <option key={s.service_type_id} value={s.service_type_id}>
                  {s.name_en || s.name_fr}
                </option>
              ))}
            </Select>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search operation files"
              placeholder="Search by ref, client, BL/MAWB, vessel…"
              className="w-full max-w-xs"
            />
          </div>
        </>
      }
      columns={columns}
      rows={list.rows}
      error={list.error}
      loading={list.loading}
      rowKey={(r) => r.dossier_id}
      onRowClick={(r) => setView(r)}
      highlightRowKey={focusId}
      empty={{
        title: "No operation files yet",
        hint: "Open a dossier to start moving a shipment — route, milestones, costing and invoicing all hang off it.",
        action: <Button onClick={() => setEditing("new")}>New file</Button>,
      }}
      filtered={filtered}
      emptyFiltered={{
        title: "No operation files match",
        hint: "The search covers reference, client, BL/MAWB and vessel across every file, not just this page.",
        action: (
          <Button
            variant="outline"
            icon={null}
            onClick={() => {
              setQ("");
              setStatus("ALL");
              setServiceTypeId("");
            }}
          >
            Clear filters
          </Button>
        ),
      }}
      pagination={{ page: list.page, pageSize: list.pageSize, total: list.total, onPageChange: setPage }}
    >
      {actionError && <ErrorState message={actionError} />}
      {editing !== null && (
        <DossierForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={list.reload} />
      )}
      {view && <Dossier360Modal dossier={view} clientLabel={clientOf(view)} onClose={() => setView(null)} />}
      <AiActions actions={OPS_FILES_AI} />
    </ListPage>
  );
}
