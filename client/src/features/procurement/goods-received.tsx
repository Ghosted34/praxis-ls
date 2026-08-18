/**
 * Procurement — goods-received notes: what actually arrived.
 *
 * Split out of `features/procurement/pages.tsx` in Phase 4 (audit F7).
 * 10720: a GRN now records the RECEIVED LINES (ordered / received / condition)
 * against the PO's items, so a partial delivery is a document, not a checkbox,
 * and the three-way match can compare quantities. Each row opens its native
 * GOODS_RECEIVED document page.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { num, dateFmt, todayISO } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/procurement-api";
import { map, shell } from "./shared";

type GrnLineDraft = {
  dictionary_item_id?: string | null;
  label: string;
  ordered: number;
  received: string;
  condition: string;
};

function GrnForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: pos } = useList<api.PurchaseOrder>("/purchase-orders");
  const { rows: entities } = useList<Entity>("/entities");
  const [f, setF] = React.useState({
    po_id: "",
    entity_id: "",
    supplier_invoice_ref: "",
    date: todayISO(),
    note: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  // When a PO is picked, its items pre-fill the receipt lines (ordered = PO qty)
  // so the person at the gate only adjusts what actually arrived; the entity
  // defaults to the PO's own so the GRN always gets its document number.
  const { data: po } = useResource<
    (api.PurchaseOrder & { items?: api.PoItem[] }) | null
  >(
    () => (f.po_id ? api.getPurchaseOrder(f.po_id) : Promise.resolve(null)),
    [f.po_id],
  );
  React.useEffect(() => {
    if (po?.entity_id && !f.entity_id) set("entity_id", po.entity_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po?.entity_id]);
  const [lines, setLines] = React.useState<GrnLineDraft[]>([]);
  React.useEffect(() => {
    if (po && po.items?.length) {
      setLines(
        po.items.map((it) => ({
          dictionary_item_id: it.dictionary_item_id,
          label: it.label || "Item",
          ordered: Number(it.qty) || 0,
          received: String(Number(it.qty) || 0),
          condition: "",
        })),
      );
    } else if (f.po_id) {
      setLines([{ label: "", ordered: 0, received: "", condition: "" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po?.po_id]);
  const setLine = (i: number, p: Partial<GrnLineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const valid = lines.filter((l) => l.label || l.dictionary_item_id);
      await api.createGrn({
        po_id: f.po_id,
        entity_id: f.entity_id || undefined,
        supplier_invoice_ref: f.supplier_invoice_ref || undefined,
        date: f.date || undefined,
        note: f.note || undefined,
        lines: valid.map((l) => ({
          dictionary_item_id: l.dictionary_item_id || undefined,
          label: l.label,
          ordered: l.ordered,
          received: l.received === "" ? undefined : Number(l.received),
          condition: l.condition || undefined,
        })),
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
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Record goods received"
      description="Confirm receipt against a purchase order — per line."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Purchase order")} required>
            <Select
              value={f.po_id}
              onChange={(e) => set("po_id", e.target.value)}
            >
              <option value="">—</option>
              {(pos || []).map((p) => (
                <option key={p.po_id} value={p.po_id}>
                  {p.ref || p.po_id.slice(0, 8)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Entity")}>
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
          <Field label="Supplier invoice ref">
            <Input
              value={f.supplier_invoice_ref}
              onChange={(e) => set("supplier_invoice_ref", e.target.value)}
            />
          </Field>
          <Field label={tr("Date")}>
            <Input
              type="date"
              value={f.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
        </div>
        {f.po_id && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="micro">Received lines</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setLines((l) => [
                    ...l,
                    { label: "", ordered: 0, received: "", condition: "" },
                  ])
                }
              >
                + Add line
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_90px_90px_120px_auto] items-end gap-2"
                >
                  <Field label={tr("Item")}>
                    <Input
                      value={l.label ?? ""}
                      onChange={(e) => setLine(i, { label: e.target.value })}
                      placeholder="Item description"
                    />
                  </Field>
                  <Field label={tr("Ordered")}>
                    <Input
                      type="number"
                      className="num text-right"
                      value={String(l.ordered ?? "")}
                      onChange={(e) =>
                        setLine(i, { ordered: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label={tr("Received")}>
                    <Input
                      type="number"
                      className="num text-right"
                      value={String(l.received ?? "")}
                      onChange={(e) =>
                        setLine(i, { received: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={tr("Condition")}>
                    <Input
                      value={l.condition ?? ""}
                      onChange={(e) =>
                        setLine(i, { condition: e.target.value })
                      }
                      placeholder="Good / damaged…"
                    />
                  </Field>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((ls) => ls.filter((_, j) => j !== i))
                    }
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label={tr("Note")}>
          <Textarea
            value={f.note}
            onChange={(e) => set("note", e.target.value)}
            rows={2}
            placeholder="Partial delivery? Shortage? Damage?"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!f.po_id || busy}
          onCancel={onClose}
          saveLabel="Record GRN"
        />
      </form>
    </Modal>
  );
}

export function GoodsReceivedPage() {
  const { rows, error, loading, reload } = useList<api.Grn>("/goods-received");
  const { rows: pos } = useList<api.PurchaseOrder>("/purchase-orders");
  const [open, setOpen] = React.useState(false);
  const poref = map(pos, "po_id", "ref");
  const columns: Column<api.Grn>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.ref || r.grn_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "po_id",
      label: "Purchase order",
      render: (r) => (r.po_id ? poref[r.po_id] || r.po_id.slice(0, 8) : "—"),
    },
    { key: "supplier_invoice_ref", label: "Supplier inv. ref" },
    {
      key: "lines",
      label: "Lines",
      render: (r) =>
        (r as api.Grn & { line_count?: number }).line_count !== undefined
          ? num((r as api.Grn & { line_count?: number }).line_count)
          : "—",
    },
    {
      key: "created_at",
      label: "Received",
      render: (r) => dateFmt(r.received_on || r.created_at),
    },
    {
      key: "wms_inbound_id",
      label: "Warehouse",
      render: (r) =>
        r.wms_inbound_id ? (
          <Pill tone="ok">Sent</Pill>
        ) : (
          <Pill tone="mute">Pending</Pill>
        ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <DocButton
            docType="GOODS_RECEIVED"
            id={r.grn_id}
            title={r.ref || `GRN ${r.grn_id.slice(0, 8)}`}
            label={tr("View")}
          />
          {!r.wms_inbound_id && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api.sendGrnToWarehouse(r.grn_id);
                  reload();
                } catch (e) {
                  reportActionError(e);
                }
              }}
            >
              Send to warehouse
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Procurement" to="/procurement" />}
        title="Goods received"
        description="Receipt notes (GRN) against purchase orders."
        action={<Button onClick={() => setOpen(true)}>New GRN</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Receipts" value={num((rows || []).length)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.grn_id}
        empty={{
          title: "No goods received",
          hint: "Record receipt when a PO is delivered.",
        }}
      />
      {open && <GrnForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="procurement/goods-received" />
    </section>
  );
}
