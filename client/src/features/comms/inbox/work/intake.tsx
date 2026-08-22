/**
 * INBOUND DOCUMENT INTAKE (§7.6) AND ATTACHMENT EXTRACTION (§8.6).
 *
 * Two staging surfaces with the same rule under them, which is why they are one
 * file:
 *
 *   "MUST: never file silently, at any confidence, in this programme."
 *
 * ── INTAKE: "Looks like a Bill of Lading for SLAS-2026-0042 — file it?" ─────
 *
 * The server classifies an attachment on ingest and writes a SUGGESTED row. It
 * does not touch the vault. Filing is a separate call with an actor's name on
 * it, and the confirm step is where the human's correction beats the machine's
 * guess — which is why the doc type and the record are both editable here. If
 * they were not, the dialog would be decorative and everyone would learn to
 * click through it.
 *
 * ── EXTRACTION: fields off a scanned invoice ────────────────────────────────
 *
 * Same shape one level deeper: read the numbers, stage them, and let a person
 * confirm before anything reaches a module that owns money. `matches` carries
 * the candidate records the fields point at — the PO whose number appears on
 * the invoice — so the reviewer confirms a link rather than searching for one.
 *
 * A match at 0.99 and a match at 0.41 require the same click. There is no
 * confidence at which either of these auto-files, and the interface should not
 * imply there could be: the confidence is shown as information about the
 * MACHINE, never as a shortcut past the person.
 *
 * ── FAILED IS SHOWN ─────────────────────────────────────────────────────────
 *
 * A scan the vision provider could not read produces a FAILED row rather than
 * no row. Hiding those would make an unreadable document look identical to one
 * nobody has got to yet, and it would sit in the queue forever.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { fieldLabel, humanizeRef } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/* ── Document intake ───────────────────────────────────────────────────────── */

function IntakeRow({ row, onDone }: { row: api.IntakeSuggestion; onDone: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [docType, setDocType] = React.useState(row.suggested_doc_type_code || "");
  const [entityRef, setEntityRef] = React.useState(row.suggested_entity_ref || "");
  const [busy, setBusy] = React.useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onDone(); } catch (err) { reportActionError(err); } finally { setBusy(false); }
  }

  return (
    <li className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{row.filename || tr("Attachment")}</span>
        {typeof row.confidence === "number" && (
          <Pill tone={row.confidence >= 0.8 ? "ok" : "warn"}>
            {`${Math.round(row.confidence * 100)}% ${tr("sure")}`}
          </Pill>
        )}
      </div>

      <p className="mt-0.5 text-xs text-muted-foreground">
        {tr("Looks like a")} <span className="font-medium">{row.suggested_doc_type_code || tr("document")}</span>
        {row.suggested_entity_ref ? (
          <> {tr("for")} {row.entity_label || humanizeRef(row.suggested_entity_ref)}</>
        ) : (
          <> {tr("— but nothing says whose it is yet")}</>
        )}
        {row.matched_on ? <> ({tr("from the")} {row.matched_on})</> : null}.
      </p>

      {editing && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Input
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            placeholder={tr("Document type code")}
            aria-label={tr("Document type")}
            className="h-8 text-xs"
          />
          <Input
            value={entityRef}
            onChange={(e) => setEntityRef(e.target.value)}
            placeholder="client:… or dossier:…"
            aria-label={tr("File it against")}
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            act(() => api.fileIntake(row.email_attachment_classification_id, {
              doc_type_code: docType || undefined,
              entity_ref: entityRef || undefined,
            }))
          }
        >
          {tr("File it")}
        </Button>
        {/* The correction path. Without it the confirm is a rubber stamp. */}
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {editing ? tr("Keep the suggestion") : tr("Change it")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => act(() => api.rejectIntake(row.email_attachment_classification_id))}
        >
          {tr("Not a document")}
        </Button>
      </div>
    </li>
  );
}

