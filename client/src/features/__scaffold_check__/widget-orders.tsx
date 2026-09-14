/**
 * Widget orders — TODO: one sentence on what this screen is FOR, not what it contains.
 *
 * Scaffolded by scripts/new-screen.mjs. The structure below is the eight-item
 * per-screen checklist in doc/PHASE4_CHECKLIST.md §2; the TODOs are the parts
 * only you can fill in.
 */
import * as React from "react";
import { ListPage } from "@/components/list-page";
import { type Column } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RowActions } from "@/components/ui/row-actions";
import { FormButtons } from "@/components/ui/form-buttons";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { HubCrumb } from "@/components/tabbed-hub";
import { useList, errMsg } from "@/lib/use-resource";
import { useDebounced } from "@/lib/use-debounced";
import { dateFmt, enumLabel } from "@/lib/format";

/** TODO: replace with the real row type, from the API types — not from memory. */
type Row = {
  widget_orders_id: string;
  reference: string;
  status: string;
  created_at: string;
};

export function WidgetOrdersPage() {
  const { rows, error, loading, reload } = useList<Row>("/widget-orders");
  const [q, setQ] = React.useState("");
  const search = useDebounced(q, 250);
  const [creating, setCreating] = React.useState(false);

  // Derivation lives in the screen, which is why ListPage takes a result rather
  // than a path — half the list screens in this app filter, join or merge.
  const shown = React.useMemo(() => {
    const all = rows ?? [];
    if (!search.trim()) return all;
    const needle = search.trim().toLowerCase();
    return all.filter((r) => r.reference.toLowerCase().includes(needle));
  }, [rows, search]);

  // Checklist 5 + 6: semantic tokens only, primitives instead of raw elements.
  // <Pill> for status, never a hand-written coloured span — check:palette fails
  // the build on a raw Tailwind colour.
  const columns: Column<Row>[] = [
    { key: "reference", label: "Reference", render: (r) => <span className="font-medium text-foreground">{r.reference}</span> },
    { key: "status", label: "Status", render: (r) => <Pill tone="mute">{enumLabel(r.status)}</Pill> },
    { key: "created_at", label: "Created", render: (r) => dateFmt(r.created_at) },
    {
      // The trailing actions cell. `label: ""` is the convention; DataList gives
      // it a screen-reader name so it is not an empty <th>.
      key: "_a",
      label: "",
      render: () => (
        <RowActions>
          <Button size="sm" variant="ghost" onClick={() => { /* TODO */ }}>Edit</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <ListPage<Row>
      title="Widget orders"
      // Write this as what the screen is FOR. "Every party you invoice" beats
      // "List of clients".
      description="TODO: what this screen is for."
      eyebrow={<HubCrumb area="__scaffold_check__" to="/__scaffold_check__" />}
      // Checklist 1: a deliberate width. wide = dense data, reading = forms.
      width="wide"
      action={<Button onClick={() => setCreating(true)}>New widget order</Button>}
      toolbar={
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search widget orders…"
          aria-label="Search widget orders"
          className="max-w-xs"
        />
      }
      columns={columns}
      rows={shown}
      // Checklist 3: all four states. loading and error are routed to the right
      // primitive by ListPage; the two empties are yours.
      error={error}
      loading={loading}
      rowKey={(r) => r.widget_orders_id}
      empty={{
        title: "No widget orders yet",
        hint: "TODO: say what creating the first one gets them.",
        action: <Button onClick={() => setCreating(true)}>New widget order</Button>,
      }}
      // A brand-new list and a filtered-to-nothing list are different situations
      // and want different actions. Offering "New widget order" to someone who
      // mistyped a search is the single most common thing screens get wrong.
      filtered={!!search}
      emptyFiltered={{
        title: "No widget orders match",
        hint: "Try a different search term.",
        action: <Button variant="outline" onClick={() => setQ("")}>Clear search</Button>,
      }}
    >
      {creating && <WidgetOrdersForm onClose={() => setCreating(false)} onSaved={reload} />}
    </ListPage>
  );
}

/**
 * The create form.
 *
 * Checklist 4: build this on `useZodForm` + a schema in `packages/shared`, so
 * field-level errors come from the SAME definition the API validates with. The
 * audit found 565 `<Field>` sites of which 4 received an error, and validation
 * re-implemented as ad-hoc booleans in every screen (F4, F12). `Field` already
 * wires `aria-invalid` / `aria-describedby` from the `error` prop — it just
 * needs something to pass it.
 *
 * @example  // once the schema exists
 * const form = useZodForm(schemas.widget_orders.create);
 * <Field label="Reference" required error={form.formState.errors.reference?.message}>
 *   <Input {...form.register("reference")} />
 * </Field>
 */
function WidgetOrdersForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [reference, setReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // TODO: call the typed API wrapper, e.g. api.createWidgetOrders({ reference }).
      await Promise.resolve(reference);
      onSaved();
      onClose();
    } catch (err) {
      // errMsg, never a bare String(err): it turns a 403 into the permission
      // sentence and a 422 into the field list.
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New widget order" description="TODO: what saving this does.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Reference" required>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="REF-2026-0001" />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy || !reference.trim()} onCancel={onClose} saveLabel="Create widget order" />
      </form>
    </Modal>
  );
}

export default WidgetOrdersPage;
