/**
 * Settings — payment gateway credentials and their enabled state.
 *
 * Split out of `features/settings/config-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { PageError } from "./shared";

function GatewayForm({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: Row | null }) {
  const isEdit = !!editing;
  const [provider, setProvider] = React.useState("");
  const [role, setRole] = React.useState("");
  const [credentials, setCredentials] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setProvider(editing ? String(editing.provider ?? "") : "");
    setRole(editing ? String(editing.role ?? "") : "");
    setCredentials("");
    setActive(editing ? editing.active !== false : true);
    setError(null);
  }, [open, editing]);

  const canSubmit = !!provider.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/payment-gateways", {
        method: "POST",
        body: {
          provider: provider.trim(),
          role: role.trim() || undefined,
          active,
          credentials: credentials.trim() || undefined,
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Configure ${cell(editing?.provider)}` : "Add payment gateway"}
      description="Per-tenant gateway config. Credentials are encrypted and write-only — leave blank to keep the existing secret."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" hint="e.g. paydunya, orange, stripe" required>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="paydunya" disabled={isEdit} />
          </Field>
          <Field label="Role" hint="e.g. primary, payout">
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="primary" />
          </Field>
        </div>
        <Field label="Credentials" hint={isEdit ? "Leave blank to keep the current key. JSON or token string." : "JSON or token string — stored encrypted."}>
          <Textarea className="min-h-20 font-mono"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            placeholder={isEdit && editing?.has_credentials ? "•••••• (unchanged)" : '{"public_key":"…","secret_key":"…"}'}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {isEdit ? "Save" : "Add gateway"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PaymentGatewaysPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/payment-gateways");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setFormOpen(true);
  }

  async function setActive(provider: string, active: boolean) {
    setRowBusy(provider);
    setRowError(null);
    try {
      await tenant(`/payment-gateways/${encodeURIComponent(provider)}/active`, { method: "PATCH", body: { active } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(provider: string) {
    if (!window.confirm(`Delete the ${provider} gateway? Its stored credentials are removed.`)) return;
    setRowBusy(provider);
    setRowError(null);
    try {
      await tenant(`/payment-gateways/${encodeURIComponent(provider)}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Payment gateways" description="Per-tenant gateway providers and their encrypted credentials. Keys are write-only and never returned." action={<Button onClick={openNew}>Add gateway</Button>} />

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No gateways yet" hint="Add a provider like Paydunya, Orange or Stripe." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Provider</TH>
              <TH>Role</TH>
              <TH>Credentials</TH>
              <TH>Status</TH>
              <TH>Updated</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const provider = String(r.provider);
              const active = r.active !== false;
              return (
                <TR key={provider}>
                  <TD className="text-sm font-medium">{cell(r.provider)}</TD>
                  <TD className="text-sm">{cell(r.role)}</TD>
                  <TD className="text-sm">{r.has_credentials ? <Pill tone="ok">Set</Pill> : "—"}</TD>
                  <TD className="text-sm">
                    <Pill tone={active ? "ok" : "mute"}>{active ? "Active" : "Disabled"}</Pill>
                  </TD>
                  <TD className="text-sm">{dateFmt(r.updated_at)}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        Configure
                      </Button>
                      <Button size="sm" variant={active ? "outline" : "default"} loading={rowBusy === provider} onClick={() => setActive(provider, !active)}>
                        {active ? "Disable" : "Enable"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" loading={rowBusy === provider} onClick={() => remove(provider)}>
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <GatewayForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} editing={editing} />
    </section>
  );
}

/* ─────────────────────── Scheduled reports ─────────────────────── */
