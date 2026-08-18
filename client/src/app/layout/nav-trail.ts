/**
 * The navigation trail — where this user has been, in order, and where they can
 * go back or forward to.
 *
 * WHY THIS EXISTS AT ALL, given the browser already has a back button. Two
 * reasons, and the second is the load-bearing one.
 *
 * First, an installed window has no browser chrome. `display_override:
 * ["window-controls-overlay"]` (src/routes/pwa.js) tells the OS to stop drawing
 * a title bar and hands the strip to the page — which also means it stops
 * drawing back and forward. A dispatcher running Praxis as an app therefore had
 * no pointer route backwards at all.
 *
 * Second, the browser's own control is a black box. There is no API that says
 * whether a forward entry exists, and none that says what is behind you. So a
 * button wired to `history.back()` can only ever be permanently enabled and
 * permanently unlabelled — it cannot grey out at the start of a session, and it
 * cannot tell you that pressing it lands on "Operations · Files". This module
 * is the record that makes both possible.
 *
 * IT DOES NOT REPLACE BROWSER HISTORY, AND THAT IS DELIBERATE. The arrows call
 * `navigate(±1)`, i.e. the real history stack. This file only OBSERVES that
 * stack and keeps a labelled shadow of it. A private stack that navigated by
 * pushing URLs would immediately disagree with the browser's own back button
 * and with the mouse's side buttons — two controls doing almost the same thing
 * is worse than one, and the divergence would only show up on the users who
 * have a five-button mouse.
 *
 * ANCHORED ON `history.state.idx`, NOT ON POSITION IN AN ARRAY. React Router's
 * browser history stamps a monotonic `idx` into `window.history.state` for every
 * entry, and the browser persists that state per entry — so it survives a
 * reload, and it survives the automatic reload this app performs when a chunk
 * goes missing after a deploy (lib/chunk-reload.ts). It is the one identifier
 * that means the same thing before and after the page is thrown away, which is
 * what lets a restored trail line back up with the stack it describes.
 */

import {
  AREAS,
  areaForPath,
  areaRoute,
  sectionRoute,
  type Area,
} from "./areas";

/**
 * How many steps back the trail remembers.
 *
 * Not a technical ceiling — the browser's own stack is far deeper and
 * `navigate(-1)` would keep working past this. It is the number the hold-menu
 * can list without becoming a scrollable wall, and past which "where was I"
 * stops being a question anybody actually asks. Steps beyond it fall off the
 * oldest end; the arrows simply stop there rather than walking blind.
 */
export const TRAIL_LIMIT = 25;

/** One place the user has stood. */
export type TrailEntry = {
  /** `window.history.state.idx` — the stack position this entry occupies.
   *  Monotonic within a tab and restored by the browser across a reload. */
  idx: number;
  /** `pathname + search`. What the hold-menu shows the user they will land on,
   *  and what `sameScreen` compares to decide whether closing a record should
   *  step back or rewrite the URL in place. */
  url: string;
  /** The line shown in the hold-menu and the arrow's tooltip. Route-derived
   *  ("Files") until a screen names it better ("Dossier SLS-2481"). */
  label: string;
  /** The area the label sits under ("Operations"), when there is one. */
  context?: string;
  /** Set once a screen has titled this entry through `useTrailTitle`. A
   *  re-visit must not overwrite a record title with the route's generic label
   *  — see `applyLocation`. */
  titled?: boolean;
};

/** The trail, and where in it the user is standing. `at` is an index into
 *  `entries`; -1 only before the first location has been seen. */
export type Trail = { entries: TrailEntry[]; at: number };

export const EMPTY_TRAIL: Trail = { entries: [], at: -1 };

/** React Router's `useNavigationType`, narrowed to what this module branches on. */
export type NavKind = "PUSH" | "REPLACE" | "POP";

