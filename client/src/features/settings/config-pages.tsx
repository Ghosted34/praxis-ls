/** Settings configuration screens wired to verified live endpoints:
 *  - BankAccountsPage    → /treasury-accounts (+ /entities for the picker)
 *  - PaymentGatewaysPage → /payment-gateways (credentials write-only)
 *  - ScheduledReportsPage→ /reports/scheduled (+ /reports/catalogue)
 *  - ApiKeysPage         → /settings/integration_secret (add/rotate + test; AI keys live in AI Control)
 *  - PipelineStagesPage  → /opportunities/stages (read-only — no stage CRUD yet)
 *  - NumberingPage       → /numbering-schemes/:moduleKey (static doc-type list)
 *  Same primitives + patterns as features/settings/master-data-pages.tsx. */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable, PageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";

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
  const reload = useRefresh();
  const { rows, error } = useList("/treasury-accounts");
  const { rows: entities } = useList("/entities");
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
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Bank accounts" description="Company bank, cash and mobile-money accounts, each mapped to a chart-of-accounts code." action={<Button onClick={() => setCreateOpen(true)}>New account</Button>} />
      <HubTabs />

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
                    <Pill tone={active ? "ok" : "mute"}>{active ? "Active" : "Inactive"}</Pill>
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
  const reload = useRefresh();
  const { rows, error } = useList("/reports/scheduled");
  const { rows: catalogue } = useList("/reports/catalogue");
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
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Scheduled reports" description="Automated report delivery — pick a report, a cadence and recipients." action={<Button onClick={() => setCreateOpen(true)}>Schedule report</Button>} />

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
                  <TD className="text-sm">{dateFmt(r.next_run_at)}</TD>
                  <TD className="text-sm">
                    <Pill tone={active ? "ok" : "mute"}>{active ? "Active" : "Paused"}</Pill>
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

/* ─────────────────────── API keys & integration secrets ─────────────────────── */

/* Generic tenant integration secrets, wired to /settings/integration_secret
 * (write-only; only last4 is ever returned). Domain-owned keys live on their own
 * screens and are hidden here: FX → Currencies & FX, WhatsApp/SMTP → Comms →
 * Setup, AI providers → AI Control → Vendors. */
type Integration = { key: string; provider: string; keyName: string; label: string; hint: string };
const KNOWN_INTEGRATIONS: Integration[] = [];
// Secrets configured by a dedicated screen — never surfaced on this generic page.
const DOMAIN_OWNED = new Set(["fx_exchangerate", "whatsapp_token", "email_smtp_pass"]);

type KeyInit = { key?: string; label?: string; provider?: string; keyName?: string; locked?: boolean; configured?: boolean };

