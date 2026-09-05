/**
 * Transit order 360° — the per-order rollup, in Details / Cargo / Signatures /
 * Documents.
 *
 * ── ONE BODY, TWO SHELLS ────────────────────────────────────────────────────
 * A page on desktop (`/operations/transit-orders/:orderId`), the sheet on a
 * phone. The reasoning, and the shared chrome, are in
 * `components/record-360.tsx`; the rule is doc/FRONTEND_GUIDE.md §3.11.
 *
 * It matters more here than on most records. A transit order is the document a
 * customs broker, a client and a declarant all refer to by its OT number, and
 * until now "look at OT-2026-0114" meant "open Operations, then Transit orders,
 * then find it" — the drawer had no address. It also carries the lifecycle an
 * operator chases (issue -> client signature -> lodge), and the controls for it
 * were at the bottom of a scrolling dialog, below the cargo table.
 *
 * ── WHY THE TABS ARE THESE FOUR ─────────────────────────────────────────────
 * The drawer was one column: status, actions, shipment, instruction, cargo,
 * signatures, buttons. That is four different questions stacked, and the two
 * that get asked most — "what does this order say" and "does the cargo add up"
 * — were separated by everything else. Details answers the first, Cargo the
 * second, and the two that are occasional (who signed, what is attached) stop
 * costing a scroll on the two that are not.
 *
 * The buttons still bind to `allowed_transitions` from the server, so a control
 * can never exist for a transition the API would refuse.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { DocButton } from "@/components/doc-button";
import {
  Record360Card,
  Record360Header,
  Record360Page,
  Record360Rail,
} from "@/components/record-360";
import { useUrlTab } from "@/lib/use-url-tab";
import { useTrailTitle } from "@/app/layout/nav-trail-context";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
// The vault upload lives in masterdata-api because the vault is master data,
// not an operations concern — the signed scan is stored the same way every
// other scan in the product is.
import * as masterApi from "@/lib/masterdata-api";
import { SCAN_ACCEPT, scanFileProblem, readFileAsDataUrl } from "@/lib/vault-file";
import {
  SendForSignatureModal,
  SignatureChainOnRecord,
  SignDocumentModal,
  SignaturesOnRecord,
} from "@/features/vault/sign-document";
import { ShipmentDetailsPanel } from "./shipment-details";
import { TransitForm } from "./transit-order-form";
import { DossierDocuments, Fact } from "./components";
import { transitTone, TRANSIT_STATUS_HINT } from "./shared";

export type TransitOrder360Tab =
  | "details"
  | "cargo"
  | "signatures"
  | "documents";

/** Tab order. `details` is first and is the default: what the order actually
 *  instructs is the question the other three are about. */
export const TRANSIT_360_TABS: readonly TransitOrder360Tab[] = [
  "details",
  "cargo",
  "signatures",
  "documents",
] as const;

const TAB_LABEL: Record<TransitOrder360Tab, string> = {
  details: "Details",
  cargo: "Cargo",
  signatures: "Signatures",
  documents: "Documents",
};

/** `/operations/transit-orders/<id>` — the base path, in one place. */
export const TRANSIT_ORDERS_PATH = "/operations/transit-orders";

/* ── Lifecycle actions ─────────────────────────────────────────────────────── */

