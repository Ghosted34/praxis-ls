/** Settings configuration screens wired to verified live endpoints:
 *  - BankAccountsPage    → /treasury-accounts (+ /entities for the picker)
 *  - PaymentGatewaysPage → /payment-gateways (credentials write-only)
 *  - ScheduledReportsPage→ /reports/scheduled (+ /reports/catalogue)
 *  - ApiKeysPage         → /ai/governance/vendors (api_key write-only, test)
 *  - PipelineStagesPage  → /opportunities/stages (read-only — no stage CRUD yet)
 *  - NumberingPage       → /numbering-schemes/:moduleKey (+ /catalogue/modules)
 *  Same primitives + patterns as features/settings/master-data-pages.tsx. */
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable, PageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { SearchSelect } from "@/features/sales/ui";

type Row = Record<string, unknown>;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    return e.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? cell(v) : d.toLocaleDateString();
}

/** Load a resource into state, keyed on a reload nonce. */
function useList(path: string, nonce: number) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Row[]>(path)
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [path, nonce]);
  return { rows, error };
}

function StatusPill({ active, on = "active", off = "inactive" }: { active: boolean; on?: string; off?: string }) {
  return active ? (
    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">{on}</span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{off}</span>
  );
}

function PageError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-3">
      <ErrorState message={message} />
    </div>
  );
}

/* ───────────────────────── Bank accounts ───────────────────────── */

const TREASURY_KINDS = ["BANK", "CASH", "MOMO"];