/**
 * Fold one location into the trail.
 *
 * THE THREE CASES, and why `PUSH` is the only one that discards anything:
 *
 *   POP / REPLACE onto an entry we already hold  — the user moved through the
 *       stack, or a screen rewrote its own URL. Nothing is lost either side of
 *       them, so entries ahead survive. This is what makes forward work.
 *
 *   PUSH — a new destination. The browser drops its forward entries at this
 *       moment, so ours go with it. Keeping them would offer the user a forward
 *       arrow that `navigate(1)` cannot honour.
 *
 *   An `idx` we have never seen — a jump made outside our observation, e.g. the
 *       browser's own long-press menu skipping six entries. Splice it in by
 *       `idx` rather than resetting: everything either side of it is still on
 *       the real stack and still reachable.
 */
export function applyLocation(
  trail: Trail,
  next: TrailEntry,
  kind: NavKind,
): Trail {
  const held = trail.entries.findIndex((e) => e.idx === next.idx);

  // Standing on an entry we already have. Keep the stored copy — a screen may
  // have named it something the route could never derive — and just move the
  // cursor. Without this, walking back through five dossiers would relabel
  // every one of them "Files" on the way past.
  if (held >= 0 && trail.entries[held].url === next.url) {
    return { entries: trail.entries, at: held };
  }

  const behind = trail.entries.filter((e) => e.idx < next.idx);
  const ahead = trail.entries.filter((e) => e.idx > next.idx);

  return cap({
    entries: kind === "PUSH" ? [...behind, next] : [...behind, next, ...ahead],
    at: behind.length,
  });
}

/**
 * Trim to `TRAIL_LIMIT`, dropping from whichever end the user is further from.
 *
 * The obvious version drops from the front unconditionally, because a PUSH
 * always appends and the cursor is therefore at the end. It is wrong for the
 * other way in: an unrecognised POP can land the cursor near the front with a
 * long tail ahead of it, and dropping from the front there would discard the
 * entry the user is standing on.
 */
function cap({ entries, at }: Trail): Trail {
  while (entries.length > TRAIL_LIMIT) {
    if (at > entries.length - 1 - at) {
      entries = entries.slice(1);
      at -= 1;
    } else {
      entries = entries.slice(0, -1);
    }
  }
  return { entries, at };
}

/** Rename the entry the user is standing on. Used by `useTrailTitle` so a
 *  screen showing one record can say so; a no-op when nothing would change,
 *  which is what keeps the effect that calls it from looping. */
export function titleEntry(trail: Trail, label: string): Trail {
  const cur = trail.entries[trail.at];
  if (!cur || cur.label === label) return trail;
  const entries = trail.entries.slice();
  entries[trail.at] = { ...cur, label, titled: true };
  return { entries, at: trail.at };
}

/** The entry `delta` steps away, or undefined if the trail does not reach. */
export function targetOf(trail: Trail, delta: number): TrailEntry | undefined {
  return trail.entries[trail.at + delta];
}

/** Can the user move `delta` steps? */
export function canGo(trail: Trail, delta: number): boolean {
  return targetOf(trail, delta) !== undefined;
}

/**
 * The steps available in one direction, NEAREST FIRST.
 *
 * Nearest first because that is the order the hold-menu reads in — "one back,
 * two back, three back" — and because the top item of an opened menu is the
 * one the pointer is already closest to, which should be the same destination
 * the plain click would have gone to.
 */
export function stepsFrom(
  trail: Trail,
  direction: -1 | 1,
): { entry: TrailEntry; delta: number }[] {
  const out: { entry: TrailEntry; delta: number }[] = [];
  for (let d = direction; ; d += direction) {
    const entry = trail.entries[trail.at + d];
    if (!entry) return out;
    out.push({ entry, delta: d });
  }
}

/** Two urls showing the same screen, ignoring query. Lets a record close by
 *  stepping BACK when the entry behind is the list it opened from, instead of
 *  pushing a second copy of that list onto the stack. */
export function sameScreen(a: string, b: string): boolean {
  return a.split("?")[0] === b.split("?")[0];
}

/** A path segment that is an id rather than a word — uuid or a long opaque
 *  token. Never a useful label, so `prettify` skips over them. */