function OrderActions({
  row,
  onDone,
}: {
  row: api.TransitOrder;
  onDone: () => void;
}) {
  const allowed = new Set(row.allowed_transitions || []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ask, setAsk] = React.useState<null | "sign" | "lodge" | "cancel">(null);
  const [text, setText] = React.useState("");
  /** The client-signed copy, held until the transition that needs it. */
  const [scan, setScan] = React.useState<File | null>(null);
  const [scanError, setScanError] = React.useState<string | null>(null);
  /** The signatures engine (MOD-64), on this order's own screen. */
  const [signOpen, setSignOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const entityRef = `transit_order:${row.transit_order_id}`;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAsk(null);
      setText("");
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const blockers = row.issue_blockers || [];

  return (
    <div className="space-y-2">
      {error && <ErrorState message={error} />}
      <div className="flex flex-wrap gap-2">
        {allowed.has("ISSUED") && (
          <Button
            size="sm"
            disabled={busy || blockers.length > 0}
            title={
              blockers.length
                ? `Still needed: ${blockers.join(", ")}`
                : "Allocates the OT number and freezes the shipment details."
            }
            onClick={() => run(() => api.issueTransitOrder(row.transit_order_id))}
          >
            Issue &amp; number
          </Button>
        )}
        {allowed.has("SIGNED") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsk("sign")}>
            Record client signature
          </Button>
        )}
        {/*
          * Sign it OURSELVES, through the signatures engine.
          *
          * A different act from "Record client signature" beside it, and the
          * screen has to keep them apart: that one files the scan the CLIENT
          * stamped and moves the order to SIGNED; this one puts OUR
          * countersignature on the document — the approval that prints as the
          * seal in the company box, with the QR that lets anyone holding the
          * paper verify it.
          *
          * Only once the order is numbered. The seal prints the order's own
          * reference as evidence and its hash covers the issued figures, so
          * sealing a draft would attest to a document that does not exist yet
          * and would go stale the moment it was issued.
          */}
        {row.status !== "DRAFT" && row.status !== "CANCELLED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setSignOpen(true)}>
            Sign electronically
          </Button>
        )}
        {/*
          * Ask the CLIENT to sign it — the external chain.
          *
          * The third of three distinct acts on this rail, and the screen has to
          * keep them apart:
          *   Record client signature  files the scan they stamped by hand
          *   Sign electronically      puts OUR countersignature on the document
          *   Send for signature       emails the client a link to sign it
          *
          * Only once numbered, for the same reason as the countersignature: the
          * chain's hash covers the issued figures and its email names the
          * order's own reference.
          */}
        {row.status !== "DRAFT" && row.status !== "CANCELLED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setSendOpen(true)}>
            Send for signature
          </Button>
        )}
        {allowed.has("LODGED") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsk("lodge")}>
            Record declaration
          </Button>
        )}
        {allowed.has("CANCELLED") && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsk("cancel")}>
            Cancel order
          </Button>
        )}
      </div>

      {/* Why the Issue button is disabled, in words rather than a silent no-op. */}
      {allowed.has("ISSUED") && blockers.length > 0 && (
        <Callout tone="warn" title="Not ready to issue">
          Still needed: {blockers.join(", ")}.
        </Callout>
      )}

      <ConfirmDialog
        open={ask === "sign"}
        busy={busy}
        onClose={() => setAsk(null)}
        title="Record the client's signature"
        confirmLabel="Record"
        onConfirm={() =>
          run(async () => {
            /*
             * THE SCAN IS UPLOADED HERE, not "attached from the file's documents
             * tab" as this dialog used to claim.
             *
             * That instruction described a route nobody could follow: the API
             * refuses the transition without a `signature_vault_id`, and the
             * only control that could produce one was on another screen — so
             * "Record signature" was a button that could not succeed. The right
             * place to attach the evidence is the moment you are asserting it
             * exists.
             *
             * Uploaded FIRST, then the transition. If the upload fails the order
             * stays ISSUED and nothing is recorded, which is the safe way round:
             * the alternative marks an order signed and then fails to store the
             * proof.
             */
            const doc = await masterApi.uploadVaultDocument({
              data_url: await readFileAsDataUrl(scan!),
              doc_type: "TRANSIT_ORDER_SIGNED",
              entity_ref: `transit_order:${row.transit_order_id}`,
              ...(row.dossier_id ? { dossier_id: row.dossier_id } : {}),
              original_name: scan!.name,
            });
            await api.signTransitOrder(row.transit_order_id, {
              signed_by_name: text || undefined,
              signature_vault_id: doc.doc_id,
            });
            setScan(null);
            setScanError(null);
          })
        }
        confirmDisabled={!scan}
        body={
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Attach the copy the client signed. The signature is the
              authorisation to declare, so a scan is required — a status on its
              own is not evidence.
            </p>
            <Field
              label={tr("Signed copy")}
              required
              error={scanError || undefined}
              hint="PDF or a photo of the stamped page."
            >
              <input
                type="file"
                accept={SCAN_ACCEPT}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  // Refused against the vault's own limits BEFORE the file is
                  // base64-inflated and pushed over the wire — a 25 MB scan on a
                  // Douala connection is a long wait for a rejection.
                  const problem = file ? scanFileProblem(file) : null;
                  setScanError(problem);
                  setScan(problem ? null : file);
                  if (problem) e.target.value = "";
                }}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label={tr("Signed by")}>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Name on the client's stamp"
              />
            </Field>
          </div>
        }
      />

      <ConfirmDialog
        open={ask === "lodge"}
        busy={busy}
        onClose={() => setAsk(null)}
        title="Record the customs declaration"
        confirmLabel="Record"
        onConfirm={() => run(() => api.lodgeTransitOrder(row.transit_order_id, text))}
        body={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This closes the file's “transit declaration lodged” milestone. The
              order becomes final.
            </p>
            <Field label="Declaration reference" required>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. D-4471/2026"
              />
            </Field>
          </div>
        }
      />

      <ConfirmDialog
        open={ask === "cancel"}
        busy={busy}
        destructive
        onClose={() => setAsk(null)}
        title="Cancel this transit order"
        confirmLabel="Cancel order"
        cancelLabel="Keep it"
        onConfirm={() => run(() => api.cancelTransitOrder(row.transit_order_id, text))}
        body={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The OT number is retained and never re-used, so the reason is what
              explains the gap in the sequence later.
            </p>
            <Field label={tr("Reason")} required>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Client withdrew the booking"
              />
            </Field>
          </div>
        }
      />

      <SignDocumentModal
        open={signOpen}
        entityRef={entityRef}
        docType="TRANSIT_ORDER"
        onClose={() => setSignOpen(false)}
        onSaved={onDone}
      />

      <SendForSignatureModal
        open={sendOpen}
        entityRef={entityRef}
        docType="TRANSIT_ORDER"
        onClose={() => setSendOpen(false)}
        onSent={onDone}
      />
    </div>
  );
}

