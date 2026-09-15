/**
 * The one door to "Raise a ticket", from any screen.
 *
 * A window event rather than a context, for the same reason the copilot
 * opens through `praxis:open-copilot`: the modal lives at the app shell
 * (GlobalRaiseTicket) while its callers live all over the tree — the icon
 * rail, the touch cluster, the Support page header, the Help page. A window
 * event is the cheapest coupling between two subtrees, and there is exactly
 * one listener, so nothing can be "in the wrong place".
 *
 * The changed event is the other direction: anything the modal creates (or a
 * thread replies to) must make the Support page re-read its list, wherever
 * the user opened the conversation from.
 */
export const RAISE_TICKET_EVENT = "praxis:raise-ticket";
export const SUPPORT_CHANGED_EVENT = "praxis:support-changed";

export function openRaiseTicket(): void {
  window.dispatchEvent(new CustomEvent(RAISE_TICKET_EVENT));
}

export function announceSupportChanged(): void {
  window.dispatchEvent(new CustomEvent(SUPPORT_CHANGED_EVENT));
}
