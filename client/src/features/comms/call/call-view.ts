/**
 * How the live call is shown (calls audit PR-6; O4, F4), shared by the app
 * shell (comms-live) and the call's own conversation (thread-call-strip).
 *
 *   auto  outside the call's conversation, the full call screen; inside it,
 *         the thread's live strip alone
 *   full  the full call screen, wherever the person is (they opened it)
 *   bar   minimised: the docked bar outside the conversation, the strip in it
 *
 * One small store rather than props, because the two surfaces live in
 * different trees and must agree: the strip steps aside while the full
 * screen is open, so there is never a second End call button on screen.
 */
import * as React from "react";

export type CallView = "auto" | "full" | "bar";

let view: CallView = "auto";
const subs = new Set<() => void>();

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function setCallView(next: CallView) {
  if (next === view) return;
  view = next;
  subs.forEach((fn) => fn());
}

export function useCallView(): CallView {
  return React.useSyncExternalStore(subscribe, () => view, () => view);
}
