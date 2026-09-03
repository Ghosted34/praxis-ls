/**
 * Operations file 360° — the per-file rollup, in Details / Itinerary /
 * Milestones / Queries / Money / People / Documents.
 *
 * ── ONE BODY, TWO SHELLS ────────────────────────────────────────────────────
 * This used to be a modal and only a modal. A dialog is the right container for
 * a glance and the wrong one for the screen an operator lives in all morning:
 * it caps at 768px while the display is 2560, it traps focus so nothing else on
 * the app is reachable, and — the part that actually cost people time — it has
 * no address, so "look at SBX-2026-0001" could not be sent to a colleague.
 *
 * So `OperationFile360` is the body, and it has two shells:
 *
 *   <OperationFile360Page>   `/operations/files/:fileId` — a real route, full
 *                            width, deep-linkable, back-arrow reachable. What
 *                            desktop gets.
 *   <OperationFile360Modal>  the dialog, opened over the list from `?focus=`.
 *                            What a phone gets, because a full-page detail on
 *                            a 390px viewport is a navigation dead end and a
 *                            sheet you dismiss is not.
 *
 * The branch is made in JavaScript rather than CSS (`useIsDesktop`), and
 * `lib/use-media-query.ts` opens with the reason: rendering both and hiding one
 * would mount the content twice, put a live focus trap in the phone's
 * accessibility tree, and give a screen reader two of every heading.
 *
 * ── THE HEADER COMES FROM THE RESPONSE, NOT FROM THE CALLER ─────────────────
 * The modal used to be handed the list row it was opened from, which is how it
 * knew the client name and the service label. A page opened from a pasted link
 * has no row. `/operations/:id/360` therefore returns the display fields as well
 * as the ids (see operations_file.service.js), and BOTH shells render from that
 * one response — so the two surfaces cannot drift, which is the failure the
 * milestone chain already had once.
 *
 * Margin figures arrive nulled for roles masked on `dossier.margin` (server-side
 * field mask, PRD §7.3/§11.3), so the Money tab shows a "restricted" note rather
 * than a number in that case. Do not "fix" a blank margin here — it is a grant.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Stat } from "@/components/ui/stat";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Pill } from "@/components/ui/pill";
// A status enum is never shown raw (FRONTEND_GUIDE §5). The costing module
// owns how its own statuses are said out loud, so this reads its label map
// rather than keeping a second copy that would drift on the next status.
import { statusLabel } from "@/features/costing/costing-model";
import { useUrlTab } from "@/lib/use-url-tab";
import {
  Record360Card,
  Record360Header,
  Record360Page,
  Record360Rail,
} from "@/components/record-360";
import { useTrailTitle } from "@/app/layout/nav-trail-context";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { MilestoneChain } from "./milestone-chain";
import { QTickets } from "./q-tickets";
import { humanizeKey, routeLabel, serviceLabel, tone } from "./shared";
import { DocGroup, DocRow, MoneyRow, PersonRow } from "./components";
// The shared shipment/service details (0660) — the same component every
// document, costing and quotation renders, so what ops sees on the file and
// what a client sees on an invoice are one projection, not two.
import { ShipmentDetailsPanel } from "./shipment-details";
import { ContainerEditor } from "./container-editor";
import { ItineraryEditor } from "./itinerary-editor";
import { DossierForm } from "./dossier-form";

/** The file's own header, as the 360 response returns it. */
type FileHeader = api.DossierOverview["dossier"];

export type File360Tab =
  | "details"
  | "itinerary"
  | "milestones"
  | "queries"
  | "money"
  | "people"
  | "documents";

/** Tab order. `details` is first and is the default: what is actually moving is
 *  the question every other tab is about. */
export const FILE_360_TABS: readonly File360Tab[] = [
  "details",
  "itinerary",
  "milestones",
  "queries",
  "money",
  "people",
  "documents",
] as const;

const TAB_LABEL: Record<File360Tab, string> = {
  details: "Details",
  itinerary: "Itinerary",
  milestones: "Milestones",
  queries: "Queries",
  money: "Money",
  people: "People",
  documents: "Documents",
};

