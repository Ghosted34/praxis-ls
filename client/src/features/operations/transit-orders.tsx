/**
 * Transit orders — customs transit declarations tied to a dossier.
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
import { money, num } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
import { nameMap, tone } from "./shared";

const CUSTOMS = ["IM4", "IM7", "IM8", "EX1", "EX2"];

type CargoLine = {
  inventory_item_id: string;
  label: string;
  packages: string;
  weight: string;
};
const blankCargo = (): CargoLine => ({
  inventory_item_id: "",
  label: "",
  packages: "1",
  weight: "",
});

function TransitForm({
  row,
  onClose,
  onSaved,
}: {
  row: api.TransitOrder | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [f, setF] = React.useState({
    entity_id: row?.entity_id ?? "",
    dossier_id: row?.dossier_id ?? "",
    customs_regime: row?.customs_regime ?? "",
    service_direction: row?.service_direction ?? "",
    declared_value:
      row?.declared_value != null ? String(row.declared_value) : "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [lines, setLines] = React.useState<CargoLine[]>([blankCargo()]);
  const setLine = (i: number, patch: Partial<CargoLine>) =>
    setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const cargo = lines
      .filter((l) => l.inventory_item_id)
      .map((l) => ({
        inventory_item_id: l.inventory_item_id,
        label: l.label,
        packages: Number(l.packages) || 1,
        weight: l.weight || undefined,
      }));
    const body: api.TransitOrderInput = {
      entity_id: f.entity_id,
      dossier_id: f.dossier_id || undefined,
      customs_regime: f.customs_regime || undefined,
      service_direction: f.service_direction || undefined,
      declared_value:
        f.declared_value === "" ? undefined : Number(f.declared_value),
      ...(isNew && cargo.length ? { lines: cargo } : {}),
    };
    try {
      if (isNew) await api.createTransitOrder(body);
      else await api.updateTransitOrder(row!.transit_order_id, body);
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
      title={isNew ? "New transit order" : "Edit transit order"}
      description="Customs transit declaration tied to a dossier."
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
          <Field label="Customs regime">
            <Select
              value={f.customs_regime}
              onChange={(e) => set("customs_regime", e.target.value)}
            >
              <option value="">—</option>
              {CUSTOMS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Direction">
            <Select
              value={f.service_direction}
              onChange={(e) => set("service_direction", e.target.value)}
            >
              <option value="">—</option>
              <option value="IMPORT">Import</option>
              <option value="EXPORT">Export</option>
            </Select>
          </Field>
          <Field label="Declared value" className="sm:col-span-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={f.declared_value}
              onChange={(e) => set("declared_value", e.target.value)}
            />
          </Field>
        </div>

        {isNew && (
          <div className="space-y-2">
            <div className="micro">Cargo</div>
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_80px_90px_auto] items-center gap-2"
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
                  value={l.packages}
                  onChange={(e) => setLine(i, { packages: e.target.value })}
                  aria-label={`Packages, cargo line ${i + 1}`}
                  placeholder="Pkgs"
                />
                <Input
                  value={l.weight}
                  onChange={(e) => setLine(i, { weight: e.target.value })}
                  aria-label={`Weight, cargo line ${i + 1}`}
                  placeholder="Weight"
                />
                {/* Was a literal "✕" — a text glyph rather than an icon, and with
                    no accessible name at all (F14, F13). */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove cargo line ${i + 1}`}
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
              onClick={() => setLines((s) => [...s, blankCargo()])}
            >
              Add cargo
            </Button>
          </div>
        )}

        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!f.entity_id || busy}
          onCancel={onClose}
          saveLabel={isNew ? "Create order" : "Save changes"}
        />
      </form>
    </Dialog>
  );
}

export function TransitOrdersPage() {
  const { rows, error, loading, reload } =
    useList<api.TransitOrder>("/transit-orders");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [editing, setEditing] = React.useState<api.TransitOrder | "new" | null>(
    null,
  );
  const dref = nameMap(dossiers, "dossier_id", "ref");
  const list = rows || [];

  const columns: Column<api.TransitOrder>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.ref || r.transit_order_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "dossier_id",
      label: "Dossier",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
    },
    {
      key: "customs_regime",
      label: "Regime",
      render: (r) =>
        r.customs_regime ? <Pill tone="mute">{r.customs_regime}</Pill> : "—",
    },
    { key: "service_direction", label: "Direction" },
    {
      key: "declared_value",
      label: "Declared value",
      className: "num text-right",
      render: (r) => money(r.declared_value),
    },
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
            docType="TRANSIT_ORDER"
            id={r.transit_order_id}
            title={r.ref || `Transit order ${r.transit_order_id.slice(0, 8)}`}
            label="View"
          />
        </div>
      ),
    },
  ];

  return (
    <ListPage<api.TransitOrder>
      eyebrow={<HubCrumb area="Operations" to="/operations" />}
      title="Transit orders"
      description="Customs transit declarations."
      action={<Button onClick={() => setEditing("new")}>New order</Button>}
      tabs={<HubTabs />}
      kpis={
        <KpiRow>
          <KpiTile label="Orders" value={num(list.length)} />
          <KpiTile
            label="Import"
            value={num(
              list.filter((t) => t.service_direction === "IMPORT").length,
            )}
          />
          <KpiTile
            label="Export"
            value={num(
              list.filter((t) => t.service_direction === "EXPORT").length,
            )}
          />
        </KpiRow>
      }
      columns={columns}
      rows={rows}
      error={error}
      loading={loading}
      rowKey={(r) => r.transit_order_id}
      onRowClick={(r) => setEditing(r)}
      empty={{
        title: "No transit orders",
        hint: "Raise a transit declaration against a dossier to clear cargo through customs.",
        action: <Button onClick={() => setEditing("new")}>New order</Button>,
      }}
    >
      {editing !== null && (
        <TransitForm
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      <ScreenAi path="operations/transit-orders" />
    </ListPage>
  );
}
