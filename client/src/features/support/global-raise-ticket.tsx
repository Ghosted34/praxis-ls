/**
 * The single mounted instance of the raise-a-ticket modal.
 *
 * Mounted once in the app shell, it owns the modal state and listens for the
 * open event. Every "Raise a ticket" entry point — the icon rail (the whole
 * point of the revamp: feedback one tap from any screen), the touch cluster,
 * the Support page header, Help — dispatches the same event, so there is one
 * modal, one context snapshot, one submission path, no matter where the
 * request came from.
 *
 * The Support page is NOT a special case: its header button calls
 * openRaiseTicket() like everyone else, and it re-reads its list off the
 * changed event like everyone else. Keeping the page a plain caller is what
 * keeps the rail shortcut from being a second, drifting copy of the form.
 */
import * as React from "react";
import { NewTicketModal } from "./new-ticket-modal";
import {
  RAISE_TICKET_EVENT,
  announceSupportChanged,
} from "./raise-ticket-bus";

export function GlobalRaiseTicket() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(RAISE_TICKET_EVENT, h);
    return () => window.removeEventListener(RAISE_TICKET_EVENT, h);
  }, []);

  if (!open) return null;
  return (
    <NewTicketModal
      onClose={() => setOpen(false)}
      onCreated={announceSupportChanged}
    />
  );
}
