/**
 * Locations — location 360 (replaces the flat tree). Slots grouped by zone on the
 * left; pick one to see its rollup: stock stored there, handling equipment parked
 * there, cycle-count history, and capacity utilisation.
 */
import { pageShell } from "@/lib/layout";
import { SplitPane } from "@/components/ui/split-pane";
import { isDesktopNow } from "@/lib/use-media-query";
import { IndexRow } from "@/components/ui/index-row";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Link } from "react-router-dom";
import { useRecordParam, useTrailTitle } from "@/app/layout/nav-trail-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SectionTabs } from "@/components/ui/section-tabs";
import { PageHeader } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useListPaged, useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/wms-api";
import {
  KpiDetailsModal,
  KPI_PAGE_SIZE,
  type KpiDetailRow,
} from "@/components/kpi-details-modal";

const shell = pageShell.wide;
const STATE_TONE: Record<string, Tone> = {
  AVAILABLE: "ok",
  QA_HOLD: "warn",
  ALLOCATED: "blue",
  DISPATCHED: "mute",
  DAMAGED: "bad",
};
const EQ_TONE: Record<string, Tone> = {
  AVAILABLE: "ok",
  IN_USE: "blue",
  MAINTENANCE: "warn",
  OUT_OF_SERVICE: "bad",
};

const TABS = ["Inventory", "Equipment", "Cycle counts"] as const;
type Tab = (typeof TABS)[number];

