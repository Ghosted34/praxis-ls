/**
 * Security — per-role field visibility (visible / masked / hidden).
 *
 * Split out of `features/security/pages.tsx` in Phase 4 (audit F7). This is the
 * control that hides margin, salary and cost-rate from roles that should not
 * see them, so it is a genuine confidentiality surface, not a display setting.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { RowActions } from "@/components/ui/row-actions";
import { type FieldVis, type Role, ConfirmDelete, shell } from "./shared";

const VISIBILITY = ["visible", "masked", "hidden"] as const;
const visTone = (v: string): Tone =>
  v === "visible" ? "ok" : v === "masked" ? "warn" : "bad";

/** Field keys the backend masks today — offered as suggestions, free text allowed. */
const KNOWN_FIELDS = [
  "dossier.margin",
  "employee.salary",
  "supplier.cost_rate",
  "invoice.cost_price",
  "quotation.margin",
];

function FieldVisForm({
  fv,
  roles,
  onClose,
  onSaved,
}: {
  fv: FieldVis | null;
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!fv;
  const [roleId, setRoleId] = React.useState(fv?.role_id || "");
  const [fieldKey, setFieldKey] = React.useState(fv?.field_key || "");
  const [visibility, setVisibility] = React.useState(
    fv?.visibility || "masked",
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { role_id: roleId || null, field_key: fieldKey, visibility };
    try {
      if (editing && fv)
        await tenant(`/field-visibility/${fv.field_visibility_id}`, {
          method: "PATCH",
          body,
        });
      else await tenant("/field-visibility", { method: "POST", body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit field rule" : "New field rule"}
      description="Masks a confidential field for one role. Enforced server-side on read, so it holds even under the TEST toggle."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Role" required>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">— select a role —</option>
            {roles.map((r) => (
              <option key={r.role_id} value={r.role_id}>
                {r.code} · {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Field key"
          required
          hint="Dotted path, e.g. dossier.margin. Must match the key the backend masks on."
        >
          <Input
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
            list="known-field-keys"
            placeholder="dossier.margin"
          />
          <datalist id="known-field-keys">
            {KNOWN_FIELDS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        <Field
          label="Visibility"
          required
          hint="Masked shows a placeholder; hidden removes the key entirely."
        >
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            {VISIBILITY.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={busy || !roleId || !fieldKey}
          >
            {editing ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function FieldVisibilityPage() {
  const { rows, error, loading, reload } =
    useList<FieldVis>("/field-visibility");
  const rolesQ = useList<Role>("/roles");
  const [form, setForm] = React.useState<{ fv: FieldVis | null } | null>(null);
  const [del, setDel] = React.useState<FieldVis | null>(null);

  const roleLabel = React.useMemo(() => {
    const m: Record<string, string> = {};
    (rolesQ.rows || []).forEach((r) => {
      m[r.role_id] = r.code;
    });
    return m;
  }, [rolesQ.rows]);

  const columns: Column<FieldVis>[] = [
    {
      key: "role_id",
      label: "Role",
      render: (r) =>
        r.role_id ? (
          <Pill tone="mute">{roleLabel[r.role_id] || "—"}</Pill>
        ) : (
          <span className="text-muted-foreground">All roles</span>
        ),
    },
    {
      key: "field_key",
      label: "Field",
      render: (r) => (
        <span className="num font-medium text-foreground">{r.field_key}</span>
      ),
    },
    {
      key: "visibility",
      label: "Visibility",
      render: (r) => <Pill tone={visTone(r.visibility)}>{r.visibility}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm({ fv: r })}
          >
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDel(r)}>
            Delete
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title="Field visibility"
        description="Per-role masking of confidential fields — margins, salaries, cost rates. Editing these needs the approve action, not just edit."
        action={<Button onClick={() => setForm({ fv: null })}>New rule</Button>}
      />
      <HubTabs />
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.field_visibility_id}
        onRowClick={(r) => setForm({ fv: r })}
        empty={{
          title: "No masking rules",
          hint: "Without a rule every field is visible to anyone who can read the record.",
        }}
      />
      {form && (
        <FieldVisForm
          fv={form.fv}
          roles={rolesQ.rows || []}
          onClose={() => setForm(null)}
          onSaved={reload}
        />
      )}
      {del && (
        <ConfirmDelete
          title="Delete field rule"
          what={`${del.field_key} · ${del.visibility}`}
          path={`/field-visibility/${del.field_visibility_id}`}
          onClose={() => setDel(null)}
          onDone={reload}
        />
      )}
    </section>
  );
}

/* ══════════════════════════════ Sessions ═════════════════════════════════ */
