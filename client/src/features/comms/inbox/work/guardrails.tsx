/**
 * THE PRE-SEND BAR AND THE SENDER VERDICT (§8.8, §9.7).
 *
 * ── TWO DIFFERENT THINGS, DELIBERATELY IN ONE FILE ──────────────────────────
 *
 * `VerdictBanner` is about a message that ARRIVED: is the person writing to us
 * who they claim to be. `GuardrailBar` is about a message about to LEAVE: is
 * this alright to send.
 *
 * They share a file because they share a vocabulary — VERIFIED, UNVERIFIED,
 * SUSPICIOUS, LIKELY_IMPERSONATION — and because the attack they exist for runs
 * through both: an email arrives from a lookalike domain, and the operator
 * replies to it with an invoice attached.
 *
 * ── WARNINGS ARE DISMISSIBLE. THE BLOCK IS NOT. ─────────────────────────────
 *
 * §8.8 defines exactly one hard block: a financial document to a domain rated
 * Suspicious or Likely impersonation. Everything else — no subject, "please
 * find attached" with nothing attached, an oversized body, a language mismatch
 * — is a warning that rides along and refuses nothing.
 *
 * Keeping that line sharp is the whole design. A guardrail that blocks a dozen
 * things is one people learn to click through, and then it does not block the
 * one that mattered.
 *
 * ── THE OVERRIDE IS PERMANENT, AND SAYS SO ──────────────────────────────────
 *
 * The block is overridable with a typed reason, because a block with no
 * override stops a legitimate invoice at 17:55 on a Friday and people route
 * around it by sending from Outlook, where there is no check at all.
 *
 * The reason goes to `immutable_ledger` — append-only, ten-year retention,
 * UPDATE and DELETE forbidden by trigger. This component says that IN THE
 * DIALOG, before the person types. Someone writing a sentence that outlives
 * them and the mailbox is entitled to know that is what they are doing.
 *
 * The server enforces all of this again inside the send path (`presend.js`).
 * This bar exists so the operator sees it before pressing send, NOT so the
 * client can decide whether the rule applies.
 */
import { Callout } from "@/components/ui/callout";
import { Pill, type Tone } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import * as api from "@/lib/mail-api";

const VERDICT: Record<api.AuthVerdict, { tone: Tone; label: string; why: string }> = {
  VERIFIED: {
    tone: "ok",
    label: "Verified sender",
    why: "This address is on a domain an administrator confirmed for this party.",
  },
  UNVERIFIED: {
    tone: "mute",
    label: "Not verified",
    why: "We have no confirmation that this domain belongs to the party on this thread. That is normal for a first contact.",
  },
  SUSPICIOUS: {
    tone: "warn",
    label: "Check this sender",
    why: "Something about this address does not match what we know about this party.",
  },
  LIKELY_IMPERSONATION: {
    tone: "bad",
    label: "Likely impersonation",
    why: "This domain closely resembles one we know, without being it. Treat any payment or bank-detail instruction here as false until you confirm it by phone.",
  },
};

/**
 * The banner over an inbound message.
 *
 * UNVERIFIED renders quietly, because most threads are and a loud banner on all
 * of them is one nobody reads by week two. SUSPICIOUS and LIKELY_IMPERSONATION
 * are loud, and they name the action — confirm by phone — rather than leaving
 * the reader to work out what "suspicious" is supposed to make them do.
 */
export function VerdictBanner({
  verdict,
  detail,
}: {
  verdict?: api.AuthVerdict | null;
  detail?: string | null;
}) {
  if (!verdict || verdict === "VERIFIED") return null;
  const v = VERDICT[verdict];
  if (!v) return null;

  if (verdict === "UNVERIFIED") {
    return (
      <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
        {v.label}. {v.why}
      </p>
    );
  }

  return (
    <Callout tone={verdict === "SUSPICIOUS" ? "warn" : "bad"} title={v.label}>
      {v.why}
      {detail ? <> {detail}</> : null}
    </Callout>
  );
}

/** A small inline verdict for the message header, where a banner is too much. */
export function VerdictPill({ verdict }: { verdict?: api.AuthVerdict | null }) {
  if (!verdict || verdict === "VERIFIED") return null;
  const v = VERDICT[verdict];
  return v ? <Pill tone={v.tone}>{v.label}</Pill> : null;
}

/**
 * The composer's pre-send bar.
 *
 * `onOverrideChange` hands the typed reason up to the composer, which puts it
 * on the send payload as `guardrail_override_reason`. The server re-runs the
 * check and refuses without it — this component cannot let anything through on
 * its own, which is the correct amount of authority for a client.
 */
export function GuardrailBar({
  result,
  overrideReason,
  onOverrideChange,
}: {
  result: api.GuardrailResult | null;
  overrideReason: string;
  onOverrideChange: (reason: string) => void;
}) {
  if (!result) return null;
  const { warnings, blocks } = result;
  if (!warnings.length && !blocks.length) return null;

  return (
    <div className="space-y-2">
      {blocks.map((b) => (
        <Callout key={b.code} tone="bad" title="This send is blocked.">
          {b.message}
        </Callout>
      ))}

      {blocks.length > 0 && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">
            Why are you sending it anyway?
          </span>
          {/* Said before they type, not after. A sentence that outlives the
              mailbox is one the writer should know is permanent. */}
          <span className="block text-xs text-muted-foreground">
            This is written to the permanent audit ledger with your name on it,
            and cannot be edited or removed afterwards.
          </span>
          <Textarea
            value={overrideReason}
            onChange={(e) => onOverrideChange(e.target.value)}
            rows={2}
            placeholder="e.g. Confirmed this address by phone with Thierry this morning."
            aria-label="Override reason"
            className="text-sm"
          />
          {overrideReason.trim().length > 0 && overrideReason.trim().length < 10 && (
            <span className="block text-xs text-muted-foreground">
              A sentence, please — this is a record of a decision.
            </span>
          )}
        </label>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1">
          {warnings.map((w) => (
            <li key={w.code} className="text-xs text-muted-foreground">
              · {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
