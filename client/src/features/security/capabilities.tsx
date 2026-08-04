/**
 * Security — capabilities: the ISSUER / VALIDATOR / APPROVER / LINE_MANAGER
 * ladder that the segregation-of-duties checks resolve against.
 *
 * Split out of `features/security/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { RowActions } from "@/components/ui/row-actions";
import { type Capability, ConfirmDelete, shell } from "./shared";

const CAPABILITY_CODES = ["ISSUER", "VALIDATOR", "APPROVER", "LINE_MANAGER"] as const;

function CapabilityForm({ cap, onClose, onSaved }: { cap: Capability | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!cap;
  const [code, setCode] = React.useState(cap?.code || "ISSUER");
  const [name, setName] = React.useState(cap?.name || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing && cap) await tenant(`/capabilities/${cap.capability_id}`, { method: "PATCH", body: { name } });
      else await tenant("/capabilities", { method: "POST", body: { code, name } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit capability" : "New capability"} description="The authority overlay that enforces segregation of duties on documents.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Code" required hint="Fixed set — the database rejects anything outside these four.">
          <Select value={code} onChange={(e) => setCode(e.target.value)} disabled={editing}>
            {CAPABILITY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Issues documents" />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !name}>{editing ? "Save changes" : "Create capability"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function CapabilitiesPage() {
  const { rows, error, loading, reload } = useList<Capability>("/capabilities");
  const [form, setForm] = React.useState<{ cap: Capability | null } | null>(null);
  const [del, setDel] = React.useState<Capability | null>(null);

  const columns: Column<Capability>[] = [
    { key: "code", label: "Code", render: (r) => <Pill tone="blue">{r.code}</Pill> },
    { key: "name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button size="sm" variant="outline" onClick={() => setForm({ cap: r })}>Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setDel(r)}>Delete</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title="Capabilities"
        description="ISSUER / VALIDATOR / APPROVER / LINE_MANAGER — who may act on a document, independent of which module they can see."
        action={<Button onClick={() => setForm({ cap: null })}>New capability</Button>}
      />
      <HubTabs />
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.capability_id} onRowClick={(r) => setForm({ cap: r })} empty={{ title: "No capabilities", hint: "The four standard capabilities are normally seeded." }} />
      {form && <CapabilityForm cap={form.cap} onClose={() => setForm(null)} onSaved={reload} />}
      {del && <ConfirmDelete title="Delete capability" what={`${del.code} · ${del.name}`} path={`/capabilities/${del.capability_id}`} onClose={() => setDel(null)} onDone={reload} />}
    </section>
  );
}

/* ═══════════════════════════════ Scopes ══════════════════════════════════ */
