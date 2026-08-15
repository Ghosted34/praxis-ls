/**
 * Settings — document templates (the per-document-type header/footer blocks).
 *
 * Split out of `features/settings/store-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { errMsg, useList, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { PageError } from "./shared";
import { type Entry, entryValue } from "./store-shared";
import { slug } from "./store-shared";

const TEMPLATE_STATUS = ["draft", "published", "archived"];

function TemplateForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Entry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
        if (typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("not an object");
        value.css_vars = parsed;
      } catch {
        setBusy(false);
        setError(
          'CSS variables must be a valid JSON object, e.g. {"--brand": "#F5821F"}.',
        );
        return;
      }
    }
    const key = editing?.key || slug(docKey || name);
    try {
      await tenant(`/settings/document_template/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: { value },
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
      title={editing ? "Edit template" : "New document template"}
      description="A letterhead / document body the issuing module renders. Keyed by document type."
      size="xl"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Invoice — default"
            />
          </Field>
          <Field
            label="Document type key"
            hint={
              editing
                ? "Locked after creation"
                : "e.g. invoice, purchase_order, receipt"
            }
          >
            <Input
              value={docKey}
              onChange={(e) => setDocKey(e.target.value)}
              placeholder="invoice"
              disabled={!!editing}
            />
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
          <Textarea
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={8}
            placeholder="<h1>{{entity.legal_name}}</h1>…"
          />
        </Field>
        <Field
          label="CSS variables (JSON)"
          hint='Optional — overrides for this template, e.g. {"--brand": "#F5821F"}'
        >
          <Textarea
            value={cssVars}
            onChange={(e) => setCssVars(e.target.value)}
            rows={3}
            placeholder="{}"
          />
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
  const { rows, error, reload } = useList("/settings/document_template");
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
      await tenant(`/settings/document_template/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Document templates"
        description="Letterhead and body templates per document type — invoices, POs, receipts, contracts."
        action={<Button onClick={() => edit(null)}>New template</Button>}
      />

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No templates yet"
          hint="Create a template for a document type."
        />
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
                    <StatusPill status={String(v.status ?? "draft")} />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => edit({ key, value: v })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={rowBusy === key}
                        onClick={() => del(key)}
                      >
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

      <TemplateForm
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={reload}
      />
    </section>
  );
}

/* ═══════════════════════════════ Custom fields ═══════════════════════════════ */
