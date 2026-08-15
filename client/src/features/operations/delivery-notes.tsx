/**
 * Delivery notes — proof-of-delivery for a consignee.
 *
 * Split out of `features/operations/pages.tsx` in Phase 3 (audit F7).
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { DocButton } from "@/components/doc-button";
import { InventoryItemSelect } from "@/components/catalogue-select";
import { ListPage } from "@/components/list-page";
import type { Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { XIcon } from "@/components/ui/icons";
import { useList, errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
import { nameMap, tone } from "./shared";

type GoodsLine = { inventory_item_id: string; label: string; qty: string };
const blankGoods = (): GoodsLine => ({
  inventory_item_id: "",
  label: "",
  qty: "1",
});

function DeliveryForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [f, setF] = React.useState({
    entity_id: "",
    dossier_id: "",
    consignee: "",
    city_zone: "",
    contact_person: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [lines, setLines] = React.useState<GoodsLine[]>([blankGoods()]);
  const setLine = (i: number, patch: Partial<GoodsLine>) =>
    setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const goods = lines
        .filter((l) => l.inventory_item_id)
        .map((l) => ({
          inventory_item_id: l.inventory_item_id,
          label: l.label,
          qty: Number(l.qty) || 1,
        }));
      await api.createDeliveryNote({
        entity_id: f.entity_id,
        dossier_id: f.dossier_id || undefined,
        consignee: f.consignee || undefined,
        city_zone: f.city_zone || undefined,
        contact_person: f.contact_person || undefined,
        lines: goods.length ? goods : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="New delivery note"
      description="Proof-of-delivery for a consignee."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select
              value={f.entity_id}
              onChange={(e) => set("entity_id", e.target.value)}
            >
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dossier">
            <Select
              value={f.dossier_id}
              onChange={(e) => set("dossier_id", e.target.value)}
            >
              <option value="">—</option>
              {(dossiers || []).map((d) => (
                <option key={d.dossier_id} value={d.dossier_id}>
                  {d.ref}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Consignee" className="sm:col-span-2">
            <Input
              value={f.consignee}
              onChange={(e) => set("consignee", e.target.value)}
            />
          </Field>
          <Field label="City / zone">
            <Input
              value={f.city_zone}
              onChange={(e) => set("city_zone", e.target.value)}
            />
          </Field>
          <Field label="Contact person">
            <Input
              value={f.contact_person}
              onChange={(e) => set("contact_person", e.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="micro">Goods delivered</div>
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_80px_auto] items-center gap-2"
            >
              <InventoryItemSelect
                value={l.inventory_item_id}
                onPick={(id, label) =>
                  setLine(i, { inventory_item_id: id, label })
                }
              />
              <Input
                type="number"
                min="0"
                step="any"
                className="num text-right"
                value={l.qty}
                onChange={(e) => setLine(i, { qty: e.target.value })}
                aria-label={`Quantity, line ${i + 1}`}
                placeholder="Qty"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${i + 1}`}
                onClick={() =>
                  setLines((s) =>
                    s.length > 1 ? s.filter((_, idx) => idx !== i) : s,
                  )
                }
              >
                <XIcon width={16} height={16} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((s) => [...s, blankGoods()])}
          >
            Add item
          </Button>
        </div>

        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!f.entity_id || busy}
          onCancel={onClose}
          saveLabel="Create note"
        />
      </form>
    </Dialog>
  );
}

export function DeliveryNotesPage() {
  const { rows, error, loading, reload } =
    useList<api.DeliveryNote>("/delivery-notes");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [open, setOpen] = React.useState(false);
  const dref = nameMap(dossiers, "dossier_id", "ref");

  const columns: Column<api.DeliveryNote>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.ref || r.delivery_note_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "dossier_id",
      label: "Dossier",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
    },
    { key: "consignee", label: "Consignee" },
    { key: "city_zone", label: "City / zone" },
    { key: "contact_person", label: "Contact" },
    {
      key: "status",
      label: "Status",
      render: (r) =>
        r.status ? <Pill tone={tone(r.status)}>{r.status}</Pill> : "—",
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <DocButton
            docType="DELIVERY_NOTE"
            id={r.delivery_note_id}
            title={r.ref || `Delivery note ${r.delivery_note_id.slice(0, 8)}`}
            label="View"
          />
        </div>
      ),
    },
  ];

  return (
    <ListPage<api.DeliveryNote>
      eyebrow={<HubCrumb area="Operations" to="/operations" />}
      title="Delivery notes"
      description="Proof-of-delivery documents."
      action={<Button onClick={() => setOpen(true)}>New note</Button>}
      tabs={<HubTabs />}
      kpis={
        <KpiRow>
          <KpiTile label="Notes" value={num((rows || []).length)} />
        </KpiRow>
      }
      columns={columns}
      rows={rows}
      error={error}
      loading={loading}
      rowKey={(r) => r.delivery_note_id}
      empty={{
        title: "No delivery notes",
        hint: "Issue a delivery note when goods reach the consignee — it is the proof the file was closed out.",
        action: <Button onClick={() => setOpen(true)}>New note</Button>,
      }}
    >
      {open && <DeliveryForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="operations/delivery-notes" />
    </ListPage>
  );
}
