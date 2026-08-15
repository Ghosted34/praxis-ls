/**
 * The shell's first paint, and what to do when the answer behind it moves.
 *
 * WHY A CACHE AT ALL. `GET /permissions/mine` decides how many tabs the ribbon
 * has and which shortcuts the rail holds — that is, it decides the HEIGHT and
 * the contents of two bands of chrome that every screen renders inside. A shell
 * that waits for it renders nothing, then 93px of ribbon, and the content column
 * jumps down the page on every cold start. So the last answer is remembered and
 * drawn immediately, and the network read revalidates behind it.
 *
 * THE PRECEDENT IS ALREADY IN THIS CODEBASE. `praxis.titlebar.{dark,light}`
 * (lib/pwa-config.ts) remembers the resolved title-bar colour so the pre-boot
 * frame in index.html paints the tenant's bar instead of guessing white. Same
 * shape of problem, same shape of answer: cache the resolved value of a
 * network-derived piece of CHROME, because the alternative is a visible wrong
 * first frame.
 *
 * ── WHY THE KEY CARRIES A USER ID ────────────────────────────────────────────
 *
 * Two people share a machine far more often in a logistics office than in a
 * consumer app — a dispatch desk, a warehouse terminal, a shared workstation on
 * a night shift. A single unkeyed record would paint the previous user's ribbon
 * for the first frame of the next user's session. That frame is not merely wrong,
 * it names modules the incoming user may have no business knowing exist. Keyed
 * per user, a cold user is a cache MISS and gets the skeleton.
 *
 * It is still only a hint about CHROME. Nothing here is an authorisation
 * decision: the API refuses what it refuses regardless of what this file
 * remembers, and a tampered record buys a wrong-looking ribbon over screens that
 * still 403.
 *
 * ── GRANT vs REVOCATION ──────────────────────────────────────────────────────
 *
 * `classifyAccessChange` is the whole reason the endpoint returns `modules` and
 * not just `version`. The digest says "something changed"; only the sets say
 * WHICH, and the two cases must not be handled the same way:
 *
 *   REVOCATION — a hard refresh, at once. A user must not keep interacting with
 *   a view of a module they are no longer authorised to see, and unsaved work in
 *   that view is work they are no longer entitled to submit.
 *
 *   GRANT — a banner, and nothing else. Gaining a module cannot expose anything,
 *   so there is no security clock running, and destroying whatever somebody is
 *   halfway through typing to deliver good news is a straight loss.
 *
 * A change that both gains and loses counts as a REVOCATION. Security decides
 * first; the gain is picked up by the same reload.
 */
import { coerceNavAccess, type NavAccess } from "./nav-access";

/** Bumped when the record's shape changes, so an old one is a miss rather than
 *  a wrong ribbon. Reading still goes through `coerceNavAccess` as well —
 *  belt and braces, because a stale record reaches the render before the
 *  network can correct it. */
const SCHEMA = 1;

const ACCESS_KEY = (userId: string) => `praxis.nav-access.${SCHEMA}.${userId}`;

/**
 * The ribbon's pinned state, mirrored locally.
 *
 * NOT A SECOND SOURCE OF TRUTH — `/me/preferences/shell` remains that. This is
 * here because `ribbonPinned` is the one preference that changes the chrome's
 * HEIGHT (pinned is two rows, collapsed is one and row B floats), so a shell
 * that painted the cached ribbon at the default height and then learned the user
 * had collapsed it would shift by a whole row — reintroducing, through the back
 * door, exactly the jump the access cache exists to remove.
 *
 * Not per user: unlike the module set it says nothing about anyone's access, and
 * a shared terminal briefly showing the previous user's ribbon HEIGHT is not a
 * disclosure. Keeping it unkeyed also means it survives the cache being cleared
 * on a revocation, which is right — a revocation is not a reason to forget how
 * somebody likes their chrome.
 */
const PINNED_KEY = "praxis.ribbon-pinned";

/** localStorage throws in private mode and when the origin has storage
 *  disabled. Every access here is best-effort: no cache is a slower first
 *  paint, never a broken one. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    /* @silent:storage — access can throw in private mode */
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* @silent:storage — private mode or full quota; the shell falls back to the skeleton */
  }
}

