/**
 * WHICH MAILBOX THE MESSAGE LEAVES FROM.
 *
 * ── The bug this exists to make impossible ──────────────────────────────────
 *
 * The composer seeded its `from` state from the `connectionId` prop and then
 * owned it, because the From row inside the composer is a control a person
 * uses. Seeded ONCE, though — and for a new message the mailbox picker is not
 * that row: it lives in `new-message.tsx`, which changes the PROP and does not
 * remount the composer (remounting on a mailbox change would throw away
 * whatever had been typed). So the picker moved and the composer did not.
 * Every message left from whichever mailbox the dialog happened to open on,
 * which is the tenant default.
 *
 * That is the worst shape a bug can take: the send succeeds, the composer
 * confirms it, and the only places the truth surfaces are the recipient's inbox
 * and — when the default mailbox is not authorised for the address — an outbox
 * row hours later naming a mailbox nobody chose. "It always sends from the
 * default however carefully I pick" was an accurate description of the product.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * Follow the decision when the DECISION changes; never when the component
 * merely re-renders. The ref is what tells those two apart, and it is what
 * keeps a choice made in the composer's own From row from being overwritten by
 * the next re-render carrying the same prop it was seeded with.
 *
 * An empty decision is ignored rather than adopted: a parent that is still
 * loading its mailbox list passes "" for a tick, and adopting that would clear
 * a sender that was already chosen.
 */
import * as React from "react";

export function useFromMailbox(decided: string) {
  const [from, setFrom] = React.useState(decided);
  const decidedRef = React.useRef(decided);

  React.useEffect(() => {
    if (!decided || decidedRef.current === decided) return;
    decidedRef.current = decided;
    setFrom(decided);
  }, [decided]);

  return [from, setFrom] as const;
}