/* ── The tabs ──────────────────────────────────────────────────────────────── */

/** What the order instructs, and what it is attached to. */
function DetailsTab({
  order,
  onJump,
}: {
  order: api.TransitOrder;
  onJump: (tab: TransitOrder360Tab) => void;
}) {
  const t = order.totals;
  return (
    <div className="space-y-5">
      {/*
       * Which facts the reader is looking at. A document that cannot say
       * whether it is current or historic is exactly how the legacy reprint
       * problem went unnoticed for years.
       */}
      {order.shipment_details_source === "SNAPSHOT" && (
        <Callout tone="info" title="Shows what was agreed">
          These shipment details are the copy frozen when the order was issued,
          not the file as it stands today.
        </Callout>
      )}

      {order.dossier_id && (
        <ShipmentDetailsPanel
          data={order.shipment_details || undefined}
          dossierId={order.shipment_details ? undefined : order.dossier_id}
          title={tr("Shipment")}
        />
      )}

      <Panel title="Instruction">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact label={tr("Direction")} value={order.service_direction} />
          <Fact
            label="Regime"
            value={order.customs_regime || order.customs_regime_other}
          />
          <Fact
            label="Declared"
            value={
              t?.declared_value != null
                ? `${money(t.declared_value)} ${order.declared_currency || ""}`
                : null
            }
          />
          <Fact
            label="In XAF"
            value={
              order.declared_currency !== "XAF" && t?.declared_value_xaf != null
                ? money(t.declared_value_xaf)
                : null
            }
          />
          <Fact label="Departure" value={order.departure_date} />
          <Fact
            label={tr("Insurance")}
            value={order.insurance_type === "COMPANY" ? "Us" : "Client"}
          />
          <Fact
            label={tr("Surveyor")}
            value={order.surveyor_party === "COMPANY" ? "Us" : "Client"}
          />
          <Fact label={tr("Declaration")} value={order.declaration_ref} />
        </dl>
      </Panel>

      <Record360Rail title={tr("Related")}>
        {/*
         * The operations file is a real destination now — it has its own 360
         * route — so this is a link rather than a card naming a file the reader
         * then has to go and find.
         */}
        <Record360Card
          label="Operations file"
          value={order.dossier_ref || "Not linked"}
          hint={order.dossier_id ? "Open the file 360" : "No file on this order"}
          to={
            order.dossier_id
              ? `/operations/files/${encodeURIComponent(order.dossier_id)}`
              : undefined
          }
        />
        {/* No client_id on an order, so there is nothing honest to link to. */}
        <Record360Card
          label={tr("Client")}
          value={order.client_name || "—"}
          hint={order.entity_name || undefined}
        />
        <Record360Card
          label={tr("Cargo")}
          value={
            order.lines?.length
              ? `${num(order.lines.length)} lines · ${money(t?.lines_total)}`
              : "No lines"
          }
          hint={
            t && !t.reconciles ? "Does not match the declared value" : undefined
          }
          onClick={() => onJump("cargo")}
        />
        <Record360Card
          label="Lodged"
          value={order.declaration_ref || (order.lodged_at ? "Filed" : "Not yet")}
          hint={order.lodged_at ? dateFmt(order.lodged_at) : undefined}
        />
      </Record360Rail>
    </div>
  );
}