function MiniTable({
  head,
  children,
  empty,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
}) {
  if (empty)
    return (
      <div className="px-3 py-6 text-center micro">
        {tr("Nothing here yet.")}
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);

function NewLocationForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    zone: "",
    aisle: "",
    rack: "",
    bin: "",
    yard: "",
    capacity_units: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createLocation({
        zone: f.zone || undefined,
        aisle: f.aisle || undefined,
        rack: f.rack || undefined,
        bin: f.bin || undefined,
        yard: f.yard || undefined,
        capacity_units:
          f.capacity_units === "" ? undefined : Number(f.capacity_units),
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
      title={tr("New location")}
      description="Add a slotting location — a zone/aisle/rack/bin, or a yard slot."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Zone")}>
            <Input
              value={f.zone}
              onChange={(e) => set("zone", e.target.value)}
              placeholder="A"
            />
          </Field>
          <Field label={tr("Aisle")}>
            <Input
              value={f.aisle}
              onChange={(e) => set("aisle", e.target.value)}
              placeholder="01"
            />
          </Field>
          <Field label={tr("Rack")}>
            <Input
              value={f.rack}
              onChange={(e) => set("rack", e.target.value)}
              placeholder="R1"
            />
          </Field>
          <Field label={tr("Bin")}>
            <Input
              value={f.bin}
              onChange={(e) => set("bin", e.target.value)}
              placeholder="B1"
            />
          </Field>
          <Field label={tr("Yard")} hint="For open-yard slots">
            <Input
              value={f.yard}
              onChange={(e) => set("yard", e.target.value)}
              placeholder="Y1"
            />
          </Field>
          <Field label="Capacity (units)">
            <Input
              type="number"
              className="num text-right"
              value={f.capacity_units}
              onChange={(e) => set("capacity_units", e.target.value)}
            />
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
          <Button type="submit" loading={busy}>
            Add location
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The rows behind a location's tiles, in the shared drill-in dialog.
 *
 * "Items stored" and "On hand" both open this slot's stock — the first newest
 * first as the Inventory tab lists it, the second largest quantity first, the
 * order that adds up the on-hand figure. "Equipment" opens the equipment parked
 * here. Each is read from its own module filtered to this slot (`location_id`),
 * a page at a time, so the dialog's total is the server's count over every row
 * at the slot — the same count the tile shows. "Capacity used" is a
 * percentage, not a list, and stays inert.
 */
type LocationDrill = "items" | "on_hand" | "equipment";

function LocationKpiDrill({
  kind,
  locationId,
  label,
  onClose,
}: {
  kind: LocationDrill;
  locationId: string;
  label: string;
  onClose: () => void;
}) {
  const [page, setPage] = React.useState(0);
  const isEquipment = kind === "equipment";
  const inventory = useListPaged<api.InventoryItem>(
    isEquipment ? null : api.INVENTORY_PATH,
    {
      page,
      pageSize: KPI_PAGE_SIZE,
      location_id: locationId,
      sort: kind === "on_hand" ? "-qty_on_hand" : "-created_at",
    },
  );
  const equipment = useListPaged<api.Equipment>(
    isEquipment ? api.EQUIPMENT_PATH : null,
    { page, pageSize: KPI_PAGE_SIZE, location_id: locationId },
  );
  const list = isEquipment ? equipment : inventory;
  const paging = {
    page,
    pageSize: KPI_PAGE_SIZE,
    total: list.total,
    onPageChange: setPage,
  };

  if (isEquipment) {
    return (
      <KpiDetailsModal
        open
        onClose={onClose}
        title={`${tr("Equipment")} · ${label}`}
        description="Handling equipment parked at this location. Click a row to find it on the equipment board."
        headers={[{ label: tr("Equipment") }, { label: tr("Status") }]}
        rows={(equipment.rows || []).map((e): KpiDetailRow => ({
          id: e.wms_equipment_id,
          href: `/wms/equipment?focus=${encodeURIComponent(e.wms_equipment_id)}`,
          cells: [
            e.label,
            <Pill key="s" tone={EQ_TONE[e.status] || "mute"}>
              {enumLabel(e.status)}
            </Pill>,
          ],
        }))}
        emptyLabel="No equipment is parked at this location."
        loading={equipment.loading}
        error={equipment.error}
        paging={paging}
        viewAll={{ label: "View more in Equipment", href: "/wms/equipment" }}
      />
    );
  }
  return (
    <KpiDetailsModal
      open
      onClose={onClose}
      title={`${kind === "on_hand" ? tr("On hand") : "Items stored"} · ${label}`}
      description={
        kind === "on_hand"
          ? "The stock that makes up the on-hand total, largest quantity first. Click a row to open the item."
          : "The stock items held at this location, newest first. Click a row to open the item."
      }
      headers={[
        { label: tr("SKU") },
        { label: tr("Item") },
        { label: tr("On hand"), right: true },
        { label: tr("State") },
      ]}
      rows={(inventory.rows || []).map((i): KpiDetailRow => ({
        id: i.inventory_item_id,
        href: `/wms/inventory?focus=${encodeURIComponent(i.inventory_item_id)}`,
        cells: [
          <span key="k" className="num">
            {i.sku || "—"}
          </span>,
          i.description,
          <span key="q" className="num whitespace-nowrap">
            {num(i.qty_on_hand)} {i.uom || ""}
          </span>,
          <Pill key="s" tone={STATE_TONE[i.state] || "mute"}>
            {i.state}
          </Pill>,
        ],
      }))}
      emptyLabel="Nothing is stored at this location."
      loading={inventory.loading}
      error={inventory.error}
      paging={paging}
      viewAll={{ label: "View more in Inventory", href: "/wms/inventory" }}
    />
  );
}

/** How many rows a tab lists before it says "and N more". A slot rarely holds
 *  more; when it does, the module's own list is where they are paged. */
const TAB_LIMIT = 200;

/** "Showing 200 of 1,234" under a tab that stopped at its limit. */
function MoreNote({
  shown,
  total,
  href,
  module,
}: {
  shown: number;
  total: number;
  href: string;
  module: string;
}) {
  if (total <= shown) return null;
  return (
    <p className="mt-2 micro">
      Showing {num(shown)} of {num(total)} —{" "}
      <Link to={href} className="text-primary-ink underline">
        open {module}
      </Link>{" "}
      for the rest.
    </p>
  );
}

/**
 * One slot's 360.
 *
 * EVERYTHING HERE IS THIS SLOT'S, READ AS THIS SLOT'S. The tiles come from the
 * location's own stats (`GET /locations/:id`, counted in SQL over every row at
 * the slot), and each tab asks its module for this slot only
 * (`?location_id=`). It used to be handed the tenant's first 50 stock lines,
 * equipment and counts and filter them here, so past 50 of anything a slot
 * showed too few — or none — and "Capacity used" was worked out from a partial
 * sum. Each list still goes through its own module, so a viewer without the
 * Inventory grant sees the count on the tile and a refusal on the tab, exactly
 * as before; the counts are the location's own facts (MOD-34), like occupancy.
 */
function LocationDetail({ location }: { location: api.WarehouseLocation }) {
  const [tab, setTab] = React.useState<Tab>("Inventory");
  const [drill, setDrill] = React.useState<LocationDrill | null>(null);
  const lid = location.location_id;
  const detail = useResource(() => api.getLocation(lid), [lid]);
  const stats = detail.data?.stats ?? null;
  // Only the tab on screen is read — the other two cost nothing until opened.
  const items = useListPaged<api.InventoryItem>(
    tab === "Inventory" ? api.INVENTORY_PATH : null,
    { pageSize: TAB_LIMIT, location_id: lid },
  );
  const equip = useListPaged<api.Equipment>(
    tab === "Equipment" ? api.EQUIPMENT_PATH : null,
    { pageSize: TAB_LIMIT, location_id: lid },
  );
  const cc = useListPaged<api.CycleCount>(
    tab === "Cycle counts" ? api.CYCLE_COUNTS_PATH : null,
    { pageSize: TAB_LIMIT, location_id: lid },
  );
  const cap =
    location.capacity_units != null ? Number(location.capacity_units) : null;
  const usedPct =
    stats && cap && cap > 0 ? Math.round((stats.on_hand / cap) * 100) : null;
  const tabCounts: Record<Tab, number | undefined> = {
    Inventory: stats?.items,
    Equipment: stats?.equipment,
    "Cycle counts": stats?.cycle_counts,
  };
  const figure = (n: number | undefined) =>
    n === undefined ? "—" : num(Math.round(n));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <h3 className="num text-lg font-semibold text-foreground">
          {api.locationLabel(location)}
        </h3>
        <p className="mt-1 micro">
          {location.zone
            ? `Zone ${location.zone}`
            : location.yard
              ? "Yard"
              : "Unzoned"}
          {cap != null ? ` · capacity ${num(cap)} units` : ""}
        </p>
      </div>

      {detail.error && <ErrorState message={detail.error} />}
      <KpiRow stack>
        <KpiTile
          label="Items stored"
          value={figure(stats?.items)}
          onClick={() => setDrill("items")}
        />
        <KpiTile
          label={tr("On hand")}
          value={figure(stats?.on_hand)}
          onClick={() => setDrill("on_hand")}
        />
        <KpiTile
          label={tr("Equipment")}
          value={figure(stats?.equipment)}
          onClick={() => setDrill("equipment")}
        />
        <KpiTile
          label={tr("Capacity used")}
          value={usedPct != null ? `${usedPct}%` : "—"}
        />
      </KpiRow>
      {drill && (
        <LocationKpiDrill
          kind={drill}
          locationId={lid}
          label={api.locationLabel(location)}
          onClose={() => setDrill(null)}
        />
      )}

      {/* One row on a phone — see `section-tabs.tsx`. */}
      <SectionTabs
        label="Location sections"
        value={tab}
        onChange={setTab}
        sticky
        className="mb-4"
        tabs={TABS.map((t) => ({ value: t, label: t, count: tabCounts[t] }))}
      />

      {tab === "Inventory" &&
        (items.error ? (
          <ErrorState message={items.error} />
        ) : items.loading ? (
          <LoadingRow label={tr("Loading…")} />
        ) : (
          <>
            <MiniTable
              empty={(items.rows || []).length === 0}
              head={
                <>
                  <Th>{tr("SKU")}</Th>
                  <Th>{tr("Item")}</Th>
                  <Th r>{tr("On hand")}</Th>
                  <Th>{tr("State")}</Th>
                </>
              }
            >
              {(items.rows || []).map((i) => (
                <tr key={i.inventory_item_id}>
                  <Td>{i.sku || "—"}</Td>
                  <Td>{i.description}</Td>
                  <Td r>
                    {num(i.qty_on_hand)} {i.uom || ""}
                  </Td>
                  <Td>
                    <Pill tone={STATE_TONE[i.state] || "mute"}>{i.state}</Pill>
                  </Td>
                </tr>
              ))}
            </MiniTable>
            <MoreNote
              shown={(items.rows || []).length}
              total={items.total}
              href="/wms/inventory"
              module="Inventory"
            />
          </>
        ))}
      {tab === "Equipment" &&
        (equip.error ? (
          <ErrorState message={equip.error} />
        ) : equip.loading ? (
          <LoadingRow label={tr("Loading…")} />
        ) : (
          <>
            <MiniTable
              empty={(equip.rows || []).length === 0}
              head={
                <>
                  <Th>{tr("Equipment")}</Th>
                  <Th>{tr("Status")}</Th>
                </>
              }
            >
              {(equip.rows || []).map((e) => (
                <tr key={e.wms_equipment_id}>
                  <Td>{e.label}</Td>
                  <Td>
                    <Pill tone={EQ_TONE[e.status] || "mute"}>
                      {enumLabel(e.status)}
                    </Pill>
                  </Td>
                </tr>
              ))}
            </MiniTable>
            <MoreNote
              shown={(equip.rows || []).length}
              total={equip.total}
              href="/wms/equipment"
              module="Equipment"
            />
          </>
        ))}
      {tab === "Cycle counts" &&
        (cc.error ? (
          <ErrorState message={cc.error} />
        ) : cc.loading ? (
          <LoadingRow label={tr("Loading…")} />
        ) : (
          <>
            <MiniTable
              empty={(cc.rows || []).length === 0}
              head={
                <>
                  <Th>Counted</Th>
                  <Th r>{tr("Lines")}</Th>
                  <Th>Result</Th>
                </>
              }
            >
              {(cc.rows || []).map((c) => (
                <tr key={c.cycle_count_id}>
                  <Td>{dateFmt(c.created_at)}</Td>
                  <Td r>{num(c.discrepancy_summary?.lines ?? 0)}</Td>
                  <td className="px-3 py-1.5">
                    {c.discrepancy_summary?.has_discrepancy ? (
                      <Pill tone="bad">
                        {c.discrepancy_summary.off_lines} off
                      </Pill>
                    ) : (
                      <Pill tone="ok">Match</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </MiniTable>
            <MoreNote
              shown={(cc.rows || []).length}
              total={cc.total}
              href="/wms/cycle-counts"
              module="Cycle counts"
            />
          </>
        ))}
    </div>
  );
}

export function LocationsPage() {
  const locs = useResource(() => api.listLocations(), []);
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const rows = React.useMemo(() => locs.data || [], [locs.data]);
  /*
   * WHICH RECORD IS OPEN LIVES IN THE URL (`?focus=<id>`), not in state, so
   * that picking one from this list is a step the back and forward arrows can
   * reach — see app/layout/nav-trail-context.tsx. It also makes every row
   * here linkable, which the 360 drill-ins elsewhere in the app already
   * assume they can do.
   */
  const {
    record: selected,
    id: selId,
    open: select,
    close,
    preselect,
  } = useRecordParam(rows, (l) => l.location_id);
  const filtered = q
    ? rows.filter((l) =>
        api.locationLabel(l).toLowerCase().includes(q.toLowerCase()),
      )
    : rows;
  // The list opens on its first row. `preselect` writes the same param with
  // `replace`: the user did not navigate here, so it must not become a step
  // the back arrow can land on. A desktop only — on a phone the slot opens as
  // a full-screen sheet over the list (SplitPane onClose), and opening one
  // unasked would cover the list on arrival.
  React.useEffect(() => {
    if (!selId && rows.length && isDesktopNow()) preselect(rows[0]);
  }, [rows, selId, preselect]);
  // Names this step for the arrow tooltips and the hold-menu.
  useTrailTitle(selected ? api.locationLabel(selected) : null);

  const groups = React.useMemo(() => {
    const m: Record<string, api.WarehouseLocation[]> = {};
    filtered.forEach((l) => {
      const k = l.zone || (l.yard ? "Yard" : "Unzoned");
      (m[k] || (m[k] = [])).push(l);
    });
    return Object.entries(m).sort(([a], [b]) =>
      a === "Yard" ? 1 : b === "Yard" ? -1 : a.localeCompare(b),
    );
  }, [filtered]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Warehouse" to="/wms" />}
        title="Locations"
        description="Warehouse slotting with a per-location 360 — stock, equipment, counts and capacity."
        action={
          <Button onClick={() => setCreating(true)}>
            {tr("New location")}
          </Button>
        }
      />
      <HubTabs />
      {locs.error ? (
        <ErrorState message={locs.error} />
      ) : (
        <SplitPane
          storageKey="wms.locations"
          label="Location list width"
          defaultSize={260}
          min={200}
          max={460}
          activeKind={tr("Location")}
          active={!!selected}
          onClose={close}
          sheetTitle={selected ? api.locationLabel(selected) : null}
          selectionInUrl
        >
          <div className="space-y-2">
            <Input
              placeholder="Search slot…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="space-y-2 rounded-lg border p-1 lg:max-h-[70vh] lg:overflow-auto">
              {locs.loading ? (
                <div className="px-3 py-4 micro">{tr("Loading…")}</div>
              ) : groups.length === 0 ? (
                <div className="px-3 py-4 micro">No locations.</div>
              ) : (
                groups.map(([zone, items]) => (
                  <div key={zone}>
                    <div className="px-2 py-1 micro">Zone {zone}</div>
                    {items.map((l) => (
                      <IndexRow
                        key={l.location_id}
                        selected={l.location_id === selId}
                        onClick={() => select(l)}
                        className="py-1.5"
                      >
                        <span className="num min-w-0 truncate font-medium">
                          {api.locationLabel(l)}
                        </span>
                      </IndexRow>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
          {selected ? (
            <LocationDetail location={selected} />
          ) : (
            <EmptyState
              title="No location selected"
              hint="Choose a slot from the list."
            />
          )}
        </SplitPane>
      )}
      {creating && (
        <NewLocationForm
          onClose={() => setCreating(false)}
          onSaved={locs.reload}
        />
      )}
      <ScreenAi path="wms/locations" />
    </section>
  );
}

export default LocationsPage;
