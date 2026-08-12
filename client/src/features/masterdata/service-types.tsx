/**
 * Service types — the tenant's own service taxonomy, plus everything each one
 * governs (milestone template, applicable financial dictionary lines, the
 * dossiers/margin sims/invoices classified under it).
 *
 * Master Data hub tab — the taxonomy IS master data (0310_operations.sql:7,
 * "services as DATA, not code"). The backend module lives at
 * `src/modules/operations/service_type/` because it rides MOD-29 with the
 * dossier (see service_type.events.js for why re-keying would 403 non-CEO users
 * until the platform.feature_catalogue re-seed); this frontend regrouping puts
 * the screen where the concept belongs without touching that gate.
 *
 * PATTERN. SplitPane list-with-360, same shape as client-360.tsx: search rail
 * on the left, per-service dossier on the right. The dossier is a full 360°
 * rollup (see service-type-dossier.tsx) — a service type without an active
 * milestone template silently yields dossiers with no chain, so the readiness
 * banner at the top of the dossier keeps that trap visible.
 */
import * as React from "react";
import { pageShell } from "@/lib/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import { useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";
import { ServiceTypeForm } from "./service-type-form";
import { TemplateForm } from "./service-type-template-form";
import { MilestonePolicyForm } from "./milestone-policy-form";
import { ServiceTypeDossier } from "./service-type-dossier";

const shell = pageShell.wide;

export function ServiceTypesPage() {
  const [includeInactive, setIncludeInactive] = React.useState(false);
  const list = useResource(() => api.listServiceTypes({ includeInactive }), [includeInactive]);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  // `editing` and `templating` open modals over the selected service type.
  // `null` in `editing` means "create new"; `undefined` means "closed" — same
  // three-state convention the entity-360 form uses.
  const [editing, setEditing] = React.useState<api.ServiceType | null | undefined>(undefined);
  const [templating, setTemplating] = React.useState<api.ServiceType | null>(null);
  // The ⚙ policy modal: how THIS service schedules, and what it does when its
  // SLA can no longer be met. Falls back to the tenant default when unset.
  const [policyFor, setPolicyFor] = React.useState<api.ServiceType | null>(null);

  const rows = React.useMemo(() => list.data || [], [list.data]);
  const filtered = React.useMemo(() => {
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      (r.name_en || r.name_fr || "").toLowerCase().includes(needle) ||
      (r.key || "").toLowerCase().includes(needle),
    );
  }, [rows, q]);
  const selected = rows.find((r) => r.service_type_id === selId) || null;
  React.useEffect(() => {
    // Auto-select the first row once the list arrives, so the split pane is
    // never empty on first paint (matches client-360's behaviour).
    if (!selId && rows.length) setSelId(rows[0].service_type_id);
  }, [rows, selId]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Service types"
        description="The services you sell. Dossiers are classified by service type, and each one carries the milestone chain new files start with."
        action={<Button onClick={() => setEditing(null)}>New service type</Button>}
      />
      <HubTabs />

      {list.error ? (
        <ErrorState message={list.error} />
      ) : (
        <SplitPane storageKey="master.service-types" label="Service type list width" defaultSize={280} min={220} max={480}>
          <div className="space-y-2">
            <Input placeholder="Search service…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Show archived
            </label>
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {list.loading ? (
                <LoadingRow label="Loading service types…" />
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">No service types.</div>
              ) : (
                filtered.map((r) => (
                  <button
                    key={r.service_type_id}
                    onClick={() => setSelId(r.service_type_id)}
                    className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      r.service_type_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{r.name_en || r.name_fr}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        {/* Trap-visible: a service type with no active milestone template silently
                            produces dossiers with no chain (0310_operations.sql:7). Amber pill on the
                            list keeps the fix one click away rather than buried in a tab. */}
                        {r.is_active && !r.has_active_template && <Pill tone="warn">no chain</Pill>}
                        <Pill tone={r.is_active ? "ok" : "mute"}>{r.is_active ? "Active" : "Off"}</Pill>
                      </div>
                    </div>
                    <span className="micro">{r.key}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          {selected ? (
            <ServiceTypeDossier
              serviceTypeId={selected.service_type_id}
              onEdit={() => setEditing(selected)}
              onPublishTemplate={() => setTemplating(selected)}
              onEditPolicy={() => setPolicyFor(selected)}
              onChanged={list.reload}
            />
          ) : (
            <EmptyState
              title="No service type selected"
              hint="Pick one from the list, or create a new one — dossiers can't carry a milestone chain until at least one exists."
            />
          )}
        </SplitPane>
      )}

      <ScreenAi path="master/service-types" />

      {editing !== undefined && (
        <ServiceTypeForm row={editing} onClose={() => setEditing(undefined)} onSaved={list.reload} />
      )}
      {templating && (
        <TemplateForm svc={templating} onClose={() => setTemplating(null)} onSaved={list.reload} />
      )}
      {policyFor && (
        <MilestonePolicyForm
          serviceTypeId={policyFor.service_type_id}
          serviceTypeName={policyFor.name_en || policyFor.name_fr}
          onClose={() => setPolicyFor(null)}
        />
      )}
    </section>
  );
}

export default ServiceTypesPage;
