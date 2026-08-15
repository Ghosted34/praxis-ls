/**
 * What the chrome looks like on a first login, before the permissions read has
 * ever answered on this device.
 *
 * WHY NOT NOTHING. The ribbon used to render `null` until the read settled, and
 * the comment there argued a shimmer for a 40ms read is more motion than
 * information. That argument is right about the SHIMMER and wrong about the
 * BOX: rendering nothing means the ribbon has no height, so the content column
 * starts 93px up the page and drops when the answer lands. On a fast connection
 * that is a flicker; on a cold cache behind a slow link it is a page that
 * visibly reassembles itself, and it happens under the splash on some sessions
 * and in plain view on others.
 *
 * WHY NOT A SPINNER. A spinner says "something is happening". This says "this is
 * what is about to be here", and — the actual point — it occupies the exact
 * space the real thing will. `components/ui/skeleton.tsx` already makes that
 * argument for tables; the chrome is the place it matters most, because
 * everything else on the page is positioned relative to it.
 *
 * ── HOW THE STRUCTURE IS KEPT HONEST ─────────────────────────────────────────
 *
 * The placeholder and the real ribbon share the same `.ribbon` / `.ribbon-row`
 * / `.ribbon-track` classes, so their heights come from the same CSS custom
 * properties (`--ribbon-row-h`, and the density variants of it) rather than
 * from a number copied into this file that would drift the first time somebody
 * adjusts the real one. `ribbon.test.tsx` compares the two DOM shapes directly.
 *
 * ── THE GENERIC TAB COUNT ────────────────────────────────────────────────────
 *
 * Four. Access is per-role, so the honest answer is unknown — but the track is
 * a bounded control sized to its contents (see `.ribbon-track`), so the count
 * changes its WIDTH, not the layout around it. Four is the middle of the real
 * range of one to six, which makes the settle a small horizontal adjustment in
 * either direction rather than a large one in a predictable direction.
 *
 * ── MOTION ───────────────────────────────────────────────────────────────────
 *
 * `Skeleton` shimmers with Tailwind's `animate-pulse`. It is over the 250ms
 * budget and it loops, and it is exempt for a stated reason in
 * `scripts/check-motion.mjs` — which this change also taught to SEE framework
 * animations, since a Tailwind base-theme keyframe appears neither in index.css
 * nor in the config's `animation` block and was therefore outside the gate
 * entirely. Reduced motion is honoured by the global kill in index.css, which
 * the same gate asserts is still there.
 */
import { Skeleton } from "@/components/ui/skeleton";

/** Widths that read as words rather than as bars. Fixed rather than random so
 *  the placeholder does not reshuffle itself on every re-render. */
const TAB_W = ["w-24", "w-20", "w-24", "w-16"];
const ITEM_W = ["w-16", "w-20", "w-14", "w-24", "w-16"];

/**
 * The ribbon's shape, with nothing in it yet.
 *
 * `aria-hidden` and no `role="status"`: the shell has ONE loading region to
 * announce and it is the content column (`PageSkeleton` carries the live
 * region). A screen reader being told "loading" twice on every cold start —
 * once for the furniture, once for the page — is noise, and the furniture is
 * the half the user did not ask for.
 */
export function RibbonSkeleton() {
  return (
    <header
      className="ribbon relative z-30 hidden flex-none flex-col md:flex"
      aria-hidden
    >
      <div className="ribbon-row flex items-center gap-3 px-4 md:px-6">
        <div className="ribbon-track">
          {TAB_W.map((w, i) => (
            <span key={i} className="ribbon-tab">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className={`h-3 ${w}`} />
            </span>
          ))}
        </div>
        <div className="flex-1" />
        {/* The pin holds the right end of row A at every tab count — including
            this one, or the placeholder would read as left-weighted in a way
            the resolved ribbon never does. */}
        <span className="ribbon-pin">
          <Skeleton className="h-[15px] w-[15px] rounded" />
        </span>
      </div>

      <div className="ribbon-row flex items-center gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-1">
          {ITEM_W.map((w, i) => (
            <span key={i} className="ribbon-item">
              <Skeleton className={`h-3 ${w}`} />
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

/**
 * The rail's pinned middle, before the access read says which areas exist.
 *
 * Four cells, matching `DEFAULT_RAIL_PINS`. The rail's fixed ends (Control
 * Tower, search, the quick actions, the editor) are NOT placeholders: they do
 * not depend on the read, so they render as themselves from the first frame and
 * only the part that is genuinely unknown shimmers.
 */
export function RailPinsSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="rail-btn" aria-hidden>
          <Skeleton className="h-[18px] w-[18px] rounded" />
        </span>
      ))}
    </>
  );
}
