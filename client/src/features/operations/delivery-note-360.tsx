/**
 * Delivery note 360° — the per-note rollup, in Details / Cargo / Progress /
 * Signatures.
 *
 * ── ONE BODY, TWO SHELLS ────────────────────────────────────────────────────
 * A page on desktop (`/operations/delivery-notes/:noteId`), the sheet on a
 * phone. The reasoning, and the shared chrome, are in
 * `components/record-360.tsx`; the rule is doc/FRONTEND_GUIDE.md §3.11.
 *
 * A delivery note is the piece of paper a driver carries and a consignee
 * signs, and the reference on it is what a client quotes back down the phone
 * when something is disputed. The drawer had no address, so answering "what
 * happened with DN-2026-0231" meant opening Operations, then Delivery notes,
 * then finding it — on a screen where the row that matters is often not on the
 * first page.
 *
 * ── WHY THE TABS ARE THESE FOUR ─────────────────────────────────────────────
 * Details is this note: who it is for, where it went, and what state it is in.
 * Cargo is what it carried. PROGRESS is the file it belongs to — how many of
 * its boxes are signed for, how many are on the road, how many are still to go
 * — and it is a tab of its own precisely because it answers a different
 * question from the other three: not "what is this note" but "is another one
 * needed". Signatures is who attested to it.
 *
 * The buttons bind to `allowed_transitions` from the server, so a control can
 * never exist for a transition the API would refuse.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { EmptyState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
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
import { num, dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import {
  SendForSignatureModal,
  SignatureChainOnRecord,
  SignDocumentModal,
  SignaturesOnRecord,
} from "@/features/vault/sign-document";
import { DeliveryForm } from "./delivery-note-form";
import { DeliveryProgressPanel } from "./delivery-progress";
import { useDeliveryProgress } from "./use-delivery-progress";
import { Fact } from "./components";
import { deliveryTone } from "./shared";

export type DeliveryNote360Tab =
  | "details"
  | "cargo"
  | "progress"
  | "signatures";

/** Tab order. `details` is first and is the default: who this note is for and
 *  what state it is in is the question the other three are about. */
export const DELIVERY_360_TABS: readonly DeliveryNote360Tab[] = [
  "details",
  "cargo",
  "progress",
  "signatures",
] as const;

const TAB_LABEL: Record<DeliveryNote360Tab, string> = {
  details: "Details",
  cargo: "Cargo",
  progress: "Progress",
  signatures: "Signatures",
};

/** `/operations/delivery-notes/<id>` — the base path, in one place. */
export const DELIVERY_NOTES_PATH = "/operations/delivery-notes";

/** How many boxes this note carries, counting a grouped line as its quantity. */
const noteBoxes = (note: api.DeliveryNote) =>
  (note.containers || []).reduce(
    (t, c) => t + (c.dossier_container_line_id ? Number(c.qty) || 1 : 1),
    0,
  );

/* ── Confirm the handover ───────────────────────────────────────────────── */

/**
 * The screen the legacy never had. Everything here is what the client wrote or
 * said at the gate, which is why `received_by_name` is required and the
 * reservations box is given real estate rather than a tooltip.
 */