function KeyForm({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved: () => void; initial: KeyInit | null }) {
  const locked = !!initial?.locked;
  const configured = !!initial?.configured;
  const [key, setKey] = React.useState("");
  const [provider, setProvider] = React.useState("");
  const [keyName, setKeyName] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setKey(initial?.key ?? "");
    setProvider(initial?.provider ?? "");
    setKeyName(initial?.keyName ?? "");
    setSecret("");
    setError(null);
  }, [open, initial]);

  const canSubmit = !!key.trim() && !!provider.trim() && !!secret.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant(`/settings/integration_secret/${encodeURIComponent(key.trim())}`, {
        method: "PUT",
        body: { value: { provider: provider.trim(), key_name: keyName.trim() || undefined, secret: secret.trim() } },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const title = configured ? `Rotate ${initial?.label ?? key}` : initial?.label ? `Set up ${initial.label}` : "Add key";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Encrypted, write-only third-party key. It is never returned — only the last 4 characters are shown."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Key" hint="Stable identifier used in code" required>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="fx_exchangerate" disabled={locked} />
          </Field>
          <Field label="Provider" required>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="exchangerate-api" disabled={locked} />
          </Field>
          <Field label="Key name" hint="Optional label (e.g. env var name)">
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="EXCHANGERATE_API_KEY" />
          </Field>
          <Field label="Secret" hint={configured ? "Enter the new value to rotate." : "Stored encrypted; never returned."} required>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={configured ? "•••••• (new value)" : "paste key…"} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {configured ? "Rotate key" : "Save key"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ApiKeysPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/settings/integration_secret");
  const [formOpen, setFormOpen] = React.useState(false);
  const [initial, setInitial] = React.useState<KeyInit | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ key: string; ok: boolean; text: string } | null>(null);

  // Known integrations always show (as "Set up" rows until configured); any
  // other configured keys are appended as custom rows.
  const display = React.useMemo(() => {
    const known = KNOWN_INTEGRATIONS.map((k) => ({
      key: k.key, label: k.label, provider: k.provider, keyName: k.keyName, hint: k.hint,
      row: (rows || []).find((r) => String(r.key) === k.key),
    }));
    const extra = (rows || [])
      .filter((r) => !KNOWN_INTEGRATIONS.some((k) => k.key === String(r.key)) && !DOMAIN_OWNED.has(String(r.key)))
      .map((r) => {
        const v = (r.value || {}) as { provider?: string; key_name?: string };
        return { key: String(r.key), label: String(r.key), provider: v.provider || "", keyName: v.key_name || "", hint: "", row: r };
      });
    return [...known, ...extra];
  }, [rows]);

  function openAdd() {
    setInitial(null);
    setFormOpen(true);
  }
  function openConfigure(d: (typeof display)[number]) {
    const v = (d.row?.value || {}) as { last4?: string };
    // key + provider are locked for a specific integration so the stored value
    // keeps matching the backend consumer + test probe.
    setInitial({ key: d.key, label: d.label, provider: d.provider, keyName: d.keyName, locked: true, configured: !!v.last4 });
    setFormOpen(true);
  }

  async function test(key: string) {
    setRowBusy(key);
    setTestResult(null);
    try {
      const res = await tenant<{ ok?: boolean; provider?: string; error?: string }>(`/settings/integration_secret/${encodeURIComponent(key)}/test`, { method: "POST" });
      setTestResult({ key, ok: res.ok === true, text: res.ok ? "Connected." : res.error || "Test failed." });
    } catch (e) {
      setTestResult({ key, ok: false, text: errMsg(e) });
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="API keys & secrets"
        description={<>Encrypted, write-only third-party integration keys (FX &amp; more). Keys are never returned — only their last 4 characters. AI provider keys are managed in the platform console.</>}
        action={<Button onClick={openAdd}>Add key</Button>}
      />

      {testResult && (
        <div className={`mb-3 rounded-lg border px-4 py-3 text-sm ${testResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
          <span className="font-medium">{testResult.key}:</span> {testResult.text}
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : display.length === 0 ? (
        <EmptyState title="No custom keys" hint="FX lives in Currencies & FX, messaging keys in Comms → Setup, and AI keys in AI Control. Use “Add key” for anything else." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Integration</TH>
              <TH>Provider</TH>
              <TH>Secret</TH>
              <TH>Updated</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {display.map((d) => {
              const v = (d.row?.value || {}) as { last4?: string };
              const isSet = !!v.last4;
              return (
                <TR key={d.key}>
                  <TD className="text-sm font-medium">
                    {d.label}
                    {d.label !== d.key && <span className="ml-2 num text-xs text-muted-foreground">{d.key}</span>}
                    {d.hint && <div className="text-xs font-normal text-muted-foreground">{d.hint}</div>}
                  </TD>
                  <TD className="text-sm">{cell(d.provider)}</TD>
                  <TD className="text-sm">{isSet ? <Pill tone="ok">{`Set · …${v.last4}`}</Pill> : <Pill tone="mute">Not set</Pill>}</TD>
                  <TD className="text-sm">{dateFmt(d.row?.updated_at)}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openConfigure(d)}>
                        {isSet ? "Rotate" : "Set up"}
                      </Button>
                      {isSet && (
                        <Button size="sm" variant="outline" loading={rowBusy === d.key} onClick={() => test(d.key)}>
                          Test
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <KeyForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} initial={initial} />
    </section>
  );
}

/* ─────────────────────── Pipeline stages ─────────────────────── */

export function PipelineStagesPage() {
  const { rows, error } = useList("/opportunities/stages");

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Pipeline stages" description="The CRM opportunity pipeline stages. Read-only — stage editing is not yet exposed by the backend." />

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

// The document types that actually draw a number from the tenant's numbering
// sequences — the moduleKey each issuer passes to numbering.allocate(). This is
// the canonical list (mirrors scripts/tenant/seed-numbering.js and the
// document_vault doc_type registry); the page is driven by it instead of the
// full module catalogue, which listed every MOD-xx (IAM, WMS, HR…) — none of
// which issue documents — and required IAM-view access just to load.
const DOC_NUMBER_MODULES: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "Documents",
    items: [
      { key: "MOD-51", label: "Final invoice" },
      { key: "MOD-51-CN", label: "Credit note" },
      { key: "MOD-50", label: "Proforma / customer advance" },
      { key: "MOD-52", label: "Payment receipt" },
      { key: "MOD-27", label: "Quotation" },
      { key: "MOD-23", label: "Proposal" },
      { key: "MOD-60", label: "Purchase order" },
      { key: "MOD-62", label: "Purchase request" },
      { key: "MOD-61", label: "Supplier invoice" },
      { key: "MOD-30", label: "Transit order" },
      { key: "MOD-32", label: "Delivery note" },
      { key: "MOD-29", label: "Dossier / operations file" },
      { key: "MOD-49", label: "Cash request / régie advance" },
    ],
  },
  {
    group: "Master codes",
    items: [
      { key: "MOD-04", label: "Supplier code" },
      { key: "MOD-03", label: "Client code" },
    ],
  },
];

const DOC_MODULE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_NUMBER_MODULES.flatMap((g) => g.items.map((it) => [it.key, it.label])),
);

export function NumberingPage() {
  const [selected, setSelected] = React.useState<string>(DOC_NUMBER_MODULES[0].items[0].key);

  return (
    <section className={pageShell.reading}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Document numbering" description="Per-document numbering schemes — prefix, padding, reset cadence and separator." />

      <div className="space-y-4">
        <Field label="Document type">
          <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {/* Disabled header rows group the list while staying direct <option>
                children, so the Select's option-colour styling still applies
                (an <optgroup> would nest them and lose it in dark mode). */}
            {DOC_NUMBER_MODULES.map((g) => (
              <React.Fragment key={g.group}>
                <option disabled>{"— " + g.group + " —"}</option>
                {g.items.map((it) => (
                  <option key={it.key} value={it.key}>
                    {it.label}
                  </option>
                ))}
              </React.Fragment>
            ))}
          </Select>
        </Field>
        <NumberingEditor key={selected} moduleKey={selected} label={DOC_MODULE_LABEL[selected] || selected} />
      </div>
    </section>
  );
}
