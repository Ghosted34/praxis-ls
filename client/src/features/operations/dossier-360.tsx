/**
 * Dossier 360° — the per-file rollup, in Milestones / Money / People / Documents.
 *
 * Split out of `features/operations/pages.tsx` in Phase 3 (audit F7): this modal
 * and its five private sub-blocks were 250 of that file's 928 lines, behind no
 * export, so nothing here was reachable or testable from anywhere else.
 *
 * Margin figures arrive nulled for roles masked on `dossier.margin` (server-side
 * field mask, PRD §7.3/§11.3), so the Money tab shows a "restricted" note rather
 * than a number in that case. Do not "fix" a blank margin here — it is a grant.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Stat } from "@/components/ui/stat";
import { Segmented } from "@/components/ui/segmented";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Pill } from "@/components/ui/pill";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { MilestoneChain } from "./milestone-chain";
import { QTickets } from "./q-tickets";
import { humanizeKey, serviceLabel, tone } from "./shared";
import { DocGroup, DocRow, MoneyRow, PersonRow } from "./components";
// The shared shipment/service details (0660) — the same component every
// document, costing and quotation renders, so what ops sees on the file and
// what a client sees on an invoice are one projection, not two.
import { ShipmentDetailsPanel } from "./shipment-details";
import { ContainerEditor } from "./container-editor";
import { ItineraryEditor } from "./itinerary-editor";

type Tab360 =
  | "details"
  | "itinerary"
  | "milestones"
  | "queries"
  | "money"
  | "people"
  | "documents";
const TABS_360: { value: Tab360; label: string }[] = [
  // First: what is actually moving is the question every other tab is about.
  { value: "details", label: "Details" },
  { value: "itinerary", label: "Itinerary" },
  { value: "milestones", label: "Milestones" },
  { value: "queries", label: "Queries" },
  { value: "money", label: "Money" },
  { value: "people", label: "People" },
  { value: "documents", label: "Documents" },
];

/**
 * The shipment/service details of this file, plus the one control that edits
 * its equipment.
 *
 * The panel itself is service-type-agnostic (see shipment-details.tsx) — a sea
 * file shows a Bill of Lading and a route, a warehousing file shows a warehouse
 * and a bonded status, and neither renders a placeholder for the other's
 * vocabulary. The container button appears only when the service type captures
 * equipment at all.
 */
function DetailsTab({ dossierId }: { dossierId: string }) {
  const [editing, setEditing] = React.useState(false);
  const details = useResource(
    () => api.getShipmentDetails(dossierId),
    [dossierId],
  );
  const block = details.data?.containers;

  return (
    <>
      <ShipmentDetailsPanel
        data={details.data}
        action={
          block?.enabled ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              {block.lines.length ? "Edit containers" : "Add containers"}
            </Button>
          ) : null
        }
      />
      {editing && block && (
        <ContainerEditor
          dossierId={dossierId}
          mode={block.mode}
          onClose={() => setEditing(false)}
          onSaved={() => details.reload()}
        />
      )}
    </>
  );
}

/** Lifecycle readiness banner (consumes the dossier.milestones_completed /
 *  dossier.fully_collected orchestration signals, surfaced via overview.readiness).
 *  Prompts to complete the file once its milestones are done. */
function ReadinessBanner({
  readiness,
  status,
  dossierId,
  onChanged,
}: {
  readiness: NonNullable<api.DossierOverview["readiness"]>;
  status: string;
  dossierId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const done = status === "COMPLETED";

  async function complete() {
    setBusy(true);
    setErr(null);
    try {
      await api.transitionDossier(dossierId, "COMPLETED");
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok)/0.08)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
          {readiness.milestones_complete && (
            <Pill tone="ok">Milestones complete</Pill>
          )}
          {readiness.fully_collected && <Pill tone="ok">Fully collected</Pill>}
          <span className="text-muted-foreground">
            {done
              ? "This file is complete."
              : readiness.ready_to_complete
                ? "Ready to complete."
                : "In progress."}
          </span>
        </div>
        {readiness.ready_to_complete && !done && (
          <Button size="sm" onClick={complete} loading={busy}>
            Mark complete
          </Button>
        )}
      </div>
      {err && (
        <div className="mt-2">
          <ErrorState message={err} />
        </div>
      )}
    </div>
  );
}

function MilestonesTab({ dossierId }: { dossierId: string }) {
  // The chain, its dates and its actions now live in one component shared with
  // the Milestones screen — two renderings of the same thing had already
  // drifted once (the standalone screen advanced, this one only listed).
  return <MilestoneChain dossierId={dossierId} />;
}