/** The manifest, and whether it adds up to what was declared. */
function CargoTab({ order }: { order: api.TransitOrder }) {
  const t = order.totals;
  return (
    <Panel title="Cargo">
      {order.lines?.length ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="micro text-left text-muted-foreground">
              <th className="pb-1">{tr("Description")}</th>
              <th className="pb-1">Marks</th>
              <th className="pb-1 text-right">Pkgs</th>
              <th className="pb-1 text-right">{tr("Weight")}</th>
              <th className="pb-1 text-right">{tr("Value")}</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr
                key={l.transit_order_line_id || l.label}
                className="border-t border-border"
              >
                <td className="py-1">{l.label}</td>
                <td className="py-1 text-muted-foreground">{l.marks || "—"}</td>
                <td className="num py-1 text-right">
                  {num(Number(l.packages || 0))}
                </td>
                <td className="num py-1 text-right">{l.weight || "—"}</td>
                <td className="num py-1 text-right">
                  {l.value_amount != null ? money(l.value_amount) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted-foreground">No cargo lines.</p>
      )}
      {t && !t.reconciles && (
        <Callout tone="warn" className="mt-2">
          Lines total {money(t.lines_total)} against a declared{" "}
          {money(t.declared_value || 0)}.
        </Callout>
      )}
    </Panel>
  );
}

/**
 * Who was ASKED (the chain) and who HAS signed (the signatures).
 *
 * Two panels because they answer different questions — a request that is
 * PARTIALLY_SIGNED with one signature on the document is the normal mid-chain
 * state, and either view alone reads as a fault. Both render nothing when the
 * tenant has signatures switched off or nothing has been signed, which on a tab
 * of its own would be a blank page — so a DRAFT says why instead.
 */
function SignaturesTab({ order }: { order: api.TransitOrder }) {
  const entityRef = `transit_order:${order.transit_order_id}`;
  return (
    <div className="space-y-5">
      {order.status === "DRAFT" && (
        <Callout tone="info" title="Not numbered yet">
          A draft cannot be signed. The seal's hash covers the issued figures and
          its evidence names the order's own reference, so sealing one now would
          attest to a document that does not exist yet.
        </Callout>
      )}
      <SignatureChainOnRecord
        entityRef={entityRef}
        title={tr("Out for signature")}
      />
      <SignaturesOnRecord
        entityRef={entityRef}
        title={tr("Signatures on this order")}
      />
      {order.signed_by_name && (
        <Panel title="Client signature on file">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fact label="Signed by" value={order.signed_by_name} />
            <Fact
              label={tr("Date")}
              value={order.signed_at ? dateFmt(order.signed_at) : null}
            />
          </dl>
        </Panel>
      )}
    </div>
  );
}