function NewAccountForm({ open, onClose, onCreated, entities }: { open: boolean; onClose: () => void; onCreated: () => void; entities: Row[] }) {
  const [entityId, setEntityId] = React.useState("");
  const [kind, setKind] = React.useState("BANK");
  const [label, setLabel] = React.useState("");
  const [coa, setCoa] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [momoNetwork, setMomoNetwork] = React.useState("");
  const [momoFee, setMomoFee] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setKind("BANK");
    setLabel("");
    setCoa("");
    setCurrency("XAF");
    setMomoNetwork("");
    setMomoFee("");
    setError(null);
  }, [open]);

  const canSubmit = !!entityId && !!label.trim() && !!coa.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/treasury-accounts", {
        method: "POST",
        body: {
          entity_id: entityId,
          kind,
          label: label.trim(),
          coa_code: coa.trim(),
          currency: currency.trim().toUpperCase() || undefined,
          momo_network: kind === "MOMO" ? momoNetwork.trim() || undefined : undefined,
          momo_fee_account: kind === "MOMO" ? momoFee.trim() || undefined : undefined,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const entityText = (en: Row) => (en.code ? `${cell(en.code)} — ${cell(en.legal_name ?? en.name ?? en.entity_id)}` : cell(en.legal_name ?? en.name ?? en.entity_id));
  const entityLabel = (() => { const en = entities.find((e) => String(e.entity_id) === entityId); return en ? entityText(en) : null; })();

  return (
    <Modal open={open} onClose={onClose} title="New bank account" description="A bank, cash or mobile-money account tied to a corporate entity and a chart-of-accounts code.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Corporate entity" required className="sm:col-span-2">
            <SearchSelect
              path="/entities"
              value={entityLabel}
              placeholder="Search entities…"
              getLabel={entityText}
              getKey={(en) => String(en.entity_id)}
              onSelect={(en) => setEntityId(String(en.entity_id))}
            />
          </Field>
          <Field label="Kind" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {TREASURY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" hint="ISO code">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="XAF" />
          </Field>
          <Field label="Label" required className="sm:col-span-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Afriland — Main XAF" />
          </Field>
          <Field label="CoA code" hint="Chart-of-accounts account (class 5)" required className="sm:col-span-2">
            <Input value={coa} onChange={(e) => setCoa(e.target.value)} placeholder="521100" />
          </Field>
          {kind === "MOMO" && (
            <>
              <Field label="MoMo network">
                <Input value={momoNetwork} onChange={(e) => setMomoNetwork(e.target.value)} placeholder="MTN / Orange" />
              </Field>
              <Field label="MoMo fee account" hint="CoA code for gateway fees">
                <Input value={momoFee} onChange={(e) => setMomoFee(e.target.value)} placeholder="627800" />
              </Field>
            </>
          )}
        </div>
        {entities.length === 0 && <p className="text-xs text-muted-foreground">No corporate entities found — create one under Master data → Corporate entities first.</p>}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function BankAccountsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/treasury-accounts", nonce);
  const { rows: entities } = useList("/entities", nonce);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const entityName = React.useCallback(
    (id: unknown) => {
      const en = (entities || []).find((e) => String(e.entity_id) === String(id));
      return en ? cell(en.code ?? en.legal_name ?? en.name) : cell(id);
    },
    [entities],
  );

  async function setActive(id: string, active: boolean) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/treasury-accounts/${id}/active`, { method: "POST", body: { active } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bank accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Company bank, cash and mobile-money accounts, each mapped to a chart-of-accounts code.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New account</Button>
      </header>

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No accounts yet" hint="Add a bank, cash or mobile-money account." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Label</TH>
              <TH>Kind</TH>
              <TH>Entity</TH>
              <TH>CoA</TH>
              <TH>Currency</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const id = String(r.treasury_account_id);
              const active = r.is_active !== false;
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{cell(r.label)}</TD>
                  <TD className="text-sm">{cell(r.kind)}</TD>
                  <TD className="text-sm">{entityName(r.entity_id)}</TD>
                  <TD className="num text-sm">{cell(r.coa_code)}</TD>
                  <TD className="text-sm">{cell(r.currency)}</TD>
                  <TD className="text-sm">
                    <StatusPill active={active} />
                  </TD>
                  <TD>
                    <Button size="sm" variant={active ? "outline" : "default"} loading={rowBusy === id} onClick={() => setActive(id, !active)}>
                      {active ? "Deactivate" : "Activate"}
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <NewAccountForm open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} entities={entities || []} />
    </section>
  );
}

/* ─────────────────────── Payment gateways ─────────────────────── */

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
          <textarea
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/payment-gateways", nonce);
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
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payment gateways</h1>
          <p className="mt-1 text-sm text-muted-foreground">Per-tenant gateway providers and their encrypted credentials. Keys are write-only and never returned.</p>
        </div>
        <Button onClick={openNew}>Add gateway</Button>
      </header>

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
                  <TD className="text-sm">{r.has_credentials ? <StatusPill active on="set" off="—" /> : "—"}</TD>
                  <TD className="text-sm">
                    <StatusPill active={active} on="active" off="disabled" />
                  </TD>
                  <TD className="text-sm">{fmtDate(r.updated_at)}</TD>
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

const CADENCES = ["daily", "weekly", "monthly", "quarterly", "on_event"];
const REPORT_FORMATS = ["pdf", "csv", "xlsx"];

function ScheduleForm({ open, onClose, onCreated, catalogue }: { open: boolean; onClose: () => void; onCreated: () => void; catalogue: Row[] }) {
  const [name, setName] = React.useState("");
  const [reportKey, setReportKey] = React.useState("");
  const [cadence, setCadence] = React.useState("monthly");
  const [recipients, setRecipients] = React.useState("");
  const [formats, setFormats] = React.useState<string[]>(["pdf"]);
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setReportKey("");
    setCadence("monthly");
    setRecipients("");
    setFormats(["pdf"]);
    setActive(true);
    setError(null);
  }, [open]);

  function toggleFormat(f: string) {
    setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  }

  const emails = recipients
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badEmail = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const canSubmit = !!name.trim() && !!reportKey && !badEmail && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/reports/scheduled", {
        method: "POST",
        body: {
          name: name.trim(),
          report_key: reportKey,
          cadence,
          recipients: emails.length ? emails : undefined,
          formats: formats.length ? formats : undefined,
          active,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Schedule a report" description="Automated report delivery on a cadence. Recipients receive the generated file by email." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly receivables ageing" />
          </Field>
          <Field label="Report" required>
            <Select value={reportKey} onChange={(e) => setReportKey(e.target.value)}>
              <option value="">Select…</option>
              {catalogue.map((c) => (
                <option key={String(c.report_key)} value={String(c.report_key)}>
                  {cell(c.report_key)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cadence" required>
            <Select value={cadence} onChange={(e) => setCadence(e.target.value)}>
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Recipients" hint="Comma-separated emails" error={badEmail ? `Invalid email: ${badEmail}` : undefined}>
            <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="cfo@acme.cm, ops@acme.cm" />
          </Field>
        </div>
        {reportKey && (
          <p className="text-xs text-muted-foreground">{cell(catalogue.find((c) => String(c.report_key) === reportKey)?.describe)}</p>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">Formats</p>
          <div className="flex gap-4">
            {REPORT_FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formats.includes(f)} onChange={() => toggleFormat(f)} />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (start delivering on the next due date)
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ScheduledReportsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/reports/scheduled", nonce);
  const { rows: catalogue } = useList("/reports/catalogue", nonce);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function toggle(id: string, active: boolean) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/reports/scheduled/${id}`, { method: "PATCH", body: { active } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete the scheduled report "${name}"?`)) return;
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/reports/scheduled/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scheduled reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Automated report delivery — pick a report, a cadence and recipients.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Schedule report</Button>
      </header>

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing scheduled" hint="Schedule a report to have it delivered automatically." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Report</TH>
              <TH>Cadence</TH>
              <TH>Recipients</TH>
              <TH>Formats</TH>
              <TH>Next run</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const id = String(r.scheduled_report_id);
              const active = r.active !== false;
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{cell(r.name)}</TD>
                  <TD className="text-sm">{cell(r.report_key)}</TD>
                  <TD className="text-sm">{cell(r.cadence)}</TD>
                  <TD className="text-sm">{cell(r.recipients)}</TD>
                  <TD className="text-sm">{cell(r.formats)}</TD>
                  <TD className="text-sm">{fmtDate(r.next_run_at)}</TD>
                  <TD className="text-sm">
                    <StatusPill active={active} on="active" off="paused" />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant={active ? "outline" : "default"} loading={rowBusy === id} onClick={() => toggle(id, !active)}>
                        {active ? "Pause" : "Resume"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" loading={rowBusy === id} onClick={() => remove(id, String(r.name))}>
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

      <ScheduleForm open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} catalogue={catalogue || []} />
    </section>
  );
}

/* ─────────────────────── API keys / AI vendors ─────────────────────── */

function VendorForm({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: Row | null }) {
  const isEdit = !!editing;
  const [vendor, setVendor] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [defaultModel, setDefaultModel] = React.useState("");
  const [currentModel, setCurrentModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setVendor(editing ? String(editing.vendor ?? "") : "");
    setDisplayName(editing ? String(editing.display_name ?? "") : "");
    setEndpoint(editing ? String(editing.endpoint_url ?? "") : "");
    setDefaultModel(editing ? String(editing.default_model ?? "") : "");
    setCurrentModel(editing ? String(editing.current_model ?? "") : "");
    setApiKey("");
    setActive(editing ? editing.is_active !== false : true);
    setError(null);
  }, [open, editing]);

  const canSubmit = !!vendor.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant(`/ai/governance/vendors/${encodeURIComponent(vendor.trim())}`, {
        method: "PUT",
        body: {
          api_key: apiKey.trim() || undefined,
          display_name: displayName.trim() || undefined,
          endpoint_url: endpoint.trim() || undefined,
          default_model: defaultModel.trim() || undefined,
          current_model: currentModel.trim() || undefined,
          is_active: active,
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
      title={isEdit ? `Configure ${cell(editing?.vendor)}` : "Add vendor key"}
      description="Third-party AI provider credentials. The API key is encrypted and write-only — leave blank to keep the current key."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" hint="e.g. openai, groq, gemini" required>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="openai" disabled={isEdit} />
          </Field>
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="OpenAI" />
          </Field>
          <Field label="Endpoint URL" hint="Base URL for the provider API" className="sm:col-span-2">
            <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field label="Default model">
            <Input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="gpt-4o-mini" />
          </Field>
          <Field label="Current model" hint="Overrides the default when set">
            <Input value={currentModel} onChange={(e) => setCurrentModel(e.target.value)} placeholder="gpt-4o" />
          </Field>
          <Field label="API key" hint={isEdit ? "Leave blank to keep the current key." : "Stored encrypted; never returned."} className="sm:col-span-2">
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isEdit ? "•••••• (unchanged)" : "sk-…"} />
          </Field>
        </div>
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
            {isEdit ? "Save" : "Add vendor"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ApiKeysPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/ai/governance/vendors", nonce);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ vendor: string; ok: boolean; text: string } | null>(null);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setFormOpen(true);
  }

  async function test(vendor: string) {
    setRowBusy(vendor);
    setRowError(null);
    setTestResult(null);
    try {
      const res = await tenant<{ ok?: boolean; models?: number; error?: string }>(`/ai/governance/vendors/${encodeURIComponent(vendor)}/test`, { method: "POST" });
      setTestResult({
        vendor,
        ok: res.ok === true,
        text: res.ok ? `Connected — ${res.models ?? 0} models available.` : res.error || "Test failed.",
      });
    } catch (e) {
      setTestResult({ vendor, ok: false, text: errMsg(e) });
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys &amp; secrets</h1>
          <p className="mt-1 text-sm text-muted-foreground">Encrypted, write-only third-party AI provider keys. Keys are never returned — only their status.</p>
        </div>
        <Button onClick={openNew}>Add vendor key</Button>
      </header>

      <PageError message={rowError} />

      {testResult && (
        <div className={`mb-3 rounded-lg border px-4 py-3 text-sm ${testResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
          <span className="font-medium">{testResult.vendor}:</span> {testResult.text}
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No vendor keys" hint="Add a provider like OpenAI, Groq or Gemini." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Vendor</TH>
              <TH>Name</TH>
              <TH>Model</TH>
              <TH>Status</TH>
              <TH>Key rotated</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const vendor = String(r.vendor);
              const active = r.is_active !== false;
              const model = r.current_model || r.default_model;
              return (
                <TR key={vendor}>
                  <TD className="text-sm font-medium">{cell(r.vendor)}</TD>
                  <TD className="text-sm">{cell(r.display_name)}</TD>
                  <TD className="text-sm">{cell(model)}</TD>
                  <TD className="text-sm">
                    <StatusPill active={active} />
                  </TD>
                  <TD className="text-sm">{fmtDate(r.last_rotated_at)}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        Configure
                      </Button>
                      <Button size="sm" variant="outline" loading={rowBusy === vendor} onClick={() => test(vendor)}>
                        Test
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <VendorForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} editing={editing} />
    </section>
  );
}

/* ─────────────────────── Pipeline stages ─────────────────────── */

export function PipelineStagesPage() {
  const { rows, error } = useList("/opportunities/stages", 0);

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline stages</h1>
        <p className="mt-1 text-sm text-muted-foreground">The CRM opportunity pipeline stages. Read-only — stage editing is not yet exposed by the backend.</p>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No stages" hint="Pipeline stages are seeded per tenant." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Order</TH>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Probability %</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={String(r.pipeline_stage_id ?? i)}>
                <TD className="num text-sm">{cell(r.sort_order)}</TD>
                <TD className="text-sm font-medium">{cell(r.code)}</TD>
                <TD className="text-sm">{cell(r.name)}</TD>
                <TD className="num text-sm">{cell(r.default_probability ?? r.probability)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/* ─────────────────────── Document numbering ─────────────────────── */

const RESET_OPTIONS = ["yearly", "never"];

type Scheme = { prefix?: string; code?: string; padding?: number; reset?: string; separator?: string };

function previewOf(s: Scheme): string {
  const sep = s.separator ?? "-";
  const year = new Date().getUTCFullYear();
  const seq = String(1).padStart(Math.max(1, Number(s.padding) || 4), "0");
  const parts = [s.prefix, s.code, s.reset === "never" ? null : year, seq].filter((p) => p !== null && p !== undefined && p !== "");
  return parts.join(sep);
}

function NumberingEditor({ moduleKey, label }: { moduleKey: string; label: string }) {
  const [scheme, setScheme] = React.useState<Scheme | null>(null);
  const [isDefault, setIsDefault] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setSaved(false);
    tenant<{ scheme: Scheme; is_default: boolean }>(`/numbering-schemes/${encodeURIComponent(moduleKey)}`)
      .then((d) => {
        if (!live) return;
        setScheme(d.scheme || {});
        setIsDefault(d.is_default !== false);
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [moduleKey]);

  function patch(p: Partial<Scheme>) {
    setScheme((s) => ({ ...(s || {}), ...p }));
    setSaved(false);
  }

  async function save() {
    if (!scheme) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        scheme: {
          prefix: scheme.prefix || undefined,
          code: scheme.code || undefined,
          padding: scheme.padding ? Number(scheme.padding) : undefined,
          reset: scheme.reset || undefined,
          separator: scheme.separator || undefined,
        },
      };
      const d = await tenant<{ scheme: Scheme; is_default: boolean }>(`/numbering-schemes/${encodeURIComponent(moduleKey)}`, { method: "PUT", body });
      setScheme(d.scheme || scheme);
      setIsDefault(d.is_default !== false);
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton rows={5} cols={3} />;
  if (error && !scheme) return <ErrorState message={error} />;
  if (!scheme) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{moduleKey}</span>
          {isDefault && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">default</span>}
        </div>
        <code className="rounded bg-background px-2 py-1 text-xs">{previewOf(scheme)}</code>
      </div>
      <div className="grid gap-4 sm:grid-cols-5">
        <Field label="Prefix">
          <Input value={scheme.prefix ?? ""} onChange={(e) => patch({ prefix: e.target.value })} placeholder="INV" />
        </Field>
        <Field label="Code" hint="Segment after prefix">
          <Input value={scheme.code ?? ""} onChange={(e) => patch({ code: e.target.value })} placeholder="51" />
        </Field>
        <Field label="Padding">
          <Input type="number" min="1" max="10" className="num text-right" value={scheme.padding ?? 4} onChange={(e) => patch({ padding: Number(e.target.value) })} />
        </Field>
        <Field label="Reset">
          <Select value={scheme.reset ?? "yearly"} onChange={(e) => patch({ reset: e.target.value })}>
            {RESET_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Separator">
          <Input maxLength={3} value={scheme.separator ?? "-"} onChange={(e) => patch({ separator: e.target.value })} placeholder="-" />
        </Field>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</span>}
        <Button size="sm" onClick={save} loading={busy}>
          Save scheme
        </Button>
      </div>
    </div>
  );
}

export function NumberingPage() {
  const { rows: modules, error } = useList("/catalogue/modules", 0);
  const [selected, setSelected] = React.useState<string>("");

  const options = (modules || []).filter((m) => m.module_key);
  const current = options.find((m) => String(m.module_key) === selected);

  React.useEffect(() => {
    if (!selected && options.length) setSelected(String(options[0].module_key));
  }, [options, selected]);

  return (
    <section className="mx-auto max-w-4xl animate-fade-in">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Document numbering</h1>
        <p className="mt-1 text-sm text-muted-foreground">Per-document numbering schemes — prefix, padding, reset cadence and separator.</p>
      </header>

      {error ? (
        <>
          <PageError message={error} />
          <p className="text-sm text-muted-foreground">The module catalogue could not be loaded (it needs IAM view access). Numbering is still editable per module once the catalogue is available.</p>
        </>
      ) : modules === null ? (
        <SkeletonTable />
      ) : options.length === 0 ? (
        <EmptyState title="No modules" hint="No document modules are available to configure." />
      ) : (
        <div className="space-y-4">
          <Field label="Document module">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {options.map((m) => (
                <option key={String(m.module_key)} value={String(m.module_key)}>
                  {cell(m.name)} ({cell(m.module_key)})
                </option>
              ))}
            </Select>
          </Field>
          {selected && <NumberingEditor key={selected} moduleKey={selected} label={current ? cell(current.name) : selected} />}
        </div>
      )}
    </section>
  );
}