function MoneyTab({ m }: { m: api.DossierOverview["money"] | undefined }) {
  if (!m) return <span className="micro">No money data on this file yet.</span>;
  const marginMasked = m.dossier_margin == null;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-1.5">
        <div className="micro mb-2">Billed (locked final invoices)</div>
        <MoneyRow label="Service HT" value={money(m.service_ht)} />
        <MoneyRow
          label="Disbursement (pass-through)"
          value={money(m.disbursement_total)}
        />
        <MoneyRow label="TVA" value={money(m.vat_total)} />
        <MoneyRow label="Revenue HT" value={money(m.revenue_ht)} />
        <MoneyRow label="Total TTC" value={money(m.billed_ttc)} strong />
      </div>
      <div className="space-y-1.5">
        <div className="micro mb-2">Costs</div>
        <MoneyRow
          label="Planned service cost"
          value={money(m.planned_service_cost)}
        />
        <MoneyRow
          label="Planned débours"
          value={money(m.planned_disbursement)}
        />
        <MoneyRow label="Planned total" value={money(m.planned_cost)} />
        <MoneyRow label="Actual (GL)" value={money(m.actual_cost)} strong />
      </div>
      <div className="space-y-1.5">
        <div className="micro mb-2">Dossier margin</div>
        {marginMasked ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Restricted for your role.
          </div>
        ) : (
          <>
            <MoneyRow
              label="Margin (HT revenue − actual costs)"
              value={money(m.dossier_margin)}
              strong
              toneCls={
                Number(m.dossier_margin) < 0
                  ? "font-medium text-[rgb(var(--warn))]"
                  : "font-medium text-primary-ink"
              }
            />
            <MoneyRow
              label="Margin %"
              value={
                m.margin_percent != null ? `${num(m.margin_percent)}%` : "—"
              }
            />
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="micro mb-2">Budget vs actual</div>
        <MoneyRow label="Budget (costing)" value={money(m.budget?.budget)} />
        <MoneyRow label="Actual" value={money(m.budget?.actual)} />
        <MoneyRow
          label={`Variance${m.budget?.variance_percent != null ? ` (${num(m.budget.variance_percent)}%)` : ""}`}
          value={money(m.budget?.variance)}
          strong
          toneCls={
            m.budget?.over_budget
              ? "font-medium text-[rgb(var(--warn))]"
              : "font-medium text-foreground"
          }
        />
      </div>
    </div>
  );
}

