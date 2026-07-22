/**
 * CrudResource — the write-capable sibling of ResourceList. Fetches a tenant
 * endpoint, renders the table, and drives create/edit/delete from a declarative
 * field spec. One component backs the fleet / WMS / HR screens so each page is
 * just columns + fields.
 *
 * Body handling matches the BE zod validators:
 *   - empty optional fields are OMITTED (so `z.string().uuid().optional()`
 *     never sees "" and 422s);
 *   - `number` fields are coerced to Number;
 *   - `checkbox` fields to boolean;
 *   - `date` sends 'YYYY-MM-DD', `datetime` sends an ISO string.
 *
 * FK selects load their options from another endpoint (optionsEndpoint) and are
 * resilient — if that load fails the select is just empty, the page still works.
 */
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/data-list";
import { HubTabs } from "@/components/tabbed-hub";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type Column = { key: string; label: string; render?: (row: Record<string, unknown>) => React.ReactNode };

export type FieldType = "text" | "number" | "date" | "datetime" | "select" | "checkbox" | "textarea";

export type FieldSpec = {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** static <select> options */
  options?: { value: string; label: string }[];
  /** FK <select>: load rows from this endpoint and map to options */
  optionsEndpoint?: string;
  optionValue?: string;
  optionLabel?: string | ((row: Record<string, unknown>) => string);
  /** show this field on create only / edit only (default: both) */
  only?: "create" | "edit";
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Load + cache FK options for a single field. */
function useOptions(field: FieldSpec): { value: string; label: string }[] {
  const [opts, setOpts] = React.useState<{ value: string; label: string }[]>(field.options ?? []);
  React.useEffect(() => {
    if (!field.optionsEndpoint) return;
    let live = true;
    tenant<Record<string, unknown>[]>(field.optionsEndpoint)
      .then((rows) => {
        if (!live) return;
        const vKey = field.optionValue || "id";
        setOpts(
          (Array.isArray(rows) ? rows : []).map((r) => ({
            value: String(r[vKey] ?? ""),
            label:
              typeof field.optionLabel === "function"
                ? field.optionLabel(r)
                : String(r[(field.optionLabel as string) || vKey] ?? r[vKey] ?? ""),
          })),
        );
      })
      .catch(() => setOpts([]));
    return () => {
      live = false;
    };
  }, [field.optionsEndpoint, field.optionValue]); // eslint-disable-line react-hooks/exhaustive-deps
  return opts;
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const opts = useOptions(field);
  const t = field.type || "text";
  if (t === "select") {
    return (
      <Field label={field.label} hint={field.hint} required={field.required}>
        <Select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (t === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (t === "textarea") {
    return (
      <Field label={field.label} hint={field.hint} required={field.required}>
        <textarea
          className="min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }
  const inputType = t === "number" ? "number" : t === "date" ? "date" : t === "datetime" ? "datetime-local" : "text";
  return (
    <Field label={field.label} hint={field.hint} required={field.required}>
      <Input
        type={inputType}
        value={(value as string | number) ?? ""}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Build the request body from form state, matching the BE validators. */
function toBody(fields: FieldSpec[], form: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = form[f.name];
    if (f.type === "checkbox") {
      body[f.name] = !!raw;
      continue;
    }
    if (raw === undefined || raw === null || raw === "") continue; // omit empty optionals
    if (f.type === "number") {
      const n = Number(raw);
      if (!Number.isNaN(n)) body[f.name] = n;
    } else if (f.type === "datetime") {
      const d = new Date(raw as string);
      body[f.name] = Number.isNaN(d.getTime()) ? raw : d.toISOString();
    } else {
      body[f.name] = raw;
    }
  }
  return body;
}

export function CrudResource({
  title,
  description,
  eyebrow,
  endpoint,
  idKey,
  columns,
  fields,
  createLabel,
  canEdit = true,
  canDelete = true,
}: {
  title: string;
  description?: string;
  eyebrow?: React.ReactNode;
  endpoint: string;
  idKey: string;
  columns: Column[];
  fields: FieldSpec[];
  createLabel?: string;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Record<string, unknown>[]>(endpoint)
      .then((data) => live && setRows(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 403) setError("You don't have permission to view this.");
        else setError(err instanceof ApiError ? err.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [endpoint, nonce]);

  const open = creating || editing !== null;

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader
        title={title}
        description={description}
        eyebrow={eyebrow}
        action={
          <Button onClick={() => setCreating(true)}>{createLabel || `New ${title.replace(/s$/, "").toLowerCase()}`}</Button>
        }
      />
      <HubTabs />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="Create the first record with the button above." />
      ) : (
        <Table>
          <THead>
            <TR>
              {columns.map((c) => (
                <TH key={c.key}>{c.label}</TH>
              ))}
              {(canEdit || canDelete) && <TH>Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={String(r[idKey] ?? i)}>
                {columns.map((c) => (
                  <TD key={c.key} className="text-sm">
                    {c.render ? c.render(r) : fmt(r[c.key])}
                  </TD>
                ))}
                {(canEdit || canDelete) && (
                  <TD className="whitespace-nowrap text-sm">
                    {canEdit && (
                      <button className="lux-navlink mr-3" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="lux-navlink text-destructive"
                        onClick={async () => {
                          if (!confirm("Delete this record?")) return;
                          try {
                            await tenant(`${endpoint}/${r[idKey]}`, { method: "DELETE" });
                            reload();
                          } catch (e) {
                            alert(e instanceof ApiError ? e.message : "Delete failed.");
                          }
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {open && (
        <RecordForm
          title={editing ? `Edit ${title.replace(/s$/, "")}` : createLabel || `New ${title.replace(/s$/, "")}`}
          endpoint={endpoint}
          idKey={idKey}
          fields={fields}
          row={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function RecordForm({
  title,
  endpoint,
  idKey,
  fields,
  row,
  onClose,
  onSaved,
}: {
  title: string;
  endpoint: string;
  idKey: string;
  fields: FieldSpec[];
  row: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = row !== null;
  const shown = fields.filter((f) => !f.only || f.only === (isEdit ? "edit" : "create"));
  const [form, setForm] = React.useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of shown) init[f.name] = row ? (row[f.name] ?? "") : f.type === "checkbox" ? false : "";
    return init;
  });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const set = (name: string, v: unknown) => setForm((s) => ({ ...s, [name]: v }));

  const missing = shown.find((f) => f.required && !form[f.name] && f.type !== "checkbox");

  async function submit() {
    if (missing) {
      setErr(`${missing.label} is required.`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = toBody(shown, form);
      if (isEdit) await tenant(`${endpoint}/${row![idKey]}`, { method: "PATCH", body });
      else await tenant(endpoint, { method: "POST", body });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed.");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {shown.map((f) => (
          <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            <FieldControl field={f} value={form[f.name]} onChange={(v) => set(f.name, v)} />
          </div>
        ))}
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create"}
        </Button>
      </div>
    </Modal>
  );
}
