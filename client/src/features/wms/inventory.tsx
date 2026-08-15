/**
 * Inventory — stock ledger (replaces the CRUD table). On-hand by item with its
 * state, plus the real actions: Move (receive / issue / adjust / transfer),
 * state transitions (QA hold, damaged…), and the append-only movement journal.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import * as api from "@/lib/wms-api";

const shell = pageShell.wide;
const STATE_TONE: Record<string, Tone> = {
  AVAILABLE: "ok",
  QA_HOLD: "warn",
  ALLOCATED: "blue",
  DISPATCHED: "mute",
  DAMAGED: "bad",
};
const TRANSITIONS: Record<string, string[]> = {
  AVAILABLE: ["QA_HOLD", "ALLOCATED", "DAMAGED"],
  QA_HOLD: ["AVAILABLE", "DAMAGED"],
  ALLOCATED: ["AVAILABLE", "DISPATCHED"],
  DISPATCHED: [],
  DAMAGED: ["AVAILABLE"],
};
const MOVE_TYPES = [
  { key: "receive", label: "Receive (+)", kind: "INBOUND" },
  { key: "issue", label: "Issue (−)", kind: "ADJUST" },
  { key: "adjust", label: "Adjust (±)", kind: "ADJUST" },
  { key: "transfer", label: "Transfer", kind: "PUTAWAY" },
] as const;

function ItemDetail({
  item: initial,
  locMap,
  locations,
  onClose,
  onChanged,
}: {
  item: api.InventoryItem;
  locMap: Record<string, string>;
  locations: api.WarehouseLocation[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [item, setItem] = React.useState(initial);
  const moves = useResource(
    () => api.getMovements(item.inventory_item_id),
    [item.inventory_item_id],
  );
  const [type, setType] =
    React.useState<(typeof MOVE_TYPES)[number]["key"]>("receive");
  const [qty, setQty] = React.useState("");
  const [toLoc, setToLoc] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const isTransfer = type === "transfer";

  async function applyMove(e: React.FormEvent) {
    e.preventDefault();
    setBusy("move");
    setError(null);
    try {
      const def = MOVE_TYPES.find((m) => m.key === type)!;
      let q = 0;
      if (type === "receive") q = Math.abs(Number(qty));
      else if (type === "issue") q = -Math.abs(Number(qty));
      else if (type === "adjust") q = Number(qty);
      const row = await api.moveStock(item.inventory_item_id, {
        movement_kind: def.kind,
        qty: q,
        to_location: isTransfer ? toLoc || undefined : undefined,
      });
      setItem(row);
      setQty("");
      setToLoc("");
      moves.reload();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }
  async function toState(s: string) {
    setBusy(s);
    setError(null);
    try {
      const row = await api.setStockState(item.inventory_item_id, s);
      setItem(row);
      moves.reload();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  const mvCols: Column<api.StockMovement>[] = [
    {
      key: "when",
      label: "When",
      render: (m) => <span className="num">{dateFmt(m.moved_at)}</span>,
    },
    {
      key: "kind",
      label: "Kind",
      render: (m) => <Pill tone="mute">{m.movement_kind}</Pill>,
    },
    {
      key: "qty",
      label: "Qty",
      className: "num text-right",
      render: (m) => (
        <span className={Number(m.qty) < 0 ? "text-[rgb(var(--bad))]" : ""}>
          {num(m.qty)}
        </span>
      ),
    },
    {
      key: "loc",
      label: "From → To",
      render: (m) => (
        <span className="text-muted-foreground">
          {m.from_location ? locMap[m.from_location] || "—" : "—"} →{" "}
          {m.to_location ? locMap[m.to_location] || "—" : "—"}
        </span>
      ),
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={item.sku ? `${item.sku} · ${item.description}` : item.description}
      description={`On hand ${num(item.qty_on_hand)} ${item.uom || "unit"} · ${locMap[item.location_id || ""] || "no location"}`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Pill tone={STATE_TONE[item.state] || "mute"}>{item.state}</Pill>
          <div className="flex flex-wrap gap-2">
            {(TRANSITIONS[item.state] || []).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                loading={busy === s}
                onClick={() => toState(s)}
              >
                → {s.replace("_", " ")}
              </Button>
            ))}
          </div>
        </div>

        <form
          onSubmit={applyMove}
          className="rounded-lg border bg-muted/30 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Movement">
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                {MOVE_TYPES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            {isTransfer ? (
              <Field label="To location">
                <Select
                  value={toLoc}
                  onChange={(e) => setToLoc(e.target.value)}
                >
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.location_id} value={l.location_id}>
                      {api.locationLabel(l)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Quantity">
                <Input
                  type="number"
                  className="num text-right"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={type === "adjust" ? "± qty" : "qty"}
                />
              </Field>
            )}
            <Button
              type="submit"
              loading={busy === "move"}
              disabled={isTransfer ? !toLoc : qty === ""}
            >
              Apply
            </Button>
          </div>
        </form>

        {error && <ErrorState message={error} />}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            Movement history
          </h3>
          <DataList
            columns={mvCols}
            rows={moves.data}
            error={moves.error}
            loading={moves.loading}
            rowKey={(m) => m.stock_movement_id}
            empty={{
              title: "No movements",
              hint: "Receive or adjust stock to log a movement.",
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

function NewItemForm({
  locations,
  onClose,
  onSaved,
}: {
  locations: api.WarehouseLocation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    description: "",
    sku: "",
    qty_on_hand: "",
    uom: "",
    location_id: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createInventory({
        description: f.description,
        sku: f.sku || undefined,
        qty_on_hand: f.qty_on_hand === "" ? undefined : Number(f.qty_on_hand),
        uom: f.uom || undefined,
        location_id: f.location_id || undefined,
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
      title="New stock item"
      description="Add an item to inventory. On-hand can start at zero and be received via a movement."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Description" required>
          <Input
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Palettes malt (client)"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU">
            <Input
              value={f.sku}
              onChange={(e) => set("sku", e.target.value)}
              placeholder="CLI-BRAS-001"
            />
          </Field>
          <Field label="Unit of measure">
            <Input
              value={f.uom}
              onChange={(e) => set("uom", e.target.value)}
              placeholder="pallet / bag"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Opening qty">
            <Input
              type="number"
              className="num text-right"
              value={f.qty_on_hand}
              onChange={(e) => set("qty_on_hand", e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Location">
            <Select
              value={f.location_id}
              onChange={(e) => set("location_id", e.target.value)}
            >
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.location_id} value={l.location_id}>
                  {api.locationLabel(l)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
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
            disabled={!f.description || busy}
          >
            Add item
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InventoryPage() {
  const items = useResource(() => api.listInventory(), []);
  const locs = useResource(() => api.listLocations(), []);
  const [view, setView] = React.useState<api.InventoryItem | null>(null);
  const [creating, setCreating] = React.useState(false);
  const locMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    (locs.data || []).forEach((l) => {
      m[l.location_id] = api.locationLabel(l);
    });
    return m;
  }, [locs.data]);

  const cols: Column<api.InventoryItem>[] = [
    {
      key: "sku",
      label: "SKU",
      render: (i) => (
        <span className="num text-muted-foreground">{i.sku || "—"}</span>
      ),
    },
    {
      key: "desc",
      label: "Item",
      render: (i) => (
        <span className="font-medium text-foreground">{i.description}</span>
      ),
    },
    {
      key: "loc",
      label: "Location",
      render: (i) => (
        <span className="text-muted-foreground">
          {locMap[i.location_id || ""] || "—"}
        </span>
      ),
    },
    {
      key: "qty",
      label: "On hand",
      className: "num text-right",
      render: (i) => `${num(i.qty_on_hand)} ${i.uom || ""}`,
    },
    {
      key: "state",
      label: "State",
      render: (i) => (
        <Pill tone={STATE_TONE[i.state] || "mute"}>{i.state}</Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (i) => (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setView(i)}>
            Manage
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Warehouse" to="/wms" />}
        title="Inventory"
        description="Stock on hand by item and state — receive, issue, adjust, transfer, and the movement journal."
        action={<Button onClick={() => setCreating(true)}>New item</Button>}
      />
      <HubTabs />
      <DataList
        columns={cols}
        rows={items.data}
        error={items.error}
        loading={items.loading}
        rowKey={(i) => i.inventory_item_id}
        empty={{ title: "No stock", hint: "Add a stock item to get started." }}
      />
      {view && (
        <ItemDetail
          item={view}
          locMap={locMap}
          locations={locs.data || []}
          onClose={() => setView(null)}
          onChanged={items.reload}
        />
      )}
      {creating && (
        <NewItemForm
          locations={locs.data || []}
          onClose={() => setCreating(false)}
          onSaved={items.reload}
        />
      )}
      <ScreenAi path="wms/inventory" />
    </section>
  );
}

export default InventoryPage;
