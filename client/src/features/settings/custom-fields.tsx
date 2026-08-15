/**
 * Settings — tenant-defined custom fields.
 *
 * Split out of `features/settings/store-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
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
import { PageError } from "./shared";
import { type Entry } from "./store-shared";
import { slug } from "./store-shared";

const FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
];
type FieldDef = {
  field_key: string;
  label: string;
  field_type: string;
  required: boolean;
};

function blankField(): FieldDef {
  return { field_key: "", label: "", field_type: "text", required: false };
}

function CustomFieldForm({
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
  const [entityKey, setEntityKey] = React.useState("");
  const [fields, setFields] = React.useState<FieldDef[]>([blankField()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityKey(editing?.key ?? "");
    const arr = Array.isArray(editing?.value)
      ? (editing?.value as unknown as Row[])
      : [];
    setFields(
      arr.length
        ? arr.map((d) => ({
            field_key: String(d.field_key ?? ""),
            label: String(d.label ?? ""),
            field_type: FIELD_TYPES.includes(String(d.field_type))
              ? String(d.field_type)
              : "text",
            required: d.required === true,
          }))
        : [blankField()],
    );
    setError(null);
  }, [open, editing]);

  function setField(i: number, patch: Partial<FieldDef>) {
    setFields((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const canSubmit =
    !!entityKey.trim() && fields.some((f) => f.field_key.trim()) && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const clean = fields
      .filter((f) => f.field_key.trim())
      .map((f) => ({
        field_key: slug(f.field_key),
        label: f.label.trim() || f.field_key.trim(),
        field_type: f.field_type,
        required: f.required,
      }));
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
      await tenant(
        `/settings/custom_field/${encodeURIComponent(slug(entityKey))}`,
        { method: "PUT", body: { value: clean } },
      );
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
      title={editing ? `Fields — ${editing.key}` : "New custom fields"}
      description="Extra field definitions for an entity type (client, supplier, dossier…)."
      size="xl"
    >
      <div className="space-y-4">
        <Field
          label="Entity type"
          hint={
            editing
              ? "Locked after creation"
              : "e.g. client, supplier, operations_file"
          }
        >
          <Input
            value={entityKey}
            onChange={(e) => setEntityKey(e.target.value)}
            placeholder="client"
            disabled={!!editing}
          />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Fields</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFields((f) => [...f, blankField()])}
            >
              + Field
            </Button>
          </div>
          {fields.map((f, i) => (
            <div
              key={i}
              className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
            >
              <Input
                value={f.field_key}
                onChange={(e) => setField(i, { field_key: e.target.value })}
                placeholder="field key"
              />
              <Input
                value={f.label}
                onChange={(e) => setField(i, { label: e.target.value })}
                placeholder="Label"
              />
              <Select
                aria-label={`Field type, row ${i + 1}`}
                value={f.field_type}
                onChange={(e) => setField(i, { field_type: e.target.value })}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => setField(i, { required: e.target.checked })}
                />
                req
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setFields((rs) => rs.filter((_, idx) => idx !== i))
                }
              >
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
  const { rows, error, reload } = useList("/settings/custom_field");
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
      await tenant(`/settings/custom_field/${encodeURIComponent(key)}`, {
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
        title="Custom fields"
        description="Per-entity field definitions — extra fields a consuming module can render and store."
        action={<Button onClick={() => edit(null)}>New definition</Button>}
      />

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No custom fields yet"
          hint="Define extra fields for an entity type."
        />
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
                  <TD className="text-sm text-muted-foreground">
                    {arr.length} field{arr.length === 1 ? "" : "s"}
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => edit({ key, value: r.value as Row })}
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

      <CustomFieldForm
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={reload}
      />
    </section>
  );
}

/* ═══════════════════════════════ Email signature ═══════════════════════════════ */
