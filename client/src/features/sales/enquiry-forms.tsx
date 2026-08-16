/**
 * Contact enquiry — the Manage drawer (F9, doc/SALES_CRM_FEATURES.md#F9).
 *
 * The legacy has one drawer with a status dropdown and a notes box, and it
 * writes both with a single unguarded UPDATE. This one separates the three
 * things an operator actually does, because they are three different acts with
 * three different consequences:
 *
 *   - Classify and annotate      -> PATCH   (never touches status)
 *   - Reply                      -> POST /respond  (sends the email; the
 *                                  enquiry becomes RESPONDED only if it lands)
 *   - Route into the funnel      -> POST /triage   (raises a lead and/or a
 *                                  partnership request; does NOT mark it
 *                                  answered)
 *
 * OPENING THE DRAWER MARKS IT READ. The legacy does this too, and it is what
 * makes the "New (unread)" tile mean unread. It is fired once per open, is
 * idempotent server-side, and its failure is deliberately swallowed: an
 * operator reading a message must never see an error because a bookkeeping
 * write lost a race.
 *
 * REPLY ATTEMPTS ARE SHOWN, INCLUDING THE FAILED ONES. A PENDING row means the
 * send started and we never heard back — the honest answer to "did this go
 * out" is sometimes "we do not know", and hiding that would send the operator
 * to retry blind.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/pill";
import { cell, dateFmt } from "@/lib/format";
import { errMsg, type Row } from "@/lib/use-resource";

const ENQUIRY_TYPES = ["GENERAL_ENQUIRY", "PARTNERSHIP", "CAREERS", "MEDIA"];

const TYPE_LABEL: Record<string, string> = {
  GENERAL_ENQUIRY: "General enquiry",
  PARTNERSHIP: "Partnership",
  CAREERS: "Careers",
  MEDIA: "Media",
};

const NOTES_MAX = 5000;
const BODY_MAX = 20000;

/**
 * A sent reply, collapsed.
 *
 * Bodies are bounded at 20 000 characters server-side, and the history is
 * newest-first — so an unclamped list pushes the reply box, which is the thing
 * the operator came here to use, an arbitrary distance off screen. Collapsed by
 * default, expandable in place, and never truncated in the data: the full text
 * is in the DOM, only its height is capped.
 */
function ReplyBody({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > 400;
  return (
    <div className="mt-1">
      <p
        className={`whitespace-pre-wrap text-xs text-foreground ${
          long && !open ? "line-clamp-4" : ""
        }`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-primary-ink underline underline-offset-2"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show full reply"}
        </button>
      )}
    </div>
  );
}

