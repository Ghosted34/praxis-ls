/**
 * Clients — customer 360° command centre (spec §8.2). Pick a client to see the
 * full dossier: compliance and KYC state, banks, contacts, addresses,
 * registrations, beneficial owners, and the GL-derived receivables rollup, plus
 * the verify / block / convert lifecycle actions. The rich view is shared with
 * the supplier master (party-360.tsx).
 */
import { pageShell } from "@/lib/layout";
import { IndexRow } from "@/components/ui/index-row";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useRecordParam, useTrailTitle } from "@/app/layout/nav-trail-context";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { isDesktopNow } from "@/lib/use-media-query";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource } from "@/lib/use-resource";
import { enumLabel } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { ClientForm } from "./clients";
import { PartyDossier } from "./party-360";
import { MasterDataSettings } from "./master-data-settings";
import { Modal } from "@/components/ui/modal";
import { tenant } from "@/lib/api-client";
import { useCanUseModule } from "@/lib/route-access";
import {
  ClientRequestsPanel,
  type StaffRequest,
} from "@/features/portal/client-portal-staff";

const shell = pageShell.wide;

export function ClientsPage() {
  const clients = useResource(() => api.listClients(), []);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<api.Client | "new" | null>(null);
  const [settings, setSettings] = React.useState(false);
  // What clients sent through their portal that is waiting for us — across
  // every client, so an upload never waits for someone to open the right
  // client first. It lived on Settings → Client support until client
  // management moved here.
  const canClientPortal = useCanUseModule("MOD-29");
  const [queueOpen, setQueueOpen] = React.useState(false);
  const toReview = useResource(
    () =>
      canClientPortal
        ? tenant<StaffRequest[]>("/portal/client-requests?status=SUBMITTED")
        : Promise.resolve([] as StaffRequest[]),
    [canClientPortal],
  );
  const reviewCount = toReview.data?.length ?? 0;
  // A tenant without the client portal answers FEATURE_DISABLED: no queue then.
  const showQueue = canClientPortal && !toReview.error;

  const rows = React.useMemo(() => clients.data || [], [clients.data]);
  /*
   * WHICH RECORD IS OPEN LIVES IN THE URL (`?focus=<id>`), not in state, so
   * that picking one from this list is a step the back and forward arrows can
   * reach — see app/layout/nav-trail-context.tsx. It also makes every row
   * here linkable, which the 360 drill-ins elsewhere in the app already
   * assume they can do.
   */
  const {
    record: selected,
    id: selId,
    open: select,
    close,
    preselect,
  } = useRecordParam(rows, (c) => c.client_id);
  const filtered = q
    ? rows.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
    : rows;
  // The list opens on its first row. `preselect` writes the same param with
  // `replace`: the user did not navigate here, so it must not become a step
  // the back arrow can land on. A desktop only — on a phone the client opens
  // as a full-screen sheet over the list (SplitPane onClose), and opening one
  // unasked would cover the list on arrival.
  React.useEffect(() => {
    if (!selId && rows.length && isDesktopNow()) preselect(rows[0]);
  }, [rows, selId, preselect]);
  // Names this step for the arrow tooltips and the hold-menu.
  useTrailTitle(selected ? selected.name : null);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title={tr("Clients")}
        description="Customer master with a live 360 — compliance, KYC, banks, terms and receivables."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {showQueue ? (
              <Button
                variant="outline"
                size="sm"
                icon={null}
                onClick={() => setQueueOpen(true)}
                title={tr("Documents and answers clients sent through their portal")}
              >
                {tr("To review")}
                {reviewCount > 0 ? <Pill tone="blue">{String(reviewCount)}</Pill> : null}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>
              ⚙ {tr("Settings")}
            </Button>
            <Button onClick={() => setEditing("new")}>
              {tr("New client")}
            </Button>
          </div>
        }
      />
      <HubTabs />
      {clients.error ? (
        <ErrorState message={clients.error} />
      ) : (
        <SplitPane
          storageKey="master.clients"
          label="Client list width"
          defaultSize={260}
          min={200}
          max={480}
          activeKind={tr("Client")}
          active={!!selected}
          onClose={close}
          sheetTitle={selected?.name}
          selectionInUrl
        >
          <div className="space-y-2">
            <Input
              placeholder="Search client…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="space-y-1 rounded-lg border p-1 lg:max-h-[70vh] lg:overflow-auto">
              {clients.loading ? (
                <LoadingRow label="Loading clients…" />
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">No clients.</div>
              ) : (
                filtered.map((c) => {
                  // Bug #10: prefer the lifecycle ladder over the boolean.
                  const status = c.registration_status || (c.is_active ? "ACTIVE" : "DEACTIVATED");
                  const tone = status === "ACTIVE" ? "ok" : status === "PENDING_REVIEW" ? "blue" : "mute";
                  const label = enumLabel(status);
                  return (
                    <IndexRow
                      key={c.client_id}
                      selected={c.client_id === selId}
                      onClick={() => select(c)}
                      className="items-center justify-between gap-2"
                    >
                      <span className="truncate font-medium">{c.name}</span>
                      <Pill tone={tone}>{label}</Pill>
                    </IndexRow>
                  );
                })
              )}
            </div>
          </div>
          {selected ? (
            <PartyDossier
              kind="client"
              partyId={selected.client_id}
              onEdit={() => setEditing(selected)}
              onChanged={clients.reload}
            />
          ) : (
            <EmptyState
              title="No client selected"
              hint="Choose a client from the list."
            />
          )}
        </SplitPane>
      )}
      {editing !== null && (
        <ClientForm
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={clients.reload}
        />
      )}
      <MasterDataSettings
        open={settings}
        onClose={() => setSettings(false)}
        initialSide="CLIENT"
      />
      {showQueue ? (
        <Modal
          open={queueOpen}
          onClose={() => {
            setQueueOpen(false);
            toReview.reload();
          }}
          title={tr("Sent by clients")}
          description={tr("Documents and answers clients sent through their portal. Accept them, or send them back with a reason.")}
          size="xl"
        >
          <ClientRequestsPanel />
        </Modal>
      ) : null}
      <ScreenAi path="master/clients" />
    </section>
  );
}

export default ClientsPage;