function drop(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* @silent:storage — nothing to drop; storage was unavailable */
  }
}

/**
 * The last answer this user saw, or `null` for a cache miss.
 *
 * `null` for a missing user id too: an anonymous read has no owner, and serving
 * one record to "whoever asks" is the shared-terminal leak this key exists to
 * prevent.
 */
export function readCachedAccess(
  userId: string | null | undefined,
): NavAccess | null {
  if (!userId) return null;
  const raw = read(ACCESS_KEY(userId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const access = coerceNavAccess(parsed);
    // An empty set is indistinguishable from a coerced-away corrupt record, and
    // "this user can see nothing" is not worth caching: the skeleton is a better
    // first frame than a ribbon that is correctly empty but probably wrong.
    return access.modules.length === 0 ? null : access;
  } catch {
    /* @silent:parse — corrupt cache entry from an older build; a null return means "cache miss" */
    return null;
  }
}

export function writeCachedAccess(
  userId: string | null | undefined,
  access: NavAccess,
): void {
  if (!userId) return;
  write(ACCESS_KEY(userId), JSON.stringify(access));
}

/**
 * Forget what this user was allowed to see.
 *
 * CALLED BEFORE THE RELOAD, NOT AFTER, and that ordering is what makes the
 * revocation path terminate. Reload first and the next boot paints the revoked
 * ribbon from cache, diffs it against the same fresh answer, and reloads again —
 * forever. Clearing first turns the next boot into a cache miss: skeleton,
 * fresh read, no delta, no second reload.
 */
export function clearCachedAccess(userId: string | null | undefined): void {
  if (!userId) return;
  drop(ACCESS_KEY(userId));
}

/** `null` when the user has never chosen — same meaning as the API's null. */
export function readCachedRibbonPinned(): boolean | null {
  const raw = read(PINNED_KEY);
  return raw === "1" ? true : raw === "0" ? false : null;
}

export function writeCachedRibbonPinned(pinned: boolean): void {
  write(PINNED_KEY, pinned ? "1" : "0");
}

export type AccessChange =
  /** The visible set is identical. The response may still differ (the digest
   *  covers more than the module list) — it just changes nothing the user can
   *  reach, so it is adopted silently. */
  | { kind: "same" }
  /** At least one module went away. Gains, if any, ride along on the reload. */
  | { kind: "revoked"; lost: string[]; gained: string[] }
  | { kind: "granted"; gained: string[] };

/** Case-insensitive because one side of a comparison may have come from a cache
 *  written before the server started upper-casing, and a casing difference must
 *  never read as a revocation — that would hard-refresh the user for nothing. */
const setOf = (keys: string[]): Set<string> =>
  new Set(keys.map((k) => String(k).toUpperCase()));

/**
 * What changed between the answer the UI is drawn from and the fresh one.
 *
 * A missing `cached` is "nothing to compare against", which is a first paint,
 * not a grant — announcing every module a user has as newly granted on their
 * first login would make the banner meaningless.
 */
export function classifyAccessChange(
  cached: NavAccess | null,
  fresh: NavAccess,
): AccessChange {
  if (!cached) return { kind: "same" };

  const before = setOf(cached.modules);
  const after = setOf(fresh.modules);

  const lost = [...before].filter((k) => !after.has(k)).sort();
  const gained = [...after].filter((k) => !before.has(k)).sort();

  if (lost.length > 0) return { kind: "revoked", lost, gained };
  if (gained.length > 0) return { kind: "granted", gained };
  return { kind: "same" };
}

/**
 * A stable name for "this particular change", so a dismissed banner stays
 * dismissed.
 *
 * The SET, not the server's `version`: the digest also covers the taxonomy, so a
 * module being regrouped would mint a new version, fail to match the dismissal,
 * and pop the banner back up over a change the user has already dismissed and
 * which grants them nothing new.
 */
export const accessSignature = (access: NavAccess): string =>
  setOf(access.modules).size +
  ":" +
  [...setOf(access.modules)].sort().join(",");