function isOpaque(seg: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      seg,
    ) || /^[0-9a-z]{16,}$/i.test(seg)
  );
}

/** Last meaningful segment of a path, as a human word. The fallback for routes
 *  `areas.ts` does not describe — better a capitalised slug than an empty row. */
function prettify(pathname: string): string {
  const segs = pathname.split("/").filter((s) => s && !isOpaque(s));
  const last = segs[segs.length - 1];
  if (!last) return "Control Tower";
  const words = last.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What to call a route.
 *
 * Read from `areas.ts` — the same definitions the ribbon and the hub tabs
 * render from — so the trail calls a screen exactly what the chrome that
 * navigated to it called it. Deriving names a second way here would produce a
 * back tooltip saying "Operation files" for a tab the ribbon labels "Files",
 * and nothing would ever fail to catch the drift.
 */
export function labelForPath(pathname: string): {
  label: string;
  context?: string;
} {
  const area: Area | undefined = areaForPath(pathname);
  if (!area) return { label: prettify(pathname) };
  if (pathname === areaRoute(area) || pathname === area.basePath) {
    return { label: area.label };
  }
  const section = area.sections.find((s) => {
    const to = sectionRoute(area, s);
    return pathname === to || pathname.startsWith(to + "/");
  });
  if (section) return { label: section.label, context: area.label };
  return { label: prettify(pathname), context: area.label };
}

/** Areas whose landing route is its own label — used only by the tests, to pin
 *  that every area in the model resolves to something a user would recognise. */
export const LABELLED_AREAS = AREAS;

/**
 * WHERE THE TRAIL IS KEPT: `sessionStorage`, and the choice is the feature.
 *
 * Per TAB, so two windows open on two dossiers each have their own trail and
 * neither back button lies about the other's history. Survives a reload — the
 * plain F5, and the involuntary one this app performs when a deploy removes the
 * chunk a tab was holding — because `history.state.idx` survives it too, so the
 * restored trail still describes the stack it is sitting on. Gone when the tab
 * closes, which is correct: a stack the browser has thrown away must not leave
 * a forward arrow pointing at it.
 */
const STORE_KEY = "praxis.navTrail.v1";

export function loadTrail(storage?: Storage): Trail {
  const s = storage ?? safeSession();
  if (!s) return EMPTY_TRAIL;
  let raw: string | null = null;
  try {
    raw = s.getItem(STORE_KEY);
  } catch {
    /* @silent:storage — a locked-down or full store; the trail simply starts
       empty, and both arrows are correctly greyed until the user moves */
    return EMPTY_TRAIL;
  }
  if (!raw) return EMPTY_TRAIL;
  try {
    const parsed = JSON.parse(raw) as Trail;
    if (!parsed || !Array.isArray(parsed.entries)) return EMPTY_TRAIL;
    // Validated rather than trusted: this is our own write, but it is also a
    // string any extension or an older build of the app could have left behind,
    // and a malformed entry would render an undefined label into the menu.
    const entries = parsed.entries.filter(
      (e): e is TrailEntry =>
        !!e && typeof e.idx === "number" && typeof e.url === "string",
    );
    const at = Math.min(Math.max(parsed.at ?? -1, -1), entries.length - 1);
    return { entries, at };
  } catch {
    /* @silent:parse — a half-written or foreign value; starting from empty is
       always safe, and the next navigation repopulates it */
    return EMPTY_TRAIL;
  }
}

export function saveTrail(trail: Trail, storage?: Storage): void {
  const s = storage ?? safeSession();
  if (!s) return;
  try {
    s.setItem(STORE_KEY, JSON.stringify(trail));
  } catch {
    /* @silent:storage — quota or a blocked store. The in-memory trail is
       unaffected; only its survival across a reload is lost */
  }
}

/** `sessionStorage` behind a guard: accessing it throws outright in a sandboxed
 *  frame and in some privacy modes, before any read is even attempted. */
function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    /* @silent:storage — no session storage available in this context */
    return null;
  }
}