/** The order as a document, and what the file it belongs to has on hand. */
function DocumentsTab({ order }: { order: api.TransitOrder }) {
  return (
    <div className="space-y-5">
      <Panel
        title="This order"
        subtitle="The printed instruction, as the declarant receives it."
      >
        <DocButton
          docType="TRANSIT_ORDER"
          id={order.transit_order_id}
          title={order.ref || "Transit order"}
          label="View document"
        />
      </Panel>
      {order.dossier_id && (
        <Panel
          title="On the operations file"
          subtitle="What is already attached, so the evidence behind this order can be read without leaving it."
        >
          <DossierDocuments dossierId={order.dossier_id} />
        </Panel>
      )}
    </div>
  );
}

/* ── The 360 ───────────────────────────────────────────────────────────────── */

/**
 * The body. Both shells render this and neither adds content of its own.
 *
 * `variant` decides only what the shell has ALREADY drawn: the dialog puts the
 * reference in its title bar, so the page draws the header card and the modal
 * draws a status line instead. The ACTIONS belong in both.
 */
export function TransitOrder360({
  id,
  variant = "page",
  onChanged,
}: {
  id: string;
  variant?: "page" | "modal";
  /** The list behind this view reloads when the order's status changes. */
  onChanged?: () => void;
}) {
  const order = useResource(() => api.getTransitOrder(id), [id]);
  const [tab, setTab] = useUrlTab<TransitOrder360Tab>(
    TRANSIT_360_TABS,
    "details",
  );
  const [editing, setEditing] = React.useState(false);
  const data = order.data;

  // `order.reload` is a stable callback; `order` itself is a fresh object every
  // render, so depending on the object would rebuild this on every one.
  const { reload: reloadOrder } = order;
  const refresh = React.useCallback(() => {
    reloadOrder();
    onChanged?.();
  }, [reloadOrder, onChanged]);

  // Names this step for the back-arrow tooltip and the hold-menu. The route can
  // only ever say "Transit orders"; this screen knows which one.
  useTrailTitle(
    variant === "page" && data ? `Transit order ${data.ref || "(draft)"}` : null,
  );

  if (order.loading) return <SkeletonTable rows={5} cols={4} />;
  if (order.error) return <ErrorState message={order.error} />;
  if (!data)
    return (
      <EmptyState
        title={tr("Not found")}
        hint="This transit order could not be loaded."
      />
    );

  const t = data.totals;
  const packages = (data.lines || []).reduce(
    (sum, l) => sum + Number(l.packages || 0),
    0,
  );
  const foreign = !!data.declared_currency && data.declared_currency !== "XAF";
  const count: Partial<Record<TransitOrder360Tab, string>> = {
    cargo: data.lines?.length ? String(data.lines.length) : undefined,
  };
  const tabs = TRANSIT_360_TABS.map((value) => ({
    value,
    label: count[value]
      ? `${tr(TAB_LABEL[value])} · ${count[value]}`
      : tr(TAB_LABEL[value]),
  }));

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {data.status !== "LODGED" && data.status !== "CANCELLED" && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {tr("Edit")}
        </Button>
      )}
      <DocButton
        docType="TRANSIT_ORDER"
        id={data.transit_order_id}
        title={data.ref || "Transit order"}
        label={tr("View")}
      />
    </div>
  );

  return (
    <div className="space-y-5">
      {variant === "page" ? (
        <Record360Header
          title={data.ref || "Not yet numbered"}
          titleClassName={data.ref ? "num" : undefined}
          pills={<Pill tone={transitTone(data.status)}>{data.status}</Pill>}
          subtitle={TRANSIT_STATUS_HINT[data.status]}
          meta={[
            data.client_name,
            data.dossier_ref && `File ${data.dossier_ref}`,
            data.customs_regime || data.customs_regime_other,
            data.departure_date && `Departs ${dateFmt(data.departure_date)}`,
          ]}
          actions={actions}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={transitTone(data.status)}>{data.status}</Pill>
          <span className="micro">{TRANSIT_STATUS_HINT[data.status]}</span>
          <span className="flex-1" />
          {actions}
        </div>
      )}

      {/* The lifecycle rail — issue, record the signature, lodge, cancel. It
          used to sit at the bottom of a scrolling dialog, below the cargo. */}
      <OrderActions row={data} onDone={refresh} />

      {/* Every tile drills into the tab that explains the figure. The fourth
          exists only on a foreign-currency order: an "In XAF" tile repeating
          the number beside it teaches operators to ignore tiles. */}
      <KpiRow stack>
        <KpiTile
          label="Declared value"
          value={
            t?.declared_value != null
              ? `${money(t.declared_value)} ${data.declared_currency || ""}`
              : "—"
          }
          onClick={() => setTab("details")}
          ariaLabel="Declared value — open the Details tab"
        />
        <KpiTile
          label="Cargo total"
          value={money(t?.lines_total)}
          tone={t && !t.reconciles ? "warn" : "accent"}
          hint={t && !t.reconciles ? "does not reconcile" : undefined}
          onClick={() => setTab("cargo")}
          ariaLabel="Cargo total — open the Cargo tab"
        />
        <KpiTile
          label={tr("Packages")}
          value={num(packages)}
          onClick={() => setTab("cargo")}
          ariaLabel="Packages — open the Cargo tab"
        />
        {foreign && (
          <KpiTile
            label="In XAF"
            value={
              t?.declared_value_xaf != null ? money(t.declared_value_xaf) : "—"
            }
            hint={
              data.declared_fx_to_xaf
                ? `at ${num(data.declared_fx_to_xaf)}`
                : undefined
            }
            onClick={() => setTab("details")}
            ariaLabel="Declared value in XAF — open the Details tab"
          />
        )}
      </KpiRow>

      <Segmented
        label="Transit order 360 section"
        value={tab}
        options={tabs}
        onChange={setTab}
      />

      {tab === "details" && <DetailsTab order={data} onJump={setTab} />}
      {tab === "cargo" && <CargoTab order={data} />}
      {tab === "signatures" && <SignaturesTab order={data} />}
      {tab === "documents" && <DocumentsTab order={data} />}

      {editing && (
        <TransitForm
          row={data}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

/**
 * The phone shell. Opened over the list from `?focus=<id>`, dismissed like any
 * other sheet — which is what a detail view has to be on a viewport where a
 * full-page drill-in is a navigation dead end.
 */
export function TransitOrder360Modal({
  id,
  refLabel,
  fileLabel,
  onClose,
  onChanged,
}: {
  id: string;
  /** From the list row, so the dialog can name itself on the first frame. */
  refLabel?: string | null;
  fileLabel?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={refLabel || "Transit order (draft)"}
      description={fileLabel ? `File ${fileLabel}` : undefined}
    >
      <TransitOrder360 id={id} variant="modal" onChanged={onChanged} />
    </Dialog>
  );
}

/**
 * `/operations/transit-orders/:orderId` — the desktop shell.
 *
 * A full route because an OT number is what a broker, a client and a declarant
 * all refer to the document by, and it has to be something you can send.
 */
export function TransitOrder360Page() {
  const { orderId = "" } = useParams();
  return (
    <Record360Page
      basePath={TRANSIT_ORDERS_PATH}
      backLabel={tr("Transit orders")}
      id={orderId}
    >
      <TransitOrder360 id={orderId} variant="page" />
    </Record360Page>
  );
}