function DeliverDialog({
  note,
  onClose,
  onDone,
}: {
  note: api.DeliveryNote;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState("");
  const [reservations, setReservations] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.confirmDelivery(note.delivery_note_id, {
        received_by_name: name.trim(),
        reservations: reservations.trim() || undefined,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Confirm delivery" description={note.ref || undefined}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field
          label="Received by"
          required
          hint="The name of the person who signed for the goods."
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jean Mballa"
          />
        </Field>
        <Field
          label="Reservations"
          hint="Anything the client noted — damage, short count, refused items. Their words, recorded now."
        >
          <Textarea
            rows={3}
            value={reservations}
            onChange={(e) => setReservations(e.target.value)}
            placeholder="Carton 3 crushed; contents intact."
          />
        </Field>
        <Callout tone="warn" title="This is final">
          A confirmed delivery cannot be edited afterwards — it records what the
          client accepted.
        </Callout>
        <FormButtons
          busy={busy}
          disabled={!name.trim() || busy}
          onCancel={onClose}
          saveLabel="Confirm delivery"
        />
      </form>
    </Dialog>
  );
}

/* ── The tabs ──────────────────────────────────────────────────────────────── */

/** Who this note is for, where it went, and what state it is in. */
function DetailsTab({
  note,
  onJump,
}: {
  note: api.DeliveryNote;
  onJump: (tab: DeliveryNote360Tab) => void;
}) {
  const boxes = noteBoxes(note);
  return (
    <div className="space-y-5">
      {note.status === "DRAFT" && (note.issue_blockers || []).length > 0 && (
        <Callout tone="warn" title="Not ready to issue">
          Still needed: {(note.issue_blockers || []).join(", ")}.
        </Callout>
      )}

      {note.status === "DELIVERED" && (
        <Callout tone="ok" title={`Received by ${note.received_by_name}`}>
          {note.received_at ? dateFmt(note.received_at) : null}
          {note.reservations ? ` — “${note.reservations}”` : null}
        </Callout>
      )}

      {note.status === "CANCELLED" && note.cancel_reason && (
        <Callout tone="bad" title={tr("Cancelled")}>
          {note.cancel_reason}
        </Callout>
      )}

      <Panel title="Delivery">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact label={tr("Consignee")} value={note.consignee} />
          <Fact
            label={tr("Delivery date")}
            value={note.delivery_date ? dateFmt(note.delivery_date) : null}
          />
          <Fact label={tr("Contact")} value={note.contact_person} />
          <Fact label={tr("Phone")} value={note.phone} />
          <Fact label={tr("Address")} value={note.address} />
        </dl>
      </Panel>

      <Record360Rail title={tr("Related")}>
        {/* The operations file has its own 360 route, so this is a real link
            rather than a card naming a file the reader must then go and find. */}
        <Record360Card
          label="Operations file"
          value={note.dossier_ref || "Not linked"}
          hint={note.dossier_id ? "Open the file 360" : "No file on this note"}
          to={
            note.dossier_id
              ? `/operations/files/${encodeURIComponent(note.dossier_id)}`
              : undefined
          }
        />
        <Record360Card
          label={tr("Cargo")}
          value={boxes ? `${num(boxes)} on this note` : "No containers"}
          hint={
            (note.lines || []).length
              ? `${num((note.lines || []).length)} other cargo lines`
              : undefined
          }
          onClick={() => onJump("cargo")}
        />
        <Record360Card
          label={tr("Delivery progress")}
          value="Across the file"
          hint="Every live note, counted from the notes themselves"
          onClick={() => onJump("progress")}
        />
        <Record360Card
          label={tr("Signed by")}
          value={note.received_by_name || "Not yet"}
          hint={note.received_at ? dateFmt(note.received_at) : undefined}
          onClick={() => onJump("signatures")}
        />
      </Record360Rail>
    </div>
  );
}

/** What this note carries — the boxes, and anything unlisted alongside them. */
function CargoTab({ note }: { note: api.DeliveryNote }) {
  const containers = note.containers || [];
  return (
    <div className="space-y-5">
      <Panel title={`Containers (${num(noteBoxes(note))})`}>
        {containers.length ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {containers.map((c) => (
              <li key={c.delivery_note_container_id} className="text-sm">
                {c.dossier_container_line_id && c.container_type_code ? (
                  // The GROUPED shape (10708): the note states the equipment
                  // the way the file does, before any box has a number.
                  <span className="font-medium">
                    {c.qty ?? 1} × {c.container_type_code}
                    <span className="text-muted">
                      {" "}
                      — numbers not yet on file
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="num font-medium">
                      {c.container_no || "—"}
                    </span>
                    {c.container_type_code && (
                      <span className="text-muted">
                        {" "}
                        · {c.container_type_code}
                      </span>
                    )}
                    {c.seal_no && (
                      <span className="text-muted"> · seal {c.seal_no}</span>
                    )}
                  </>
                )}
                {/* Why a box already signed for is on this note too. It prints
                    on the sheet, so it belongs on the screen the sheet is
                    raised from. */}
                {c.redelivery_reason && (
                  <span className="block text-xs text-warn">
                    ↻ {c.redelivery_reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No containers on this note.</p>
        )}
      </Panel>

      {(note.lines || []).length > 0 && (
        <Panel title="Other cargo">
          <ul className="space-y-1">
            {(note.lines || []).map((l) => (
              <li
                key={l.delivery_note_line_id}
                className="flex justify-between text-sm"
              >
                <span>{l.label}</span>
                <span className="num text-muted">{num(l.qty ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/**
 * The FILE, not this note: how many of its boxes have been signed for, how many
 * are on the road, how many are still to go.
 *
 * A tab of its own because this is where somebody decides whether ANOTHER note
 * is needed, which is a different question from anything else on this screen.
 * The panel renders nothing when the file's service type does not capture
 * containers — a customs-brokerage file is not "0 of 0 delivered" — so the tab
 * says so rather than showing an empty frame.
 */
function ProgressTab({
  note,
  progress,
}: {
  note: api.DeliveryNote;
  progress: api.DeliveryProgress | null;
}) {
  if (!progress || !progress.captures_containers || progress.total === 0)
    return (
      <EmptyState
        title="Nothing to count"
        hint="This file's service type does not capture containers, so there are no boxes to track across its notes."
      />
    );
  return (
    <DeliveryProgressPanel
      progress={progress}
      highlightNoteRef={note.ref || null}
    />
  );
}

/**
 * Who was ASKED (the chain) and who HAS signed (the seals).
 *
 * Two panels because they answer different questions — a request still out with
 * one signature already on the note is the normal mid-chain state, and either
 * view alone reads as a fault. Both render nothing when there is nothing to
 * show, so a tenant with signatures switched off never sees an empty section
 * for a feature it does not have — and the gate signature, which is not an
 * electronic seal at all, is stated here in its own right.
 */
function SignaturesTab({ note }: { note: api.DeliveryNote }) {
  const entityRef = `delivery_note:${note.delivery_note_id}`;
  return (
    <div className="space-y-5">
      <Panel
        title="At the gate"
        subtitle="What the consignee wrote when the goods arrived."
      >
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact label={tr("Signed by")} value={note.received_by_name} />
          <Fact
            label={tr("Date")}
            value={note.received_at ? dateFmt(note.received_at) : null}
          />
          <Fact label="Reservations" value={note.reservations} />
        </dl>
      </Panel>
      <SignatureChainOnRecord
        entityRef={entityRef}
        title={tr("Out for signature")}
      />
      <SignaturesOnRecord
        entityRef={entityRef}
        title={tr("Signatures on this note")}
      />
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
export function DeliveryNote360({
  id,
  variant = "page",
  onChanged,
}: {
  id: string;
  variant?: "page" | "modal";
  /** The list behind this view reloads when the note's status changes. */
  onChanged?: () => void;
}) {
  const note = useResource(() => api.getDeliveryNote(id), [id]);
  const data = note.data;
  // Before the early returns below: the file is not known until `data` lands,
  // and a hook cannot be called conditionally. An empty id fetches nothing.
  const progress = useDeliveryProgress(data?.dossier_id || "");
  const [tab, setTab] = useUrlTab<DeliveryNote360Tab>(
    DELIVERY_360_TABS,
    "details",
  );
  const [editing, setEditing] = React.useState(false);
  const [delivering, setDelivering] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [signOpen, setSignOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Both are stable callbacks; the objects holding them are fresh every render,
  // so depending on the objects would rebuild this on every one.
  const { reload: reloadNote } = note;
  const { reload: reloadProgress } = progress;
  const refresh = React.useCallback(() => {
    reloadNote();
    // Confirming a delivery moves boxes from "out with a driver" to "signed
    // for", and the Progress tab is on this same screen — leaving it stale
    // would show the operator the file as it was before the act they just
    // performed.
    reloadProgress();
    onChanged?.();
  }, [reloadNote, reloadProgress, onChanged]);

  // Names this step for the back-arrow tooltip and the hold-menu. The route can
  // only ever say "Delivery notes"; this screen knows which one.
  useTrailTitle(
    variant === "page" && data ? `Delivery note ${data.ref || "(draft)"}` : null,
  );

  const issue = React.useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.issueDeliveryNote(id);
      refresh();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }, [id, refresh]);

  if (note.loading) return <SkeletonTable rows={5} cols={4} />;
  if (note.error) return <ErrorState message={note.error} />;
  if (!data)
    return (
      <EmptyState
        title={tr("Not found")}
        hint="This delivery note could not be loaded."
      />
    );

  const can = (s: api.DeliveryStatus) =>
    (data.allowed_transitions || []).includes(s);
  const p = progress.data;
  // A file whose service type captures no containers has no boxes to count, and
  // a strip of zeros is a strip that teaches operators to ignore strips.
  const countable = !!p && p.captures_containers && p.total > 0;
  const boxes = noteBoxes(data);
  const count: Partial<Record<DeliveryNote360Tab, string>> = {
    cargo: boxes ? String(boxes) : undefined,
  };
  const tabs = DELIVERY_360_TABS.map((value) => ({
    value,
    label: count[value]
      ? `${tr(TAB_LABEL[value])} · ${count[value]}`
      : tr(TAB_LABEL[value]),
  }));

  /*
   * THREE DIFFERENT ACTS, and the screen has to keep them apart:
   *
   *   Confirm delivery     records what the client wrote at the gate — the
   *                        name, the reservations, the moment. It moves the
   *                        note to DELIVERED.
   *   Sign electronically  puts OUR attestation on the document: the seal that
   *                        prints in the company box with the QR anyone holding
   *                        the paper can check.
   *   Send for signature   emails the consignee a link to sign it themselves,
   *                        which is the same evidence without the driver
   *                        carrying a clipboard.
   *
   * The last two only once the note is numbered. The seal prints the note's own
   * reference as evidence and its hash covers the issued manifest, so sealing a
   * draft would attest to a document that does not exist yet and would go stale
   * the moment it was issued.
   */
  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {data.status === "DRAFT" && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {tr("Edit")}
        </Button>
      )}
      {can("ISSUED") && (
        <Button size="sm" onClick={issue} loading={busy}>
          Issue &amp; number
        </Button>
      )}
      {can("DELIVERED") && (
        <Button size="sm" onClick={() => setDelivering(true)}>
          Confirm delivery
        </Button>
      )}
      {data.status !== "DRAFT" && data.status !== "CANCELLED" && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setSignOpen(true)}
          >
            Sign electronically
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setSendOpen(true)}
          >
            Send for signature
          </Button>
        </>
      )}
      {can("CANCELLED") && (
        <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
          Cancel note
        </Button>
      )}
      <DocButton
        docType="DELIVERY_NOTE"
        id={data.delivery_note_id}
        title={data.ref || "Delivery note"}
        label={tr("Print")}
      />
    </div>
  );

  return (
    <div className="space-y-5">
      {variant === "page" ? (
        <Record360Header
          title={data.ref || "Not yet numbered"}
          titleClassName={data.ref ? "num" : undefined}
          pills={<Pill tone={deliveryTone(data.status)}>{data.status}</Pill>}
          meta={[
            data.consignee,
            data.dossier_ref && `File ${data.dossier_ref}`,
            data.delivery_date && `Delivered ${dateFmt(data.delivery_date)}`,
            data.received_by_name && `Signed by ${data.received_by_name}`,
          ]}
          actions={actions}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={deliveryTone(data.status)}>{data.status}</Pill>
          {data.dossier_ref && (
            <span className="micro">{data.dossier_ref}</span>
          )}
          <span className="flex-1" />
          {actions}
        </div>
      )}

      {actionError && <ErrorState message={actionError} />}

      {/* The FILE's boxes, not this note's — the figures that decide whether
          another note is needed. Absent entirely on a file that captures no
          containers, for the same reason the Progress panel is. */}
      {countable && p && (
        <KpiRow>
          <KpiTile
            label={tr("Delivered")}
            value={`${num(p.delivered)} / ${num(p.total)}`}
            tone="ok"
            onClick={() => setTab("progress")}
            ariaLabel="Delivered — open the Progress tab"
          />
          <KpiTile
            label="Out with a driver"
            value={num(p.in_transit)}
            tone={p.in_transit > 0 ? "warn" : "accent"}
            onClick={() => setTab("progress")}
            ariaLabel="Out with a driver — open the Progress tab"
          />
          <KpiTile
            label="Still to go"
            value={num(p.outstanding)}
            tone={p.outstanding > 0 ? "warn" : "accent"}
            onClick={() => setTab("progress")}
            ariaLabel="Still to go — open the Progress tab"
          />
          <KpiTile
            label="On this note"
            value={num(boxes)}
            onClick={() => setTab("cargo")}
            ariaLabel="Containers on this note — open the Cargo tab"
          />
        </KpiRow>
      )}

      <Segmented
        label="Delivery note 360 section"
        value={tab}
        options={tabs}
        onChange={setTab}
      />

      {tab === "details" && <DetailsTab note={data} onJump={setTab} />}
      {tab === "cargo" && <CargoTab note={data} />}
      {tab === "progress" && <ProgressTab note={data} progress={p} />}
      {tab === "signatures" && <SignaturesTab note={data} />}

      {editing && (
        <DeliveryForm
          note={data}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
      {delivering && (
        <DeliverDialog
          note={data}
          onClose={() => setDelivering(false)}
          onDone={refresh}
        />
      )}
      <SignDocumentModal
        open={signOpen}
        entityRef={`delivery_note:${data.delivery_note_id}`}
        docType="DELIVERY_NOTE"
        onClose={() => setSignOpen(false)}
        onSaved={refresh}
      />
      <SendForSignatureModal
        open={sendOpen}
        entityRef={`delivery_note:${data.delivery_note_id}`}
        docType="DELIVERY_NOTE"
        onClose={() => setSendOpen(false)}
        onSent={refresh}
      />
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this delivery note"
        confirmLabel="Cancel note"
        cancelLabel="Keep it"
        destructive
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          setActionError(null);
          try {
            await api.cancelDeliveryNote(id, reason);
            setCancelling(false);
            refresh();
          } catch (err) {
            setActionError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
        body={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The number is retained and never re-used, so the reason is what
              explains the gap in the sequence later.
            </p>
            <Field label={tr("Reason")} required>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Client refused the delivery"
              />
            </Field>
          </div>
        }
      />
    </div>
  );
}

/**
 * The phone shell. Opened over the list from `?focus=<id>`, dismissed like any
 * other sheet — which is what a detail view has to be on a viewport where a
 * full-page drill-in is a navigation dead end.
 */
export function DeliveryNote360Modal({
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
      title={refLabel || "Delivery note (draft)"}
      description={fileLabel ? `File ${fileLabel}` : undefined}
    >
      <DeliveryNote360 id={id} variant="modal" onChanged={onChanged} />
    </Dialog>
  );
}

/**
 * `/operations/delivery-notes/:noteId` — the desktop shell.
 *
 * A full route because a delivery-note reference is what a client quotes back
 * down the phone when a delivery is disputed, and it has to be something you
 * can send to the person who has to answer them.
 */
export function DeliveryNote360Page() {
  const { noteId = "" } = useParams();
  return (
    <Record360Page
      basePath={DELIVERY_NOTES_PATH}
      backLabel={tr("Delivery notes")}
      id={noteId}
    >
      <DeliveryNote360 id={noteId} variant="page" />
    </Record360Page>
  );
}