/** `/operations/files/<id>` — the 360's own address. One definition, because
 *  the list, the KPI drill-ins and the client 360 all have to spell it the same. */
export const filePath = (fileId: string, tab?: File360Tab) =>
  `/operations/files/${encodeURIComponent(fileId)}${tab && tab !== "details" ? `?tab=${tab}` : ""}`;

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
function DetailsTab({
  fileId,
  header,
  onJump,
}: {
  fileId: string;
  header: FileHeader;
  onJump: (tab: File360Tab) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const details = useResource(() => api.getShipmentDetails(fileId), [fileId]);
  const block = details.data?.containers;

  return (
    <div className="space-y-5">
      <ShipmentDetailsPanel
        data={details.data}
        action={
          block?.enabled ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {block.lines.length ? "Edit containers" : "Add containers"}
            </Button>
          ) : null
        }
      />
      <RelatedRail header={header} onJump={onJump} />
      {editing && block && (
        <ContainerEditor
          dossierId={fileId}
          mode={block.mode}
          onClose={() => setEditing(false)}
          onSaved={() => details.reload()}
        />
      )}
    </div>
  );
}

/**
 * What else this file touches — the rail that turns a terminus into a hub.
 *
 * ONLY LINKS THAT LAND. The client card and the invoice card leave for another
 * module because those two screens genuinely read `?focus=` and will select the
 * record. Transit orders, delivery notes and the vault do NOT — their screens
 * take no deep-link parameter today — so those cards jump to the tab that holds
 * the rows instead of navigating to a list that would arrive unfiltered and
 * pretend it had found something. A rail of links that quietly land on the
 * wrong row is worse than one that stays honest about where it can go.
 */
function RelatedRail({
  header,
  onJump,
}: {
  header: FileHeader;
  onJump: (tab: File360Tab) => void;
}) {
  const done = header.milestone_done || 0;
  const total = header.milestone_total || 0;
  return (
    <Record360Rail title={tr("Related")}>
        <Record360Card
          label={tr("Client")}
          value={header.client_name || "—"}
          hint={header.client_id ? "Open the client 360" : "No client on file"}
          to={
            header.client_id
              ? `/master/clients?focus=${encodeURIComponent(header.client_id)}`
              : undefined
          }
        />
        <Record360Card
          label={tr("Milestones")}
          value={total ? `${num(done)} of ${num(total)} done` : tr("None yet")}
          hint={header.current_milestone || undefined}
          onClick={() => onJump("milestones")}
        />
        <Record360Card
          label={tr("Carrier")}
          value={header.rate_provider_name || tr("Not confirmed")}
          hint={header.incoterm ? `Incoterm ${header.incoterm}` : undefined}
        />
        <Record360Card
          label={tr("Documents")}
          value={
            header.bl_mawb ? `BL / MAWB ${header.bl_mawb}` : "Open the documents"
          }
          hint={header.vessel_flight || undefined}
          onClick={() => onJump("documents")}
        />
    </Record360Rail>
  );
}

/** Lifecycle readiness banner (consumes the dossier.milestones_completed /
 *  dossier.fully_collected orchestration signals, surfaced via overview.readiness).
 *  Prompts to complete the file once its milestones are done. */
