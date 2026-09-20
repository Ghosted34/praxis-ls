/**
 * Presence (Smart Comms PR-1, guide §4.11) — the LIVE half of "last seen".
 *
 * The live dot is the SOCKET: the server broadcasts `comms:presence` to the
 * tenant room when a user's first socket connects and when their last one
 * leaves. This store is the client's half of that — a small external store
 * (useSyncExternalStore) rather than React state, because it is written by
 * socket events that arrive outside any component's render, and read from
 * the conversation list AND the InfoPane at the same time.
 *
 * The PERSISTENT half is `comms_user_presence.last_seen_at` (colleagues
 * endpoint). `lastSeenText()` renders it day-first — the house date form —
 * and it is the honest floor: when the socket is gone, "last seen 27/09/2026
 * at 14:02" is true, and a green dot would be a lie the guide forbids.
 */
import * as React from "react";
import { tv } from "@/lib/i18n";
import { dateDmy } from "@/lib/format";

type OnlineMap = Record<string, boolean>;

let online: OnlineMap = {};
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
}

/** Socket-event entry point (comms-live.tsx). Not a React API. */
export function setOnline(userId: string, isOnline: boolean) {
  if (online[userId] === isOnline) return;
  online = { ...online, [userId]: isOnline };
  emit();
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

function getSnapshot(): OnlineMap {
  return online;
}

/** Is `userId` online right now (a socket is connected somewhere)? */
export function useOnline(userId: string | null | undefined): boolean {
  const snap = React.useSyncExternalStore(subscribe, getSnapshot, () => online);
  return (userId && snap[userId]) || false;
}

/**
 * "Last seen" in the house day-first form, for an offline user:
 *   today      → Last seen today at 14:02
 *   yesterday  → Last seen yesterday at 09:15
 *   older      → Last seen 27/09/2026 at 14:02
 *
 * `null` (never opened since the presence table existed) renders nothing —
 * an empty slot is more honest than an invented timestamp.
 */
export function lastSeenText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  // House forms, not Intl: dateDmy is the one day-first date this app prints
  // everywhere (and the month-first trap Intl's en-US would be), and the time
  // is a 24-hour clock in both principal languages — "14:02" reads the same
  // on both sides of the line, so there is nothing to localise inside it.
  const pad = (v: number) => String(v).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today)) return tv("Last seen today at {{time}}", { time });
  if (sameDay(d, yest)) return tv("Last seen yesterday at {{time}}", { time });
  return tv("Last seen {{date}} at {{time}}", { date: dateDmy(d), time });
}
