/**
 * Delivery notes — proof that goods reached the consignee, and who signed.
 *
 * The LIST. The form is `delivery-note-form.tsx`, the file-level progress panel
 * is `delivery-progress.tsx`, and the record's own 360 is
 * `delivery-note-360.tsx`; this file held all four until the detail view got a
 * route of its own, at which point the list needed the 360 and the 360 needed
 * the form, and one file importing another both ways is a cycle.
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
import { num, dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { DeliveryForm } from "./delivery-note-form";
import {
  DELIVERY_NOTES_PATH,
  DeliveryNote360Modal,
} from "./delivery-note-360";
import { deliveryTone, nameMap } from "./shared";

/* ── List ───────────────────────────────────────────────────────────────── */

export function DeliveryNotesPage() {
  const [status, setStatus] = React.useState("");
  const { rows, error, loading, reload } = useList<api.DeliveryNote>(
    `/delivery-notes${status ? `?status=${status}` : ""}`,
  );
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const { data: counts, reload: reloadCounts } = useResource(
    () => api.deliveryNoteSummary(),
    [],
  );
  const [open, setOpen] = React.useState(false);
  const dref = nameMap(dossiers, "dossier_id", "ref");

  /*
   * OPENING A NOTE IS TWO GESTURES — desktop navigates to the note's own page,
   * a phone opens the sheet over this list. The branch, the `?focus=` exchange
   * and the redirects live in lib/record-360.ts so the three operations 360s
   * cannot drift apart.
   */
  const { openRecord, sheetId, sheetRecord, closeSheet } = useRecordOpener(
    DELIVERY_NOTES_PATH,
    rows,
    (r) => r.delivery_note_id,
  );

  // What the back tooltip calls this step. The route can only say "Delivery
  // notes"; this screen is the one thing that knows the reference.
  useTrailTitle(
    sheetRecord ? `Delivery note ${sheetRecord.ref || "(draft)"}` : null,
  );

  const refresh = () => {
    reload();
    reloadCounts();
  };

  const columns: Column<api.DeliveryNote>[] = [
    {
      key: "ref",
      label: "Ref",
      // With `onRowClick` set, data-list wraps column 0 in a real button
      // (RowActivator) — same affordance as the transit-orders list. The cell
      // itself stays plain text so we never nest a button inside it.
      render: (r) => (
        <span className="num font-medium text-foreground">
          {/* A draft has no number yet, and saying so beats showing a uuid stub. */}
          {r.ref || <span className="text-muted italic">draft</span>}
        </span>
      ),
    },
    {
      key: "dossier_id",
      label: "File",
      render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—"),
    },
    { key: "consignee", label: "Consignee" },
    {
      key: "address",
      label: "Address",
      render: (r) => r.address || <span className="text-muted">—</span>,
    },
    {
      key: "delivery_date",
      label: "Delivery date",
      // Historic notes predate the column, so "—" means "not recorded" rather
      // than "not delivered" — 10694 deliberately did not backfill a date it
      // could not know.
      render: (r) => (r.delivery_date ? dateFmt(r.delivery_date) : "—"),
    },
    {
      key: "received_by_name",
      label: "Signed by",
      render: (r) =>
        r.received_by_name || <span className="text-muted">—</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={deliveryTone(r.status)}>{r.status}</Pill>,
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
            label={tr("View")}
          />
        </div>
      ),
    },
  ];

  return (
    <ListPage<api.DeliveryNote>
      eyebrow={<HubCrumb area="Operations" to="/operations" />}
      title={tr("Delivery notes")}
      description="Proof that goods reached the consignee — and who signed for them."
      action={<Button onClick={() => setOpen(true)}>New note</Button>}
      tabs={<HubTabs />}
      kpis={
        <KpiRow>
          {api.DELIVERY_STATUSES.map((s) => (
            <KpiTile
              key={s}
              label={s[0] + s.slice(1).toLowerCase()}
              value={num(counts?.[s] ?? 0)}
              tone={s === "DELIVERED" ? "ok" : s === "ISSUED" ? "warn" : undefined}
              // The tiles double as the status filter — clicking one narrows the
              // list, clicking it again clears it.
              onClick={() => setStatus(status === s ? "" : s)}
              ariaLabel={`${status === s ? "Clear" : "Show only"} ${s.toLowerCase()} delivery notes`}
            />
          ))}
        </KpiRow>
      }
      columns={columns}
      rows={rows}
      error={error}
      loading={loading}
      rowKey={(r) => r.delivery_note_id}
      // Click anywhere on a row opens the note — same gesture as the
      // transit-orders list, and the same desktop/phone branch.
      onRowClick={openRecord}
      empty={{
        title: "No delivery notes",
        hint: "Raise one when goods go out — it is the record of what the client accepted.",
        action: <Button onClick={() => setOpen(true)}>New note</Button>,
      }}
    >
      {open && <DeliveryForm onClose={() => setOpen(false)} onSaved={refresh} />}
      {/* Phone only — a desktop `?focus=` was exchanged for the route. */}
      {sheetId && (
        <DeliveryNote360Modal
          id={sheetId}
          refLabel={sheetRecord?.ref}
          fileLabel={
            sheetRecord?.dossier_id ? dref[sheetRecord.dossier_id] : null
          }
          onClose={closeSheet}
          onChanged={refresh}
        />
      )}
      <ScreenAi path="operations/delivery-notes" />
    </ListPage>
  );
}
