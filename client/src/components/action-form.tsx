/**
 * Interactive action form for the Praxis copilot.
 *
 * When the assistant proposes a create/post action, this renders its fields as a
 * typed form instead of a bare Confirm button: enum + reference fields become
 * dropdowns (reference options fetched live from the field's list-read), numbers
 * and free text become inputs. Whatever the model already extracted pre-fills the
 * form; Confirm submits the edited payload, which the server re-validates before
 * executing. Required fields gate the button.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { fetchActionOptions, type AiActionRun, type AiOption } from "@/lib/ai-api";

const isEmpty = (v: unknown) => v === undefined || v === null || v === "";

export function ActionForm({
  action,
  busy,
  onConfirm,
}: {
  action: AiActionRun;
  busy?: boolean;
  onConfirm: (payload: Record<string, unknown>) => void;
}) {
  const meta = action.field_meta || {};
  const fields = React.useMemo(() => Object.keys(meta), [action.action_run_id]);
  const [values, setValues] = React.useState<Record<string, unknown>>(() => ({ ...(action.payload || {}) }));
  const [optionsByRef, setOptionsByRef] = React.useState<Record<string, AiOption[]>>({});
  const [loadingRefs, setLoadingRefs] = React.useState<Record<string, boolean>>({});

  // Fetch options for each distinct reference field, once per proposed action.
  React.useEffect(() => {
    const refs = Array.from(new Set(fields.map((f) => meta[f].ref).filter(Boolean))) as string[];
    for (const ref of refs) {
      setLoadingRefs((s) => ({ ...s, [ref]: true }));
      fetchActionOptions(ref)
        .then((opts) => setOptionsByRef((s) => ({ ...s, [ref]: opts })))
        .catch(() => setOptionsByRef((s) => ({ ...s, [ref]: [] })))
        .finally(() => setLoadingRefs((s) => ({ ...s, [ref]: false })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.action_run_id]);

  const setVal = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  const missing = fields.filter((f) => meta[f].required && isEmpty(values[f]));

  function submit() {
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f];
      if (isEmpty(v)) continue;
      payload[f] = meta[f].widget === "number" ? Number(v) : v;
    }
    onConfirm(payload);
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <div className="micro text-muted-foreground">{action.action_key.replace(/_/g, " ")}</div>
      {fields.map((f) => {
        const m = meta[f];
        const val = values[f];
        const id = `${action.action_run_id}-${f}`;
        const refOptions = m.ref ? optionsByRef[m.ref] : undefined;
        const label = (
          <label htmlFor={id} className="micro mb-0.5 block text-foreground">
            {m.label}
            {m.required ? <span className="text-red-500"> *</span> : null}
          </label>
        );

        // Enum select (inline options)
        if (m.widget === "select" && m.options && m.options.length) {
          return (
            <div key={f}>
              {label}
              <select
                id={id}
                value={val === undefined || val === null ? "" : String(val)}
                onChange={(e) => setVal(f, e.target.value)}
                className="w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary"
              >
                <option value="">Select…</option>
                {m.options.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                ))}
              </select>
            </div>
          );
        }

        // Reference select (options fetched from a list-read). Falls back to a
        // text input if the read returned nothing (so the field is never a dead end).
        if (m.widget === "select" && m.ref) {
          if (loadingRefs[m.ref]) {
            return <div key={f}>{label}<div className="micro px-1 py-1.5 text-muted-foreground">Loading options…</div></div>;
          }
          if (refOptions && refOptions.length) {
            return (
              <div key={f}>
                {label}
                <select
                  id={id}
                  value={val === undefined || val === null ? "" : String(val)}
                  onChange={(e) => setVal(f, e.target.value)}
                  className="w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">Select…</option>
                  {refOptions.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div key={f}>
              {label}
              <input
                id={id}
                value={val === undefined || val === null ? "" : String(val)}
                onChange={(e) => setVal(f, e.target.value)}
                placeholder="No options found — enter a value"
                className="w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
          );
        }

        // Number / text input
        return (
          <div key={f}>
            {label}
            <input
              id={id}
              type={m.widget === "number" ? "number" : "text"}
              value={val === undefined || val === null ? "" : String(val)}
              onChange={(e) => setVal(f, e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="micro text-muted-foreground">{missing.length ? `${missing.length} required field${missing.length > 1 ? "s" : ""} left` : "Ready"}</span>
        <Button size="sm" loading={busy} disabled={missing.length > 0} onClick={submit}>Confirm</Button>
      </div>
    </div>
  );
}
