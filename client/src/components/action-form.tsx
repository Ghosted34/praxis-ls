/**
 * Interactive action form for the Praxis copilot.
 *
 * Renders a proposed create/post action as a typed form: enum + reference fields
 * become dropdowns (reference options fetched live from the field's list-read),
 * numbers/text/booleans become inputs, and array-of-object fields (line items,
 * narrative sections) render as repeatable rows. Whatever the model extracted
 * pre-fills the form; Confirm submits the edited payload, re-validated server-side.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { fetchActionOptions, type AiActionRun, type AiFieldMeta, type AiOption } from "@/lib/ai-api";

const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
const inputCls = "w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary";

type Options = Record<string, AiOption[]>;
type Loading = Record<string, boolean>;

/** Every list-read referenced anywhere in the meta tree (top-level + array rows). */
function collectRefs(meta: Record<string, AiFieldMeta>): string[] {
  const out: string[] = [];
  for (const m of Object.values(meta)) {
    if (m.ref) out.push(m.ref);
    if (m.item_fields) out.push(...collectRefs(m.item_fields));
  }
  return out;
}

/** Coerce a form value to its typed shape for submission. */
function coerce(m: AiFieldMeta, v: unknown): unknown {
  if (m.widget === "number") return Number(v);
  if (m.widget === "boolean") return v === "true" || v === true;
  return v;
}

/** One scalar field (select / ref-select / boolean / number / text). */
function Field({
  id,
  m,
  value,
  onChange,
  options,
  loading,
}: {
  id: string;
  m: AiFieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
  options: Options;
  loading: Loading;
}) {
  const str = value === undefined || value === null ? "" : String(value);
  const label = (
    <label htmlFor={id} className="micro mb-0.5 block text-foreground">
      {m.label}
      {m.required ? <span className="text-destructive"> *</span> : null}
    </label>
  );

  if (m.widget === "select" && m.options && m.options.length) {
    return (
      <div>
        {label}
        <select id={id} value={str} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">Select…</option>
          {m.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (m.widget === "select" && m.ref) {
    const opts = options[m.ref];
    if (loading[m.ref]) return <div>{label}<div className="micro px-1 py-1.5 text-muted-foreground">Loading options…</div></div>;
    if (opts && opts.length) {
      return (
        <div>
          {label}
          <select id={id} value={str} onChange={(e) => onChange(e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {opts.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
            ))}
          </select>
        </div>
      );
    }
    return <div>{label}<input id={id} value={str} onChange={(e) => onChange(e.target.value)} placeholder="No options found — enter a value" className={inputCls} /></div>;
  }

  if (m.widget === "boolean") {
    return (
      <div>
        {label}
        <select id={id} value={str} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>
    );
  }

  return (
    <div>
      {label}
      <input id={id} type={m.widget === "number" ? "number" : "text"} value={str} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

/** Repeatable rows for an array-of-objects field (line items, narratives). */
function ArrayField({
  fieldKey,
  m,
  rows,
  setRows,
  options,
  loading,
}: {
  fieldKey: string;
  m: AiFieldMeta;
  rows: Record<string, unknown>[];
  setRows: (rows: Record<string, unknown>[]) => void;
  options: Options;
  loading: Loading;
}) {
  const itemFields = m.item_fields || {};
  const keys = Object.keys(itemFields);
  const singular = m.label.replace(/s$/, "");
  const setCell = (i: number, f: string, v: unknown) => setRows(rows.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)));

  return (
    <div>
      <div className="micro mb-0.5 text-foreground">{m.label}</div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-border p-2">
            {keys.map((f) => (
              <Field
                key={f}
                id={`${fieldKey}-${i}-${f}`}
                m={itemFields[f]}
                value={row[f]}
                onChange={(v) => setCell(i, f, v)}
                options={options}
                loading={loading}
              />
            ))}
            <button type="button" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="micro text-bad hover:underline">
              Remove
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows([...rows, {}])} className="mt-1.5 micro text-primary-ink hover:underline">
        + Add {singular.toLowerCase()}
      </button>
    </div>
  );
}

export function ActionForm({
  action,
  busy,
  onConfirm,
}: {
  action: AiActionRun;
  busy?: boolean;
  onConfirm: (payload: Record<string, unknown>) => void;
}) {
  // Keyed on the RUN, not on `meta`: `action.field_meta || {}` minted a new
  // object every render, so every hook downstream of it re-ran every render. The
  // field set is fixed for the lifetime of a run, which is what the original
  // `[action.action_run_id]` dep was expressing — it just had nothing stable to
  // express it against.
  const meta = React.useMemo(() => action.field_meta || {}, [action.field_meta]);
  const fields = React.useMemo(() => Object.keys(meta), [meta]);
  const [values, setValues] = React.useState<Record<string, unknown>>(() => ({ ...(action.payload || {}) }));
  const [options, setOptions] = React.useState<Options>({});
  const [loading, setLoading] = React.useState<Loading>({});

  React.useEffect(() => {
    const refs = Array.from(new Set(collectRefs(meta)));
    for (const ref of refs) {
      setLoading((s) => ({ ...s, [ref]: true }));
      fetchActionOptions(ref)
        .then((opts) => setOptions((s) => ({ ...s, [ref]: opts })))
        .catch(() => setOptions((s) => ({ ...s, [ref]: [] })))
        .finally(() => setLoading((s) => ({ ...s, [ref]: false })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.action_run_id]);

  const setVal = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  // Required check only covers scalar fields (arrays/booleans are optional here).
  const missing = fields.filter((f) => meta[f].required && meta[f].widget !== "array" && isEmpty(values[f]));

  function submit() {
    const payload: Record<string, unknown> = { ...(action.payload || {}) };
    for (const f of fields) {
      const m = meta[f];
      if (m.widget === "array") {
        const rows = Array.isArray(values[f]) ? (values[f] as Record<string, unknown>[]) : [];
        const itemFields = m.item_fields || {};
        const clean = rows
          .map((row) => {
            const o: Record<string, unknown> = {};
            for (const k of Object.keys(itemFields)) if (!isEmpty(row[k])) o[k] = coerce(itemFields[k], row[k]);
            return o;
          })
          .filter((o) => Object.keys(o).length > 0);
        if (clean.length) payload[f] = clean;
        else delete payload[f];
        continue;
      }
      const v = values[f];
      if (isEmpty(v)) {
        delete payload[f];
        continue;
      }
      payload[f] = coerce(m, v);
    }
    onConfirm(payload);
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <div className="micro text-muted-foreground">{action.action_key.replace(/_/g, " ")}</div>
      {fields.map((f) => {
        const m = meta[f];
        if (m.widget === "array") {
          const rows = Array.isArray(values[f]) ? (values[f] as Record<string, unknown>[]) : [];
          return <ArrayField key={f} fieldKey={`${action.action_run_id}-${f}`} m={m} rows={rows} setRows={(r) => setVal(f, r)} options={options} loading={loading} />;
        }
        return <Field key={f} id={`${action.action_run_id}-${f}`} m={m} value={values[f]} onChange={(v) => setVal(f, v)} options={options} loading={loading} />;
      })}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="micro text-muted-foreground">{missing.length ? `${missing.length} required field${missing.length > 1 ? "s" : ""} left` : "Ready"}</span>
        <Button size="sm" loading={busy} disabled={missing.length > 0} onClick={submit}>Confirm</Button>
      </div>
    </div>
  );
}
