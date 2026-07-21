/**
 * Settings tiles hosted on the generic tenant settings store (MOD-70,
 * `/settings/:section/:key`, jsonb value). These fill Pixie-parity gaps that
 * have no dedicated BE module — the store's `setting.rules.js` shape-checks each
 * section:
 *   - DocumentTemplatesPage → section `document_template` (key = doc type)
 *   - CustomFieldsPage      → section `custom_field`     (key = entity type; value = field-def array)
 *   - EmailSignaturesPage   → section `email_signature`  (key = `template`, tenant-wide brand html)
 *   - BusinessPoliciesPage  → section `policy`           (key = policy slug)
 *
 * All writes need MOD-70 `edit`; a role without it 403s (graceful error state).
 * Same primitives as config-pages.tsx / master-data-pages.tsx.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Row, cell, errMsg, useList, Badge } from "@/features/sales/ui";

const TEXTAREA = "w-full rounded-lg border bg-background px-3 py-2 text-sm";

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").slice(0, 60);

function PageError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-3">
      <ErrorState message={message} />
    </div>
  );
}

type Entry = { key: string; value: Row };

/** Read the object-value of a settings row, tolerant of shape. */
function entryValue(r: Row): Row {
  const v = r.value;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

/* ═══════════════════════════════ Document templates ═══════════════════════════════ */

const TEMPLATE_STATUS = ["draft", "published", "archived"];

function TemplateForm({ open, editing, onClose, onSaved }: { open: boolean; editing: Entry | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("");
  const [docKey, setDocKey] = React.useState("");
  const [status, setStatus] = React.useState("draft");
  const [bodyHtml, setBodyHtml] = React.useState("");
  const [cssVars, setCssVars] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const v = editing?.value ?? {};
    setName(v.name ? String(v.name) : "");
    setDocKey(editing?.key ?? "");
    setStatus(v.status ? String(v.status) : "draft");
    setBodyHtml(v.body_html ? String(v.body_html) : "");
    setCssVars(v.css_vars ? JSON.stringify(v.css_vars, null, 2) : "");
    setError(null);
  }, [open, editing]);

  const canSubmit = !!name.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const value: Row = { name: name.trim(), status, body_html: bodyHtml };
    if (cssVars.trim()) {
      try {
        const parsed = JSON.parse(cssVars);
        if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        value.css_vars = parsed;
      } catch {
        setBusy(false);
        setError("CSS variables must be a valid JSON object, e.g. {\"--brand\": \"#F5821F\"}.");
        return;
      }
    }
    const key = editing?.key || slug(docKey || name);
    try {
      await tenant(`/settings/document_template/${encodeURIComponent(key)}`, { method: "PUT", body: { value } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit template" : "New document template"} description="A letterhead / document body the issuing module renders. Keyed by document type." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice — default" />
          </Field>
          <Field label="Document type key" hint={editing ? "Locked after creation" : "e.g. invoice, purchase_order, receipt"}>
            <Input value={docKey} onChange={(e) => setDocKey(e.target.value)} placeholder="invoice" disabled={!!editing} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {TEMPLATE_STATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Body (HTML)" hint="Rendered as the document body">
          <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={8} placeholder="<h1>{{entity.legal_name}}</h1>…" className={TEXTAREA} />
        </Field>
        <Field label="CSS variables (JSON)" hint="Optional — overrides for this template, e.g. {&quot;--brand&quot;: &quot;#F5821F&quot;}">
          <textarea value={cssVars} onChange={(e) => setCssVars(e.target.value)} rows={3} placeholder="{}" className={TEXTAREA} />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save template" : "Create template"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function DocumentTemplatesPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/settings/document_template", nonce);
  const [editing, setEditing] = React.useState<Entry | null>(null);
  const [open, setOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const edit = (e: Entry | null) => {
    setEditing(e);
    setOpen(true);
  };
  async function del(key: string) {
    setRowBusy(key);
    setRowError(null);
    try {
      await tenant(`/settings/document_template/${encodeURIComponent(key)}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-semibold tracking-tight">Document templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">Letterhead and body templates per document type — invoices, POs, receipts, contracts.</p>
        </div>
        <Button onClick={() => edit(null)}>New template</Button>
      </header>

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No templates yet" hint="Create a template for a document type." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const key = String(r.key);
              const v = entryValue(r);
              return (
                <TR key={key}>
                  <TD className="text-sm font-medium">{cell(v.name)}</TD>
                  <TD className="num text-sm">{key}</TD>
                  <TD className="text-sm">
                    <Badge label={String(v.status ?? "draft")} />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => edit({ key, value: v })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" loading={rowBusy === key} onClick={() => del(key)}>
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

      <TemplateForm open={open} editing={editing} onClose={() => setOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════════ Custom fields ═══════════════════════════════ */

const FIELD_TYPES = ["text", "number", "boolean", "date", "select", "multiselect"];
type FieldDef = { field_key: string; label: string; field_type: string; required: boolean };

function blankField(): FieldDef {
  return { field_key: "", label: "", field_type: "text", required: false };
}

function CustomFieldForm({ open, editing, onClose, onSaved }: { open: boolean; editing: Entry | null; onClose: () => void; onSaved: () => void }) {
  const [entityKey, setEntityKey] = React.useState("");
  const [fields, setFields] = React.useState<FieldDef[]>([blankField()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityKey(editing?.key ?? "");
    const arr = Array.isArray(editing?.value) ? (editing?.value as unknown as Row[]) : [];
    setFields(
      arr.length
        ? arr.map((d) => ({
            field_key: String(d.field_key ?? ""),
            label: String(d.label ?? ""),
            field_type: FIELD_TYPES.includes(String(d.field_type)) ? String(d.field_type) : "text",
            required: d.required === true,
          }))
        : [blankField()],
    );
    setError(null);
  }, [open, editing]);

  function setField(i: number, patch: Partial<FieldDef>) {
    setFields((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const canSubmit = !!entityKey.trim() && fields.some((f) => f.field_key.trim()) && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const clean = fields
      .filter((f) => f.field_key.trim())
      .map((f) => ({ field_key: slug(f.field_key), label: f.label.trim() || f.field_key.trim(), field_type: f.field_type, required: f.required }));
    const keys = new Set<string>();
    for (const f of clean) {
      if (keys.has(f.field_key)) {
        setBusy(false);
        setError(`Duplicate field key "${f.field_key}".`);
        return;
      }
      keys.add(f.field_key);
    }
    try {
      await tenant(`/settings/custom_field/${encodeURIComponent(slug(entityKey))}`, { method: "PUT", body: { value: clean } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Fields — ${editing.key}` : "New custom fields"} description="Extra field definitions for an entity type (client, supplier, dossier…)." size="xl">
      <div className="space-y-4">
        <Field label="Entity type" hint={editing ? "Locked after creation" : "e.g. client, supplier, operations_file"}>
          <Input value={entityKey} onChange={(e) => setEntityKey(e.target.value)} placeholder="client" disabled={!!editing} />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Fields</p>
            <Button size="sm" variant="ghost" onClick={() => setFields((f) => [...f, blankField()])}>
              + Field
            </Button>
          </div>
          {fields.map((f, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
              <Input value={f.field_key} onChange={(e) => setField(i, { field_key: e.target.value })} placeholder="field key" />
              <Input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Label" />
              <Select value={f.field_type} onChange={(e) => setField(i, { field_type: e.target.value })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
                req
              </label>
              <Button size="sm" variant="ghost" onClick={() => setFields((rs) => rs.filter((_, idx) => idx !== i))}>
                ✕
              </Button>
            </div>
          ))}
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save fields" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CustomFieldsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/settings/custom_field", nonce);
  const [editing, setEditing] = React.useState<Entry | null>(null);
  const [open, setOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const edit = (e: Entry | null) => {
    setEditing(e);
    setOpen(true);
  };
  async function del(key: string) {
    setRowBusy(key);
    setRowError(null);
    try {
      await tenant(`/settings/custom_field/${encodeURIComponent(key)}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-semibold tracking-tight">Custom fields</h1>
          <p className="mt-1 text-sm text-muted-foreground">Per-entity field definitions — extra fields a consuming module can render and store.</p>
        </div>
        <Button onClick={() => edit(null)}>New definition</Button>
      </header>

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No custom fields yet" hint="Define extra fields for an entity type." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Entity type</TH>
              <TH>Fields</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const key = String(r.key);
              const arr = Array.isArray(r.value) ? (r.value as unknown[]) : [];
              return (
                <TR key={key}>
                  <TD className="num text-sm font-medium">{key}</TD>
                  <TD className="text-sm text-muted-foreground">{arr.length} field{arr.length === 1 ? "" : "s"}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => edit({ key, value: r.value as Row })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" loading={rowBusy === key} onClick={() => del(key)}>
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

      <CustomFieldForm open={open} editing={editing} onClose={() => setOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════════ Email signature ═══════════════════════════════ */

export function EmailSignaturesPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/settings/email_signature", nonce);
  const [html, setHtml] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!rows) return;
    const tpl = rows.find((r) => String(r.key) === "template");
    const v = tpl ? entryValue(tpl) : {};
    setHtml(v.html ? String(v.html) : "");
  }, [rows]);

  async function save() {
    setBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      await tenant("/settings/email_signature/template", { method: "PUT", body: { value: { html } } });
      setSaved(true);
      reload();
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-4xl animate-fade-in">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Email signatures</h1>
        <p className="mt-1 text-sm text-muted-foreground">The tenant-wide brand signature template. Per-staff rendering is managed on each user's profile.</p>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : (
        <div className="lux-card space-y-4 p-4">
          <Field label="Signature template (HTML)" hint="Use tokens like {{user.full_name}}, {{user.email}}, {{tenant.name}}">
            <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={10} placeholder="<p>{{user.full_name}}<br/>{{tenant.name}}</p>" className={TEXTAREA} />
          </Field>
          {saveError && <ErrorState message={saveError} />}
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
            <Button onClick={save} loading={busy}>
              Save signature
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════ Business policies ═══════════════════════════════ */

function PolicyForm({ open, editing, onClose, onSaved }: { open: boolean; editing: Entry | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const v = editing?.value ?? {};
    setName(v.name ? String(v.name) : "");
    setKey(editing?.key ?? "");
    setBody(v.body_html ? String(v.body_html) : "");
    setError(null);
  }, [open, editing]);

  const canSubmit = !!name.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const k = editing?.key || slug(key || name);
    try {
      await tenant(`/settings/policy/${encodeURIComponent(k)}`, { method: "PUT", body: { value: { name: name.trim(), body_html: body } } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit policy" : "New policy"} description="A named policy document — privacy, refund, QMS, terms and the like." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Privacy policy" />
          </Field>
          <Field label="Key" hint={editing ? "Locked after creation" : "e.g. privacy, refund, terms"}>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="privacy" disabled={!!editing} />
          </Field>
        </div>
        <Field label="Body (HTML or text)">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="Your policy text…" className={TEXTAREA} />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save policy" : "Create policy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function BusinessPoliciesPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/settings/policy", nonce);
  const [editing, setEditing] = React.useState<Entry | null>(null);
  const [open, setOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const edit = (e: Entry | null) => {
    setEditing(e);
    setOpen(true);
  };
  async function del(key: string) {
    setRowBusy(key);
    setRowError(null);
    try {
      await tenant(`/settings/policy/${encodeURIComponent(key)}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-semibold tracking-tight">Business policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">Named policy documents — privacy, refund, QMS, terms and more.</p>
        </div>
        <Button onClick={() => edit(null)}>New policy</Button>
      </header>

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No policies yet" hint="Add a privacy, refund or terms policy." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Key</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const key = String(r.key);
              const v = entryValue(r);
              return (
                <TR key={key}>
                  <TD className="text-sm font-medium">{cell(v.name)}</TD>
                  <TD className="num text-sm">{key}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => edit({ key, value: v })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" loading={rowBusy === key} onClick={() => del(key)}>
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

      <PolicyForm open={open} editing={editing} onClose={() => setOpen(false)} onSaved={reload} />
    </section>
  );
}
