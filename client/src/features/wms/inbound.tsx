/**
 * Inbound / GRN — receiving + QA gate (replaces the CRUD table). A goods-received
 * note opens on HOLD; QA either PASSES it (choosing a putaway location) or REJECTS
 * it. Once decided the GRN is terminal.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { TransitionButtons, type Transition } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import * as api from "@/lib/wms-api";

const shell = "mx-auto max-w-6xl animate-fade-in";
const QA_TONE: Record<string, Tone> = { HOLD: "warn", PASSED: "ok", REJECTED: "bad" };
const QA_LABEL: Record<string, string> = { HOLD: "On hold", PASSED: "Passed", REJECTED: "Rejected" };

type Dossier = { dossier_id: string; ref?: string | null };

/* QA pass — choose the putaway location the received goods slot into. */
function PassModal({ grn, locations, onClose, onSaved }: { grn: api.GrnInbound; locations: api.WarehouseLocation[]; onClose: () => void; onSaved: () => void }) {
  const [loc, setLoc] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.setInboundQa(grn.grn_inbound_id, "PASSED", loc || undefined); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Pass QA" description="Accept the received goods and slot them into a putaway location.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Putaway location">
          <Select value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">—</option>
            {locations.map((l) => <option key={l.location_id} value={l.location_id}>{api.locationLabel(l)}</option>)}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Pass QA</Button>
        </div>
      </form>
    </Modal>
  );
}

function NewGrnForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.createInbound({ dossier_id: dossierId || undefined }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New receipt" description="Open a goods-received note. It starts on hold pending QA.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Dossier" hint="Optional — the operation this delivery belongs to">
          <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
            <option value="">—</option>
            {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref || d.dossier_id.slice(0, 8)}</option>)}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Open receipt</Button>
        </div>
      </form>
    </Modal>
  );
}

export function InboundPage() {
  const grns = useResource(() => api.listInbound(), []);
  const locs = useResource(() => api.listLocations(), []);
  const [creating, setCreating] = React.useState(false);
  const [passing, setPassing] = React.useState<api.GrnInbound | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const locMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    (locs.data || []).forEach((l) => { m[l.location_id] = api.locationLabel(l); });
    return m;
  }, [locs.data]);

  async function reject(g: api.GrnInbound) {
    setBusy(g.grn_inbound_id);
    try { await api.setInboundQa(g.grn_inbound_id, "REJECTED"); grns.reload(); } finally { setBusy(null); }
  }

  const cols: Column<api.GrnInbound>[] = [
    { key: "id", label: "GRN", render: (g) => <span className="num font-medium text-foreground">#{g.grn_inbound_id.slice(0, 8)}</span> },
    { key: "qa", label: "QA", render: (g) => <Pill tone={QA_TONE[g.qa_status] || "mute"}>{QA_LABEL[g.qa_status] || g.qa_status}</Pill> },
    { key: "putaway", label: "Putaway", render: (g) => <span className="text-muted-foreground">{g.putaway_location ? (locMap[g.putaway_location] || "—") : "—"}</span> },
    { key: "created", label: "Received", render: (g) => <span className="num text-muted-foreground">{dateFmt(g.created_at)}</span> },
    {
      key: "_a", label: "",
      render: (g) => {
        const items: Transition[] =
          g.qa_status === "HOLD"
            ? [
                { to: "REJECTED", label: "Reject", variant: "outline", loading: busy === g.grn_inbound_id },
                { to: "PASS", label: "Pass QA" },
              ]
            : [];
        return (
          <div className="flex items-center justify-end gap-2">
            <DocButton docType="GRN" id={g.grn_inbound_id} title={`GRN ${g.grn_inbound_id.slice(0, 8)}`} label="View" />
            <TransitionButtons items={items} onTransition={(to) => (to === "REJECTED" ? reject(g) : setPassing(g))} />
          </div>
        );
      },
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Warehouse" />} title="Inbound / GRN" description="Receive goods and clear them through QA before putaway." action={<Button onClick={() => setCreating(true)}>New receipt</Button>} />
      <HubTabs />
      <DataList columns={cols} rows={grns.data} error={grns.error} loading={grns.loading} rowKey={(g) => g.grn_inbound_id} empty={{ title: "Nothing received", hint: "Open a receipt when goods arrive." }} />
      {creating && <NewGrnForm onClose={() => setCreating(false)} onSaved={grns.reload} />}
      {passing && <PassModal grn={passing} locations={locs.data || []} onClose={() => setPassing(null)} onSaved={grns.reload} />}
      <ScreenAi path="wms/inbound" />
    </section>
  );
}

export default InboundPage;