export function ManageEnquiryModal({
  enquiry,
  onClose,
  onDone,
}: {
  enquiry: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const open = !!enquiry;
  const id = enquiry ? String(enquiry.contact_enquiry_id) : "";

  const [detail, setDetail] = React.useState<Row | null>(null);
  const [type, setType] = React.useState("GENERAL_ENQUIRY");
  const [notes, setNotes] = React.useState("");
  const [reply, setReply] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [toLead, setToLead] = React.useState(false);
  const [toPartnership, setToPartnership] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!id) return;
    try {
      const out: any = await tenant(`/intake/enquiries/${id}`);
      const row = (out && !out.data && out.contact_enquiry_id ? out : out?.data) || out || null;
      setDetail(row);
      setType(String(row?.enquiry_type || "GENERAL_ENQUIRY"));
      setNotes(String(row?.internal_notes || ""));
      setSubject(`Re: ${row?.subject ? String(row.subject) : "your enquiry"}`);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);

  React.useEffect(() => {
    if (!enquiry) return;
    setError(null);
    setNotice(null);
    setReply("");
    setToLead(false);
    setToPartnership(String(enquiry.enquiry_type) === "PARTNERSHIP");
    void load();
    // Mark read on open. Fire-and-forget by design — see the header. The list
    // is refreshed by whichever real action follows, or on close.
    if (String(enquiry.status) === "NEW") {
      void tenant(`/intake/enquiries/${String(enquiry.contact_enquiry_id)}/read`, {
        method: "POST",
        body: {},
      })
        .then(() => onDone())
        .catch(() => { /* a read receipt must never interrupt reading */ });
    }
  }, [enquiry, load, onDone]);

  const status = String(detail?.status || enquiry?.status || "NEW");
  const closed = status === "CLOSED";
  const responses = Array.isArray(detail?.responses) ? (detail!.responses as Row[]) : [];
  const alreadyLead = !!detail?.lead_id;
  const alreadyPartnership = !!detail?.partnership_request_id;

  /** Returns whether the action succeeded — callers must not discard the
   *  operator's typing on a failure. */
  async function run(kind: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
      onDone();
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const saveDetails = () =>
    run(
      "save",
      () => tenant(`/intake/enquiries/${id}`, { method: "PATCH", body: { enquiry_type: type, internal_notes: notes } }),
      "Saved.",
    );

  /** The reply box is cleared ONLY on a successful send. A failed send is the
   *  case where the operator most needs their words back — SMTP refusing the
   *  recipient must not also delete what they wrote. */
  const sendReply = async () => {
    const sent = await run(
      "reply",
      () => tenant(`/intake/enquiries/${id}/respond`, { method: "POST", body: { body: reply, subject } }),
      "Reply sent. The enquiry is now marked responded.",
    );
    if (sent) setReply("");
  };

  const triage = () =>
    run(
      "triage",
      () => tenant(`/intake/enquiries/${id}/triage`, { method: "POST", body: { to_lead: toLead, to_partnership: toPartnership } }),
      "Routed.",
    );

  const move = (to: string, ok: string) =>
    run("move", () => tenant(`/intake/enquiries/${id}/transition`, { method: "POST", body: { to } }), ok);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Manage enquiry"
      description="Classify it, answer it, route it into the funnel, or close it."
      headerRight={<StatusPill status={status} />}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex gap-2">
            {closed ? (
              <Button variant="outline" loading={busy === "move"} onClick={() => move("READ", "Reopened.")}>
                Reopen
              </Button>
            ) : (
              <Button variant="ghost" loading={busy === "move"} onClick={() => move("CLOSED", "Closed.")}>
                Close enquiry
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <ErrorState message={error} />}
        {notice && (
          <p className="rounded-lg bg-[rgb(var(--ok)_/_0.08)] px-3 py-2 text-sm text-[rgb(var(--ok))]">{notice}</p>
        )}

        {/* The message as it was sent. Read-only: this is what the person
            wrote, and an editable copy of it is evidence nobody can trust. */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-semibold text-foreground">
            {cell(detail?.subject) === "—" ? "(no subject)" : cell(detail?.subject)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[cell(detail?.name), cell(detail?.company_name), cell(detail?.email), cell(detail?.phone)]
              .filter((x) => x !== "—")
              .join(" · ") || "Anonymous"}
            {" · "}
            {dateFmt(detail?.created_at as string)}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
            {cell(detail?.message) === "—" ? "(no message body)" : String(detail?.message)}
          </p>
        </div>

        {/* Classification + notes. One PATCH, and it cannot move the status. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Enquiry type">
            <Select value={type} onChange={(e) => setType(e.target.value)} disabled={closed}>
              {ENQUIRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button variant="outline" loading={busy === "save"} disabled={closed} onClick={saveDetails}>
              Save details
            </Button>
          </div>
        </div>

        <Field label="Internal notes" hint={`Not sent to anyone. ${notes.length}/${NOTES_MAX}.`}>
          <Textarea
            rows={3}
            value={notes}
            maxLength={NOTES_MAX}
            disabled={closed}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was decided, who is handling it…"
          />
        </Field>

        {/* Reply. The only thing that can make this enquiry RESPONDED. */}
        <div className="rounded-lg border p-3">
          <p className="mb-3 text-sm font-semibold text-foreground">Reply by email</p>
          {!detail?.email ? (
            <p className="text-sm text-muted-foreground">
              This enquiry was submitted without an email address, so there is nowhere to reply to. Record
              the outcome in the notes and close it.
            </p>
          ) : (
            <div className="space-y-3">
              <Field label="To">
                <Input value={String(detail.email)} readOnly disabled />
              </Field>
              <Field label="Subject">
                <Input value={subject} disabled={closed} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="Message" hint={`${reply.length}/${BODY_MAX}. Sent from the tenant's support address.`}>
                <Textarea
                  rows={6}
                  value={reply}
                  maxLength={BODY_MAX}
                  disabled={closed}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write the reply that will be emailed to this person…"
                />
              </Field>
              <Button loading={busy === "reply"} disabled={closed || !reply.trim()} onClick={sendReply}>
                Send reply
              </Button>
            </div>
          )}

          {responses.length > 0 && (
            <div className="mt-4 space-y-2 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Reply history
              </p>
              {responses.map((r) => {
                const st = String(r.send_status);
                const sentAt = dateFmt(String(r.sent_at || r.created_at));
                const toValue = String(cell(r.to_address));
                const errText = r.error == null ? null : String(r.error);

                return (
                  <div key={String(r.contact_enquiry_response_id)} className="rounded-md bg-muted/30 p-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={st} />
                      <span className="text-xs text-muted-foreground">
                        {sentAt} · {toValue}
                      </span>
                    </div>
                    <ReplyBody text={String(r.body)} />
                    {/* PENDING is shown, not hidden: the send started and we
                        never heard back. FAILED carries the transport's own
                        words, because "it didn't send" is not actionable. */}
                    {st === "PENDING" && (
                      <p className="mt-1 text-xs text-[rgb(var(--warn))]">
                        Sent, but the mail server never confirmed. Check the mail log before resending.
                      </p>
                    )}
                    {st === "FAILED" && errText && (
                      <p className="mt-1 text-xs text-[rgb(var(--bad))]">{errText}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Triage. Deliberately below the reply: routing an enquiry is not
            answering it, and the layout should not suggest otherwise. */}
        <div className="rounded-lg border p-3">
          <p className="mb-1 text-sm font-semibold text-foreground">Route into the funnel</p>
          <p className="mb-3 text-xs text-muted-foreground">
            This does not mark the enquiry answered — the person still needs a reply.
          </p>
          <div className="space-y-2">
            <Checkbox
              checked={alreadyLead || toLead}
              disabled={alreadyLead || closed}
              onCheckedChange={(v) => setToLead(v === true)}
              label={alreadyLead ? "Lead already raised" : "Raise a lead"}
            />
            <Checkbox
              checked={alreadyPartnership || toPartnership}
              disabled={alreadyPartnership || closed}
              onCheckedChange={(v) => setToPartnership(v === true)}
              label={
                alreadyPartnership
                  ? "Partnership request already raised"
                  : "Raise a partnership request (also classifies this as Partnership)"
              }
            />
          </div>
          <Button
            className="mt-3"
            variant="outline"
            loading={busy === "triage"}
            disabled={closed || (!toLead && !toPartnership) || (alreadyLead && alreadyPartnership)}
            onClick={triage}
          >
            Route
          </Button>
        </div>
      </div>
    </Modal>
  );
}
