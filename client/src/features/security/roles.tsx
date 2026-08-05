/**
 * Security — roles.
 *
 * Split out of `features/security/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";
import { tenant } from "@/lib/api-client";
import { RowActions } from "@/components/ui/row-actions";
import { type Role, ConfirmDelete, shell } from "./shared";

function RoleForm({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!role;
  const [code, setCode] = React.useState(role?.code || "");
  const [name, setName] = React.useState(role?.name || "");
  const [description, setDescription] = React.useState(role?.description || "");
  const [isLineManager, setIsLineManager] = React.useState(!!role?.is_line_manager);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { code, name, description: description || null, is_line_manager: isLineManager };
    try {
      if (editing && role) await tenant(`/roles/${role.role_id}`, { method: "PATCH", body });
      else await tenant("/roles", { method: "POST", body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit role" : "New role"} description="A role is a job area. Grants are attached to it on the Permission matrix tab.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Code" required hint="Short uppercase key, unique per tenant — e.g. FINANCE, CUSTOMS_DESK.">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={editing} placeholder="FINANCE" />
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Finance & treasury" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is responsible for" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isLineManager} onChange={(e) => setIsLineManager(e.target.checked)} className="h-4 w-4 rounded border-input" />
          <span>Line manager — layers approval authority over this role</span>
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !code || !name}>{editing ? "Save changes" : "Create role"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function RolesPage() {
  const { rows, error, loading, reload } = useList<Role>("/roles");
  const [form, setForm] = React.useState<{ role: Role | null } | null>(null);
  const [del, setDel] = React.useState<Role | null>(null);
  const all = React.useMemo(() => rows || [], [rows]);

  const columns: Column<Role>[] = [
    { key: "code", label: "Code", render: (r) => <span className="num font-medium text-primary-ink">{r.code}</span> },
    { key: "name", label: "Name", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    { key: "description", label: "Description", render: (r) => <span className="text-muted-foreground">{r.description || "—"}</span> },
    { key: "is_line_manager", label: "Authority", render: (r) => (r.is_line_manager ? <Pill tone="blue">Line manager</Pill> : "—") },
    { key: "is_system", label: "Origin", render: (r) => (r.is_system ? <Pill tone="mute">System</Pill> : <Pill tone="ok">Tenant</Pill>) },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button size="sm" variant="outline" onClick={() => setForm({ role: r })}>Edit</Button>
          <Button size="sm" variant="outline" disabled={!!r.is_system} onClick={() => setDel(r)}>Delete</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title="Roles"
        description="Job areas, stored as rows rather than code. Seeded system roles can't be deleted."
        action={<Button onClick={() => setForm({ role: null })}>New role</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Roles" value={num(all.length)} />
        <KpiTile label="Tenant-defined" value={num(all.filter((r) => !r.is_system).length)} />
        <KpiTile label="Line-manager roles" value={num(all.filter((r) => r.is_line_manager).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.role_id} onRowClick={(r) => setForm({ role: r })} empty={{ title: "No roles", hint: "Seeded defaults should appear here; add tenant-specific ones as needed." }} />
      {form && <RoleForm role={form.role} onClose={() => setForm(null)} onSaved={reload} />}
      {del && <ConfirmDelete title="Delete role" what={`${del.code} · ${del.name}`} path={`/roles/${del.role_id}`} onClose={() => setDel(null)} onDone={reload} />}
    </section>
  );
}

/* ════════════════════════════ Capabilities ═══════════════════════════════ */
