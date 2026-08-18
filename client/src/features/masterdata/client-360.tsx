/**
 * Clients — customer 360° command centre (spec §8.2). Pick a client to see the
 * full dossier: compliance and KYC state, banks, contacts, addresses,
 * registrations, beneficial owners, and the GL-derived receivables rollup, plus
 * the verify / block / convert lifecycle actions. The rich view is shared with
 * the supplier master (party-360.tsx).
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource } from "@/lib/use-resource";
import * as api from "@/lib/masterdata-api";
import { ClientForm } from "./clients";
import { PartyDossier } from "./party-360";
import { MasterDataSettings } from "./master-data-settings";

const shell = pageShell.wide;

export function ClientsPage() {
  const clients = useResource(() => api.listClients(), []);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<api.Client | "new" | null>(null);
  const [settings, setSettings] = React.useState(false);

  const rows = React.useMemo(() => clients.data || [], [clients.data]);
  const filtered = q
    ? rows.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
    : rows;
  const selected = rows.find((c) => c.client_id === selId) || null;
  React.useEffect(() => {
    if (!selId && rows.length) setSelId(rows[0].client_id);
  }, [rows, selId]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title={tr("Clients")}
        description="Customer master with a live 360 — compliance, KYC, banks, terms and receivables."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>
              ⚙ Settings
            </Button>
            <Button onClick={() => setEditing("new")}>{tr("New client")}</Button>
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
        >
          <div className="space-y-2">
            <Input
              placeholder="Search client…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {clients.loading ? (
                <LoadingRow label="Loading clients…" />
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">No clients.</div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.client_id}
                    onClick={() => setSelId(c.client_id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${c.client_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                  >
                    <span className="truncate font-medium">{c.name}</span>
                    <Pill tone={c.is_active ? "ok" : "mute"}>
                      {c.is_active ? "Active" : "Off"}
                    </Pill>
                  </button>
                ))
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
      <ScreenAi path="master/clients" />
    </section>
  );
}

export default ClientsPage;