function PeopleTab({
  people,
}: {
  people: api.DossierOverview["people"] | undefined;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-1.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="micro">Costing</span>
          {people?.costing?.doc_number && (
            <span className="num micro">{people.costing.doc_number}</span>
          )}
          {people?.costing?.status && (
            <Pill tone={tone(people.costing.status)}>
              {people.costing.status}
            </Pill>
          )}
        </div>
        {people?.costing ? (
          <>
            <PersonRow role="Validator" p={people.costing.validator} />
            <PersonRow role="Approver" p={people.costing.approver} />
          </>
        ) : (
          <span className="micro">No costing sheet on this file yet.</span>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="micro">Final invoice</span>
          {people?.invoice?.doc_number && (
            <span className="num micro">{people.invoice.doc_number}</span>
          )}
          {people?.invoice?.status && (
            <Pill tone={tone(people.invoice.status)}>
              {people.invoice.status}
            </Pill>
          )}
        </div>
        {people?.invoice ? (
          <>
            <PersonRow role="Issuer" p={people.invoice.issuer} />
            <PersonRow role="Validator" p={people.invoice.validator} />
            <PersonRow role="Approver" p={people.invoice.approver} />
          </>
        ) : (
          <span className="micro">No final invoice on this file yet.</span>
        )}
      </div>
    </div>
  );
}

function DocumentsTab({ d }: { d: api.DossierOverview }) {
  const docs = d.document_rows;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invoices" value={num(d.invoicing.count)} />
        <Stat
          label="Purchase orders"
          value={`${num(d.procurement.po_count)} · ${money(d.procurement.po_total)}`}
        />
        <Stat label="Transit orders" value={num(d.documents.transit_orders)} />
        <Stat label="Delivery notes" value={num(d.documents.delivery_notes)} />
      </div>

      <DocGroup
        title="Invoices"
        rows={docs?.invoices || []}
        empty="No invoices on this file."
        keyOf={(r) => r.invoice_id}
        render={(r) => (
          <DocRow
            label={
              <span className="num text-sm text-foreground">
                {r.ref || r.invoice_id.slice(0, 8)}
              </span>
            }
          >
            {r.status && <Pill tone={tone(r.status)}>{r.status}</Pill>}
            <span className="num micro">{money(r.total_ttc)}</span>
            <DocButton
              docType={
                r.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "FINAL_INVOICE"
              }
              id={r.invoice_id}
              title={r.ref || `Invoice ${r.invoice_id.slice(0, 8)}`}
              label="View"
            />
          </DocRow>
        )}
      />
      <DocGroup
        title="Vault documents"
        rows={docs?.vault || []}
        empty="No documents in the vault for this file."
        keyOf={(r) => r.doc_id}
        render={(r) => (
          <DocRow
            label={
              <span className="text-sm text-foreground">
                {r.doc_type ? humanizeKey(r.doc_type) : "Document"}
                {r.version_no && r.version_no > 1 ? ` · v${r.version_no}` : ""}
              </span>
            }
          >
            <span className="micro">{dateFmt(r.created_at)}</span>
            <Pill tone={tone(r.status)}>{r.status || "—"}</Pill>
          </DocRow>
        )}
      />
      <DocGroup
        title="Transit orders"
        rows={docs?.transit || []}
        empty="No transit orders on this file."
        keyOf={(r) => r.transit_order_id}
        render={(r) => (
          <DocRow
            label={
              <span className="num text-sm text-foreground">
                {r.ref || r.transit_order_id.slice(0, 8)}
              </span>
            }
          >
            {r.customs_regime && <Pill tone="mute">{r.customs_regime}</Pill>}
            <span className="micro">{r.service_direction || "—"}</span>
            <span className="num micro">{money(r.declared_value)}</span>
            <DocButton
              docType="TRANSIT_ORDER"
              id={r.transit_order_id}
              title={r.ref || `Transit order ${r.transit_order_id.slice(0, 8)}`}
              label="View"
            />
          </DocRow>
        )}
      />
      <DocGroup
        title="Delivery notes"
        rows={docs?.delivery || []}
        empty="No delivery notes on this file."
        keyOf={(r) => r.delivery_note_id}
        render={(r) => (
          <DocRow
            label={
              <span className="num text-sm text-foreground">
                {r.ref || r.delivery_note_id.slice(0, 8)}
              </span>
            }
          >
            <span className="text-sm text-muted-foreground">
              {r.consignee || "—"}
            </span>
            <span className="micro">{dateFmt(r.created_at)}</span>
            <DocButton
              docType="DELIVERY_NOTE"
              id={r.delivery_note_id}
              title={r.ref || `Delivery note ${r.delivery_note_id.slice(0, 8)}`}
              label="View"
            />
          </DocRow>
        )}
      />
    </div>
  );
}

export function Dossier360Modal({
  dossier,
  clientLabel,
  onClose,
}: {
  dossier: api.Dossier;
  clientLabel: string;
  onClose: () => void;
}) {
  const ov = useResource(
    () => api.getOverview(dossier.dossier_id),
    [dossier.dossier_id],
  );
  const [tab, setTab] = React.useState<Tab360>("milestones");
  const d = ov.data;
  const svc = serviceLabel(dossier);

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Operation file · ${dossier.ref}`}
      description={`${clientLabel}${svc && svc !== "—" ? ` · ${svc}` : ""}`}
    >
      {ov.loading ? (
        <SkeletonTable rows={5} cols={4} />
      ) : ov.error ? (
        <ErrorState message={ov.error} />
      ) : d ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Planned cost" value={money(d.costing.planned_cost)} />
            <Stat label="Actual cost" value={money(d.costs.actual_cost)} />
            <Stat
              label="Billed"
              value={money(d.invoicing.billed_ttc)}
              tone="ok"
            />
            <Stat
              label="Outstanding"
              value={money(d.invoicing.outstanding)}
              tone="warn"
            />
          </div>

          {d.readiness &&
            (d.readiness.ready_to_complete ||
              d.readiness.fully_collected ||
              d.dossier.status === "COMPLETED") && (
              <ReadinessBanner
                readiness={d.readiness}
                status={d.dossier.status}
                dossierId={dossier.dossier_id}
                onChanged={() => ov.reload()}
              />
            )}

          <Segmented
            label="Dossier 360 section"
            value={tab}
            options={TABS_360}
            onChange={setTab}
          />

          {tab === "details" && <DetailsTab dossierId={dossier.dossier_id} />}
          {tab === "itinerary" && (
            <ItineraryEditor dossierId={dossier.dossier_id} />
          )}
          {tab === "milestones" && (
            <MilestonesTab dossierId={dossier.dossier_id} />
          )}
          {tab === "queries" && <QTickets dossierId={dossier.dossier_id} />}
          {tab === "money" && <MoneyTab m={d.money} />}
          {tab === "people" && <PeopleTab people={d.people} />}
          {tab === "documents" && <DocumentsTab d={d} />}
        </div>
      ) : null}
    </Dialog>
  );
}