export function DocumentIntake({ threadId }: { threadId: string }) {
  const res = useResource(() => api.listIntake(threadId), [threadId]);
  const open = (res.data || []).filter((r) => r.status === "SUGGESTED");

  if (res.loading) return <LoadingRow label={tr("Checking the attachments…")} />;
  if (res.error) return <ErrorState message={res.error} />;
  if (!open.length) return null;

  return (
    <section aria-label={tr("Documents waiting to be filed")} className="space-y-2">
      <ul className="space-y-1.5">
        {open.map((r) => (
          <IntakeRow key={r.email_attachment_classification_id} row={r} onDone={res.reload} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {tr("Nothing is filed until you say so — at any confidence.")}
      </p>
    </section>
  );
}

/* ── Field extraction ──────────────────────────────────────────────────────── */

const KIND_LABEL: Record<api.ExtractionKind, string> = {
  SUPPLIER_INVOICE: "Supplier invoice",
  RECEIPT: "Receipt",
  CLIENT_PO: "Client purchase order",
  PROOF_OF_PAYMENT: "Proof of payment",
  CHEQUE: "Cheque",
  UNKNOWN: "Unrecognised",
};
const STATUS_TONE: Record<api.Extraction["status"], Tone> = {
  EXTRACTED: "blue", REVIEWED: "ok", DISMISSED: "mute", FAILED: "bad",
};

function ExtractionRow({ row, onDone }: { row: api.Extraction; onDone: () => void }) {
  const [fields, setFields] = React.useState<Record<string, unknown>>(row.fields || {});
  const [busy, setBusy] = React.useState(false);
  const entries = Object.entries(fields);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onDone(); } catch (err) { reportActionError(err); } finally { setBusy(false); }
  }

  return (
    <li className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{row.filename || tr("Attachment")}</span>
        <span className="flex items-center gap-1.5">
          <Pill tone="mute">{tr(KIND_LABEL[row.doc_kind])}</Pill>
          <Pill tone={STATUS_TONE[row.status]}>{row.status}</Pill>
        </span>
      </div>

      {row.status === "FAILED" ? (
        // Shown rather than hidden. See the header.
        <p className="mt-1 text-xs text-muted-foreground">
          {tr("We could not read this one. Nothing has been staged from it — open the file and enter the details by hand.")}
        </p>
      ) : (
        <>
          {typeof row.confidence === "number" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {`${Math.round(row.confidence * 100)}% ${tr("of the fields we asked for came back. Check them against the document.")}`}
            </p>
          )}

          {entries.length > 0 && (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {entries.map(([k, v]) => (
                <label key={k} className="block text-xs">
                  <span className="text-muted-foreground">{fieldLabel(k)}</span>
                  <Input
                    value={v === null || v === undefined ? "" : String(v)}
                    onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                    className="mt-0.5 h-8 text-xs"
                    aria-label={fieldLabel(k)}
                  />
                </label>
              ))}
            </div>
          )}

          {row.matches?.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground">{tr("This may belong to")}</p>
              <ul className="mt-0.5 space-y-0.5">
                {row.matches.map((m, i) => (
                  <li key={`${m.kind}-${m.id}-${i}`} className="text-xs">
                    {m.label || m.id}
                    {/* WHY we think so. A bare list of numbers makes the
                        reviewer redo the search we already did. */}
                    {m.on ? (
                      <span className="text-muted-foreground"> — {tr("matched on")} {fieldLabel(m.on)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {row.status === "EXTRACTED" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => act(() => api.reviewExtraction(row.attachment_extraction_id, fields))}>
            {tr("These are right")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.dismissExtraction(row.attachment_extraction_id))}>
            {tr("Discard")}
          </Button>
        </div>
      )}
      {row.status === "FAILED" && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.dismissExtraction(row.attachment_extraction_id))}>
            {tr("Dismiss")}
          </Button>
        </div>
      )}
    </li>
  );
}

export function Extractions({ messageId }: { messageId: string }) {
  const res = useResource(() => api.listMessageExtractions(messageId), [messageId]);
  const rows = (res.data || []).filter((r) => r.status !== "DISMISSED");

  if (res.loading || res.error || !rows.length) return null;

  return (
    <section aria-label={tr("Details read off the attachments")} className="space-y-2">
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <ExtractionRow key={r.attachment_extraction_id} row={r} onDone={res.reload} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {tr("Confirming these stages them for review. The record itself is still created in the module that owns it.")}
      </p>
    </section>
  );
}

/* ── The chase composer's payload ──────────────────────────────────────────── */

/**
 * "Chase missing documents" — exactly what is outstanding, in the client's
 * language.
 *
 * A chase listing documents the client already sent is worse than no chase: it
 * tells them nobody looked. The server filters; this renders what came back and
 * hands it to the composer as text.
 */
export function ChaseSnippet({
  clientId,
  onUse,
}: {
  clientId: string;
  onUse: (text: string) => void;
}) {
  const res = useResource(() => api.chaseList(clientId), [clientId]);
  const data = res.data;
  if (res.loading || res.error || !data) return null;

  if (data.nothing_outstanding) {
    return (
      <p className="text-xs text-muted-foreground">
        {tr("Every required document has been received — nothing to chase.")}
      </p>
    );
  }

  const fr = data.language === "fr";
  const names = data.missing.map((m) => (fr ? m.name_fr : m.name_en) || m.doc_type_code);
  const text = fr
    ? `Il nous manque encore : ${names.join(", ")}. Pourriez-vous nous les faire parvenir ?`
    : `We are still missing: ${names.join(", ")}. Could you send them over?`;

  return (
    <div className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{tr("Still outstanding")}</p>
      <p className="mt-0.5 text-sm">{names.join(" · ")}</p>
      <Button size="sm" variant="outline" className="mt-1.5" onClick={() => onUse(text)}>
        {tr("Ask for them")}
      </Button>
    </div>
  );
}
