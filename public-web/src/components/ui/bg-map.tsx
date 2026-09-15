/**
 * The decorative map behind a hero band (doc/UI_UPGRADE_PLAN.md §6.7) — their
 * `quote-portal__bg-map` and `track-page__bg-map`.
 *
 * ── INLINE SVG, NOT AN IMAGE REQUEST ──────────────────────────────────────
 *
 * A decorative background that costs a network round trip on first paint is a
 * decorative background that arrives after the hero it was meant to decorate,
 * as a flash of texture over copy somebody is already reading. Inline, it is
 * part of the markup and it is there or it is nothing.
 *
 * ── WHY THESE SHAPES ──────────────────────────────────────────────────────
 *
 * Not a world map. A traced coastline is either recognisable — and then wrong,
 * because it is decoration standing where a real route map would mean
 * something — or unrecognisable, and then it is noise that costs bytes. This is
 * a lane field: long shallow arcs of the kind a schedule diagram uses, with
 * nodes where they meet. It reads as movement without claiming to be anywhere.
 *
 * At 4% of `--ink` it is under the text's contrast floor by a wide margin, and
 * `--ink` inverts with the theme so it follows the band it sits behind.
 */
export function BgMap({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 1200 400"
      preserveAspectRatio="xMidYMid slice"
      className={
        "pointer-events-none absolute inset-0 h-full w-full text-[rgb(var(--ink))] opacity-[0.04] " +
        (className || "")
      }
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M-40 300C180 300 300 120 520 120S860 300 1240 220" />
        <path d="M-40 200C220 200 340 40 640 40s420 200 640 140" />
        <path d="M-40 360C240 360 420 260 700 260s360 80 540 40" />
      </g>
      <g fill="currentColor">
        <circle cx="180" cy="264" r="4" />
        <circle cx="520" cy="120" r="5" />
        <circle cx="640" cy="40" r="4" />
        <circle cx="700" cy="260" r="4" />
        <circle cx="960" cy="196" r="5" />
      </g>
    </svg>
  );
}