function ReadinessBanner({
  readiness,
  status,
  fileId,
  onChanged,
}: {
  readiness: NonNullable<api.DossierOverview["readiness"]>;
  status: string;
  fileId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const done = status === "COMPLETED";

  async function complete() {
    setBusy(true);
    setErr(null);
    try {
      await api.transitionDossier(fileId, "COMPLETED");
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
            {tr("Mark complete")}
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

function MilestonesTab({ fileId }: { fileId: string }) {
  // The chain, its dates and its actions now live in one component shared with
  // the Milestones screen — two renderings of the same thing had already
  // drifted once (the standalone screen advanced, this one only listed).
  return <MilestoneChain dossierId={fileId} />;
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
        <MoneyRow label={tr("Total TTC")} value={money(m.billed_ttc)} strong />
      </div>
      <div className="space-y-1.5">
        <div className="micro mb-2">{tr("Costs")}</div>
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
        <div className="micro mb-2">File margin</div>
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
              label={tr("Margin %")}
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
        <MoneyRow label={tr("Actual")} value={money(m.budget?.actual)} />
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
          <span className="micro">{tr("Costing")}</span>
          {/* 12766: the reference is a LINK now. The one screen that tells you
              a file has a costing was the one place you could not open it. */}
          {people?.costing?.doc_number &&
            (people.costing.costing_id ? (
              <Link
                className="num micro underline-offset-2 hover:underline"
                to={`/costing/costing/${people.costing.costing_id}`}
              >
                {people.costing.doc_number}
              </Link>
            ) : (
              <span className="num micro">{people.costing.doc_number}</span>
            ))}
          {people?.costing?.status && (
            <Pill tone={tone(people.costing.status)}>
              {statusLabel(people.costing.status)}
            </Pill>
          )}
        </div>
        {people?.costing ? (
          <>
            <PersonRow role="Validator" p={people.costing.validator} />
            {/* Who actually did it, when that is not the person it was
                addressed to — crediting the named validator for someone
                else's decision is a Separation-of-Duties record that lies. */}
            {people.costing.validated_by &&
              people.costing.validated_by.user_id !==
                people.costing.validator?.user_id && (
                <PersonRow
                  role="Validated by"
                  p={people.costing.validated_by}
                />
              )}
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
        <Stat label={tr("Invoices")} value={num(d.invoicing.count)} />
        <Stat
          label={tr("Purchase orders")}
          value={`${num(d.procurement.po_count)} · ${money(d.procurement.po_total)}`}
        />
        <Stat
          label={tr("Transit orders")}
          value={num(d.documents.transit_orders)}
        />
        <Stat
          label={tr("Delivery notes")}
          value={num(d.documents.delivery_notes)}
        />
      </div>

      <DocGroup
        title={tr("Invoices")}
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
              label={tr("View")}
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
        title={tr("Transit orders")}
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
              label={tr("View")}
            />
          </DocRow>
        )}
      />
      <DocGroup
        title={tr("Delivery notes")}
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
              label={tr("View")}
            />
          </DocRow>
        )}
      />
    </div>
  );
}

/**
 * The lifecycle controls, in the 360 itself.
 *
 * They used to exist only on the list row, so acting on the file you were
 * reading meant closing it, finding the row again and hoping the filter had not
 * moved it. Same two transitions the table offers (OPEN → IN_PROGRESS →
 * COMPLETED), same endpoint.
 */
function FileActions({
  header,
  onEdit,
  onChanged,
}: {
  header: FileHeader;
  onEdit?: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const next =
    header.status === "OPEN"
      ? "IN_PROGRESS"
      : header.status === "IN_PROGRESS"
        ? "COMPLETED"
        : null;

  async function advance() {
    if (!next) return;
    setBusy(true);
    setErr(null);
    try {
      await api.transitionDossier(header.dossier_id, next);
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {err && (
        <span className="micro text-[rgb(var(--bad))]" role="alert">
          {err}
        </span>
      )}
      {onEdit && (
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {tr("Edit")}
        </Button>
      )}
      {next && (
        <Button size="sm" variant="outline" loading={busy} onClick={advance}>
          {next === "IN_PROGRESS" ? "Start" : "Complete"}
        </Button>
      )}
    </div>
  );
}

/** The identity block: reference, what it is, and where it is going. Page-only —
 *  in the modal the dialog's own title bar says all of this. */
function FileHeaderCard({
  header,
  onEdit,
  onChanged,
}: {
  header: FileHeader;
  onEdit?: () => void;
  onChanged: () => void;
}) {
  const svc = serviceLabel(header);
  const route = routeLabel(header);
  return (
    <Record360Header
      title={header.ref}
      titleClassName="num"
      subtitle={header.title}
      pills={
        <>
          <Pill tone={tone(header.status)}>{header.status}</Pill>
          {svc && svc !== "—" && <Pill tone="mute">{svc}</Pill>}
        </>
      }
      meta={[
        header.client_name,
        route !== "—" && route,
        header.eta && `ETA ${dateFmt(header.eta)}`,
        header.bl_mawb && `BL / MAWB ${header.bl_mawb}`,
      ]}
      actions={
        <FileActions header={header} onEdit={onEdit} onChanged={onChanged} />
      }
    />
  );
}

/**
 * The 360 itself. Both shells render this; neither adds content of its own.
 *
 * `variant` decides only what the shell has ALREADY drawn: the dialog puts the
 * reference and the client in its title bar, so the page draws the header card
 * and the modal does not. Everything below the header is identical, which is the
 * point — a phone and a desktop are looking at the same file.
 */
export function OperationFile360({
  fileId,
  variant = "page",
  onEdit,
  onChanged,
}: {
  fileId: string;
  variant?: "page" | "modal";
  /** Opens the edit form. Omitted where there is nowhere to open it. */
  onEdit?: () => void;
  /** The list behind this view reloads when the file's status changes. */
  onChanged?: () => void;
}) {
  const ov = useResource(() => api.getOverview(fileId), [fileId]);
  // `?tab=` rather than `useState`: a colleague can be sent straight to the
  // Money tab of a file, and the tab survives a refresh. `useUrlTab` writes with
  // `replace`, so reading a file does not fill the back button with its own tabs.
  const [tab, setTab] = useUrlTab<File360Tab>(FILE_360_TABS, "details");
  const d = ov.data;

  // `ov.reload` is a stable callback; `ov` itself is a fresh object every
  // render, so depending on the object would rebuild this on every one.
  const { reload: reloadOverview } = ov;
  const reload = React.useCallback(() => {
    reloadOverview();
    onChanged?.();
  }, [reloadOverview, onChanged]);

  if (ov.loading) return <SkeletonTable rows={5} cols={4} />;
  if (ov.error) return <ErrorState message={ov.error} />;
  if (!d)
    return (
      <EmptyState
        title={tr("Not found")}
        hint="This operations file could not be loaded."
      />
    );

  const header = d.dossier;
  const msDone = header.milestone_done || 0;
  const msTotal = header.milestone_total || 0;
  const docCount =
    (d.documents.invoices ?? d.invoicing.count) +
    d.documents.transit_orders +
    d.documents.delivery_notes +
    (d.documents.vault ?? 0);
  // Counts ride the label because `Segmented` takes a string — and they are the
  // TRUE counts from the response, not the length of the capped row lists.
  const count: Partial<Record<File360Tab, string>> = {
    milestones: msTotal ? `${msDone}/${msTotal}` : undefined,
    queries: d.queries?.count ? String(d.queries.count) : undefined,
    documents: docCount ? String(docCount) : undefined,
  };
  const tabs = FILE_360_TABS.map((value) => ({
    value,
    label: count[value]
      ? `${tr(TAB_LABEL[value])} · ${count[value]}`
      : tr(TAB_LABEL[value]),
  }));

  return (
    <div className="space-y-5">
      {variant === "page" ? (
        <FileHeaderCard header={header} onEdit={onEdit} onChanged={reload} />
      ) : (
        <FileActions header={header} onEdit={onEdit} onChanged={reload} />
      )}

      {/* Every tile is a drill-in: the figure names a tab that explains it, so
          "why is 95.7M outstanding" is one click rather than a hunt. */}
      <KpiRow>
        <KpiTile
          label={tr("Planned cost")}
          value={money(d.costing.planned_cost)}
          hint={
            d.costing.doc_number
              ? `${d.costing.doc_number}${d.costing.status ? ` · ${statusLabel(d.costing.status)}` : ""}`
              : undefined
          }
          onClick={() => setTab("money")}
          ariaLabel="Planned cost — open the Money tab"
        />
        <KpiTile
          label={tr("Actual cost")}
          value={money(d.costs.actual_cost)}
          hint={`${num(d.costs.gl_entries)} GL entries`}
          onClick={() => setTab("money")}
          ariaLabel="Actual cost — open the Money tab"
        />
        <KpiTile
          label={tr("Billed")}
          value={money(d.invoicing.billed_ttc)}
          tone="ok"
          hint={`${num(d.invoicing.count)} invoices`}
          onClick={() => setTab("documents")}
          ariaLabel="Billed — open the Documents tab"
        />
        <KpiTile
          label={tr("Outstanding")}
          value={money(d.invoicing.outstanding)}
          tone="warn"
          onClick={() => setTab("money")}
          ariaLabel="Outstanding — open the Money tab"
        />
      </KpiRow>

      {d.readiness &&
        (d.readiness.ready_to_complete ||
          d.readiness.fully_collected ||
          header.status === "COMPLETED") && (
          <ReadinessBanner
            readiness={d.readiness}
            status={header.status}
            fileId={fileId}
            onChanged={reload}
          />
        )}

      <Segmented
        label="Operations file 360 section"
        value={tab}
        options={tabs}
        onChange={setTab}
      />

      {tab === "details" && (
        <DetailsTab fileId={fileId} header={header} onJump={setTab} />
      )}
      {tab === "itinerary" && <ItineraryEditor dossierId={fileId} />}
      {tab === "milestones" && <MilestonesTab fileId={fileId} />}
      {tab === "queries" && <QTickets dossierId={fileId} />}
      {tab === "money" && <MoneyTab m={d.money} />}
      {tab === "people" && <PeopleTab people={d.people} />}
      {tab === "documents" && <DocumentsTab d={d} />}
    </div>
  );
}

/**
 * The phone shell. Opened over the list from `?focus=<id>`, dismissed like any
 * other sheet — which is what a detail view has to be on a viewport where a
 * full-page drill-in is a navigation dead end.
 *
 * `ref` and `clientLabel` come from the list row so the dialog can name itself
 * on the first frame; everything inside comes from the response.
 */
export function OperationFile360Modal({
  file,
  clientLabel,
  onClose,
  onEdit,
  onChanged,
}: {
  file: api.Dossier;
  clientLabel: string;
  onClose: () => void;
  onEdit?: () => void;
  onChanged?: () => void;
}) {
  const svc = serviceLabel(file);
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Operations file · ${file.ref}`}
      description={`${clientLabel}${svc && svc !== "—" ? ` · ${svc}` : ""}`}
    >
      <OperationFile360
        fileId={file.dossier_id}
        variant="modal"
        onEdit={onEdit}
        onChanged={onChanged}
      />
    </Dialog>
  );
}

/**
 * `/operations/files/:fileId` — the desktop shell.
 *
 * A full route for the same reason the entity and treasury 360s have theirs: a
 * file reference gets pasted into an email, and "open Operations, then Files,
 * then find SBX-2026-0001" is not a link.
 */
export function OperationFile360Page() {
  const { fileId = "" } = useParams();
  const [editing, setEditing] = React.useState(false);
  /*
   * THE FILE ROW ITSELF, alongside the 360 rollup — and it is not a duplicate
   * fetch for the sake of one.
   *
   * `DossierForm` edits an `api.Dossier`: every writable column, including the
   * dozen the 360 header has no reason to carry. Editing in place is what makes
   * this a workbench rather than a read-out, and the alternative — bouncing back
   * to the list to open the same file's form — is the round trip the page exists
   * to remove. It also names this step for the back-arrow tooltip.
   */
  const file = useResource(() => api.getDossier(fileId), [fileId]);
  useTrailTitle(file.data?.ref ? `Operations file ${file.data.ref}` : null);

  // The back link, the width and the hand-off to the phone's sheet are the same
  // three things on every 360 — see components/record-360.tsx.
  return (
    <Record360Page
      basePath="/operations/files"
      backLabel="Operations files"
      id={fileId}
    >
      <OperationFile360
        fileId={fileId}
        variant="page"
        onEdit={file.data ? () => setEditing(true) : undefined}
        onChanged={file.reload}
      />
      {editing && file.data && (
        <DossierForm
          row={file.data}
          onClose={() => setEditing(false)}
          onSaved={file.reload}
        />
      )}
    </Record360Page>
  );
}
