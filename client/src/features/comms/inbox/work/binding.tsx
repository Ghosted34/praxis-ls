/**
 * THE BINDING CHIP (§7.1, §7.2).
 *
 * The single most consequential control in the mailbox, and the one with the
 * least screen area: what this thread is ABOUT. Everything downstream — the
 * dossier drawer, the action cards, the AI's grounding facts, the Client 360
 * timeline — reads `email_thread.entity_ref`, and nothing can read it until
 * somebody says what it is.
 *
 * ── SUGGESTIONS ARE SUGGESTIONS ─────────────────────────────────────────────
 *
 * The server proposes bindings from signals in the message — a reference in the
 * subject, a sender on a known domain, an attachment named after a file. It
 * never applies one. §7.2's rule is that binding is an act with a name on it,
 * because a wrong binding is invisible: the thread simply shows the wrong
 * client's invoices to whoever opens it next, and looks entirely normal doing
 * so.
 *
 * So: each suggestion shows its SIGNAL and its CONFIDENCE, and both are
 * rendered rather than collapsed into a percentage. "The subject contains
 * SLAS-2026-0042" and "the sender is on a domain we have seen before" are
 * different kinds of evidence, and an operator deciding between two candidates
 * needs to know which one they are looking at.
 *
 * ── UNBINDING IS OFFERED, NOT HIDDEN ────────────────────────────────────────
 *
 * A binding someone made in error must be undoable from the same place it was
 * made. Hiding the control behind a menu is how a wrong binding survives: the
 * person who notices it is usually not the person who made it, and they will
 * not go looking for a way to correct someone else's work.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { LoadingRow } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { humanizeRef } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/**
 * Confidence, as a word.
 *
 * A raw 0.72 asks the reader to hold a scale in their head that nothing on
 * screen defines. Three bands map onto the three decisions available — accept
 * it, look at it, ignore it — which is the only granularity the control
 * actually offers.
 */
function confidenceBand(c: number): { label: string; tone: Tone } {
  if (c >= 0.85) return { label: tr("Strong match"), tone: "ok" };
  if (c >= 0.6) return { label: tr("Likely"), tone: "warn" };
  return { label: tr("Weak"), tone: "mute" };
}

/** The signal keys the server emits, in words an operator can act on. */
const SIGNAL_TEXT: Record<string, string> = {
  REFERENCE: "a reference in the subject or body",
  SUBJECT_REF: "a reference in the subject",
  BODY_REF: "a reference in the message body",
  SENDER_DOMAIN: "the sender's domain",
  SENDER_ADDRESS: "this exact address, used before",
  ATTACHMENT: "an attachment filename",
  PARTICIPANT: "someone on this thread",
  THREAD_HISTORY: "an earlier message in this thread",
};
const signalText = (s: string) =>
  (SIGNAL_TEXT[s] ? tr(SIGNAL_TEXT[s]) : s.toLowerCase().replace(/_/g, " "));

export function BindingChip({
  threadId,
  entityRef,
  onChanged,
  onOpenRecord,
}: {
  threadId: string;
  entityRef: string | null;
  onChanged: () => void;
  /** Opens the dossier drawer. Only offered once something is bound. */
  onOpenRecord: (ref: string) => void;
}) {
  const suggestions = useResource(() => api.listSuggestions(threadId), [threadId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState("");
  const [showManual, setShowManual] = React.useState(false);

  const open = (suggestions.data || []).filter((s) => s.status === "SUGGESTED");

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      suggestions.reload();
      onChanged();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2" aria-label={tr("What this thread is about")}>
      {entityRef ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenRecord(entityRef)}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:border-primary"
          >
            {humanizeRef(entityRef)}
          </button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy === "unbind"}
            onClick={() => run("unbind", () => api.unbindThread(threadId))}
          >
            {tr("Not this one")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {tr("This thread is not linked to a record yet, so the drawer, the action cards and the assistant have nothing to work from.")}
        </p>
      )}

      {suggestions.loading && <LoadingRow label={tr("Looking for a match…")} />}

      {open.length > 0 && (
        <ul className="space-y-1.5">
          {open.map((s) => {
            const band = confidenceBand(Number(s.confidence || 0));
            return (
              <li
                key={s.email_binding_suggestion_id}
                className="rounded-lg border border-border bg-card/40 px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {s.entity_label || humanizeRef(s.entity_ref)}
                  </span>
                  <Pill tone={band.tone}>{band.label}</Pill>
                </div>
                {/* The evidence, in a sentence. A percentage on its own tells
                    the operator how sure the machine is, not why — and "why"
                    is the only thing that lets them disagree with it. */}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tr("Matched on")} {signalText(s.signal)}
                  {s.matched_text ? (
                    <>
                      {" — "}
                      <span className="num">{s.matched_text}</span>
                    </>
                  ) : null}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy === s.email_binding_suggestion_id}
                    onClick={() =>
                      run(s.email_binding_suggestion_id, () =>
                        api.acceptSuggestion(threadId, s.email_binding_suggestion_id))
                    }
                  >
                    {tr("Link it")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === s.email_binding_suggestion_id}
                    onClick={() =>
                      run(s.email_binding_suggestion_id, () =>
                        api.rejectSuggestion(threadId, s.email_binding_suggestion_id))
                    }
                  >
                    {tr("No")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showManual ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const ref = manual.trim();
            if (!ref) return;
            run("manual", () => api.bindThread(threadId, ref)).then(() => {
              setManual("");
              setShowManual(false);
            });
          }}
        >
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="client:… or dossier:…"
            aria-label={tr("Record reference")}
            className="h-8 text-xs"
          />
          <Button size="sm" type="submit" disabled={busy === "manual" || !manual.trim()}>
            {tr("Link")}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setShowManual(false)}>
            {tr("Cancel")}
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setShowManual(true)}>
          {entityRef ? tr("Link to something else") : tr("Link it myself")}
        </Button>
      )}
    </section>
  );
}
