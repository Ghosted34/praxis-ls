/**
 * Ask whether any recipient on this draft is known to bounce (§9.8).
 *
 * ── THE FEATURE THIS COMPLETES ──────────────────────────────────────────────
 *
 * §9.8's promise is a whole loop: a DSN comes back, it is parsed into
 * `email_bounce`, correlated to the original by Message-ID, and the contact is
 * marked `SOFT_FAILING` or `HARD_FAILED` — "and a `HARD_FAILED` address is
 * warned about in the composer before the next send. This ends the 'we emailed
 * the invoice three times' failure permanently."
 *
 * Everything but the last clause was built. `POST /mail/bounces/check` exists,
 * is gated `requireFeature("mail.composer")` — a route whose own gate names the
 * one surface it is for — and carries a header saying it is "what the composer
 * calls before a send". No caller. Meanwhile the Trust tab tells the operator,
 * on screen, that "the composer checks this list before a send", which is the
 * worse half: a control someone is relying on that does not run.
 *
 * ── DEBOUNCED ON THE ADDRESSES, NOT ON THE DRAFT ────────────────────────────
 *
 * The body is irrelevant here, so unlike the guardrail check this one only
 * moves when the recipient list does — a person typing four paragraphs to one
 * client asks once. 600 ms after the field settles, matching `useGuardrails`,
 * so the two bars appear together rather than in sequence.
 *
 * ── A FAILED CHECK RENDERS NOTHING ──────────────────────────────────────────
 *
 * Not "all clear" — nothing. `addressStatus` had a `.catch(() => [])` on the
 * server that answered a broken query with the same empty list a clean one
 * produces; that is now gone, and this side keeps the distinction: `rows` is
 * null until an answer arrives, and an error puts it back to null. It never
 * blocks the send. The person may well know the address is fine and be sending
 * to it deliberately.
 */
import * as React from "react";
import * as work from "@/lib/mail-api-work";

export const RECIPIENT_CHECK_DEBOUNCE_MS = 600;

export function useRecipientHealth({
  addresses,
  enabled = true,
}: {
  addresses: string[];
  enabled?: boolean;
}) {
  const [rows, setRows] = React.useState<work.AddressStatus[] | null>(null);

  // The list, collapsed to the value the effect actually depends on. An array
  // is a fresh reference every render, and depending on it restarts the
  // debounce on every keystroke — the defect §16.5 found in `useGuardrails`.
  const key = addresses.join(",").toLowerCase();
  const latest = React.useRef(addresses);
  latest.current = addresses;

  React.useEffect(() => {
    if (!enabled || !key.trim()) {
      setRows(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      work
        .checkAddresses(latest.current)
        .then((r) => {
          if (live) setRows(Array.isArray(r) ? r : []);
        })
        .catch(() => {
          if (live) setRows(null);
        });
    }, RECIPIENT_CHECK_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, enabled]);

  const hard = (rows || []).filter((r) => r.email_status === "HARD_FAILED");
  const soft = (rows || []).filter((r) => r.email_status === "SOFT_FAILING");
  return { rows, hard, soft };
}
