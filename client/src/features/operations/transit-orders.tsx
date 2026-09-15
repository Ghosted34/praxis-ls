/**
 * Transit orders — the client's written authorisation to declare their cargo.
 *
 * The LIST. The form is `transit-order-form.tsx` and the record's own 360 is
 * `transit-order-360.tsx`; this file held all three until the detail view got a
 * route of its own, at which point the list needed the 360 and the 360 needed
 * the form, and one file importing another both ways is a cycle.
 *
 * ── WHAT THIS SCREEN REPLACED ───────────────────────────────────────────────
 * The legacy screen (`view/operations/transit-order.php`, 1031 lines) had no
 * lifecycle at all: Print was the end of the story, and nothing recorded
 * whether the client ever signed. The status tiles are the spine of this screen
 * for that reason, and they are counted in the database — they used to filter
 * the loaded page in JavaScript, which reads "3 import" on a tenant with four
 * hundred orders.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { ListPage } from "@/components/list-page";
import type { Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useRecordOpener } from "@/lib/record-360";
import { useTrailTitle } from "@/app/layout/nav-trail-context";
import { useList, useResource } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { TransitForm } from "./transit-order-form";
import {
  TRANSIT_ORDERS_PATH,
  TransitOrder360Modal,
} from "./transit-order-360";
import { nameMap, transitTone } from "./shared";

/* ── The list ──────────────────────────────────────────────────────────────── */

export function TransitOrdersPage() {
  const [status, setStatus] = React.useState<string>("");
  const { rows, error, loading, reload } = useList<api.TransitOrder>(
    `/transit-orders${status ? `?status=${status}` : ""}`,
  );
  // Counted in the database. The tiles used to filter the loaded page in
  // JavaScript, which reads "3 import" on a tenant with four hundred orders.
  const { data: counts, reload: reloadCounts } = useResource(
    () => api.transitOrderSummary(),
    [],
  );
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [creating, setCreating] = React.useState(false);
  const dref = nameMap(dossiers, "dossier_id", "ref");

  /*
   * OPENING AN ORDER IS TWO GESTURES — desktop navigates to the order's own
   * page, a phone opens the sheet over this list. The branch, the `?focus=`
   * exchange and the redirects live in components/record-360.tsx so the three
   * operations 360s cannot drift apart.
   */
  const {
    openRecord,
    sheetId,
    sheetRecord,
    closeSheet,
  } = useRecordOpener(TRANSIT_ORDERS_PATH, rows, (r) => r.transit_order_id);

  // What the back tooltip calls this step. The route can only say "Transit
  // orders"; this screen is the one thing that knows the OT number.
  useTrailTitle(
    sheetRecord ? `Transit order ${sheetRecord.ref || "(draft)"}` : null,
  );

  const refresh = () => {
    reload();
    void reloadCounts();
  };

  const columns: Column<api.TransitOrder>[] = [
    {
      key: "ref",
      label: "OT number",
      render: (r) =>
        r.ref ? (
          <span className="num font-medium text-foreground">{r.ref}</span>
        ) : (
          // A draft genuinely has no number — saying so beats printing eight
          // characters of a UUID that looks like one.
          <span className="text-muted-foreground">Not yet numbered</span>
        ),
    },
    {
      key: "dossier_id",
      label: "File",
      render: (r) => r.dossier_ref || (r.dossier_id ? dref[r.dossier_id] : null) || "—",
    },
    { key: "client_name", label: "Client", render: (r) => r.client_name || "—" },
    {
      key: "customs_regime",
      label: "Regime",
      render: (r) =>
        r.customs_regime || r.customs_regime_other ? (
          <Pill tone="mute">{r.customs_regime || r.customs_regime_other}</Pill>
        ) : (
          "—"
        ),
    },
    { key: "service_direction", label: "Direction" },
    {
      key: "declared_value",
      label: "Declared value",
      className: "num text-right",
      render: (r) =>
        r.declared_value == null
          ? "—"
          : `${money(r.declared_value)} ${r.declared_currency || ""}`,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={transitTone(r.status)}>{r.status}</Pill>,
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
            label={tr("View")}
          />
        </div>
      ),
    },
  ];

  return (
    <ListPage<api.TransitOrder>
      eyebrow={<HubCrumb area="Operations" to="/operations" />}
      title={tr("Transit orders")}
      description="The client's written authorisation to declare their cargo."
      action={<Button onClick={() => setCreating(true)}>New order</Button>}
      tabs={<HubTabs />}
      kpis={
        <KpiRow>
          {/*
           * The lifecycle, as tiles that filter. "Awaiting signature" is the
           * number anyone running this desk actually chases — the legacy screen
           * could not have shown it, because it did not record signatures.
           */}
          <KpiTile
            label="All orders"
            value={num(counts?.TOTAL ?? 0)}
            onClick={() => setStatus("")}
          />
          <KpiTile
            label={tr("Drafts")}
            value={num(counts?.DRAFT ?? 0)}
            onClick={() => setStatus("DRAFT")}
          />
          <KpiTile
            label="Awaiting signature"
            value={num(counts?.ISSUED ?? 0)}
            onClick={() => setStatus("ISSUED")}
          />
          <KpiTile
            label="Ready to lodge"
            value={num(counts?.SIGNED ?? 0)}
            onClick={() => setStatus("SIGNED")}
          />
          <KpiTile
            label="Lodged"
            value={num(counts?.LODGED ?? 0)}
            onClick={() => setStatus("LODGED")}
          />
        </KpiRow>
      }
      columns={columns}
      rows={rows}
      error={error}
      loading={loading}
      rowKey={(r) => r.transit_order_id}
      onRowClick={openRecord}
      empty={{
        title: status ? `No ${status.toLowerCase()} orders` : "No transit orders",
        hint: "Raise a transit order against a file to authorise a customs declaration.",
        action: <Button onClick={() => setCreating(true)}>New order</Button>,
      }}
    >
      {creating && (
        <TransitForm
          row={null}
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      )}
      {/* Phone only — a desktop `?focus=` was exchanged for the route. */}
      {sheetId && (
        <TransitOrder360Modal
          id={sheetId}
          refLabel={sheetRecord?.ref}
          fileLabel={
            sheetRecord?.dossier_ref ||
            (sheetRecord?.dossier_id ? dref[sheetRecord.dossier_id] : null)
          }
          onClose={closeSheet}
          onChanged={refresh}
        />
      )}
      <ScreenAi path="operations/transit-orders" />
    </ListPage>
  );
}
