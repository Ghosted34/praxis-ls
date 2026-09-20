/** Compact KPI stat bar — a single slim strip of stats above a list screen,
 *  so four numbers don't eat the vertical space four cards used to. Each tile is
 *  an inline `icon · value · label` cluster; on desktop they share one divided
 *  row, on mobile they sit in a two-up grid of cards. Values use the `.num`
 *  tabular class. Optional `tone` tints the icon; `delta` shows a trend chip.
 *  Props are unchanged from the previous card version, so every existing screen
 *  inherits this for free.
 *
 *  Passing `onClick` makes the tile a real `<button>` — used by the party 360
 *  KPI strip, where each tile drills into a paginated list of the underlying
 *  rows and deep-links them to their module.
 *
 *  ── THE TWO LAYOUTS ────────────────────────────────────────────────────────
 *
 *  INLINE (the default) is `value label` on one line. It is right above a LIST,
 *  where the strip is chrome for the table under it and the figures are short
 *  counts.
 *
 *  STACKED is the value on its own line with the label under it. It is what the
 *  360s use, and the reason is width: a record's headline figures are money in
 *  full precision ("30,000,000.00 XAF"), five or six to a row, and inline they
 *  spend the tile's width on the number and truncate the word that says what
 *  the number IS — the reader is left with "30,000,000.0… Credit ava…". Stacked,
 *  each line gets the whole tile.
 *
 *  Set it once on the row (`<KpiRow stack>`) rather than per tile; the tiles
 *  inherit it through context, so a strip cannot end up half-stacked. A single
 *  tile can still opt in on its own — the costing worksheet's totals row does.
 *
 *  ── THE PHONE LAYOUT, AND THE 208px TILE (Phase 6) ─────────────────────────
 *
 *  Below `md` the strip is a two-column grid of small cards, and every tile is
 *  two-line whatever `stack` says. This replaced a defect rather than a taste:
 *  `basis-[13rem]` compiles to `flex-basis: 13rem` and lands AFTER `.flex-1`'s
 *  `flex: 1 1 0%` in the stylesheet, so it won the cascade — and below `sm` the
 *  row was `flex-col`, which makes flex-basis the VERTICAL axis. Every KPI tile
 *  on every 360 was therefore 208px tall, plus `flex-grow` on top of it, so a
 *  five-tile strip was ~1100px of a 780px-tall phone screen and a reader
 *  scrolled past a column of half-empty boxes to reach the tabs. The tile is a
 *  grid item now and no basis is applied to it at all, which fixes that by
 *  construction rather than by remembering to prefix the class.
 *
 *  ── THE SECOND BRAND ACCENT ───────────────────────────────────────────────
 *
 *  On a phone a compact tile carries a 3px leading edge and, for the default
 *  `accent` tone, a blue icon chip on it. That is `--brand-blue`, the app's
 *  existing secondary accent (the `info` tone, the charts, `brand-blue-ink`),
 *  not a new colour: it is already in the token set, already measured against
 *  every surface it is used on, and it is NOT the tenant's `--primary`, so it
 *  needs no new white-label work.
 *
 *  The rule it expresses is the one thing a phone-sized KPI band has to get
 *  right: ORANGE IS FOR ACTIONS (the one primary button, the active tab, a
 *  link), BLUE IS FOR DATA. A band of five orange-accented tiles directly above
 *  an orange "Add document" button and an orange tab underline reads as five
 *  more things to press. The semantic tones are untouched — `ok`/`warn`/`bad`
 *  still mean what they meant, on the edge and on the chip, because a figure
 *  that needs attention has to look like one. */
import * as React from "react";
import { cn } from "@/lib/cn";
import { useIsCompact } from "@/lib/use-media-query";
import { ChevronIcon } from "@/components/ui/icons";

const TONE: Record<string, string> = {
  accent:
    "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-ink",
  ok: "bg-[rgb(var(--ok)_/_0.12)] text-[rgb(var(--ok))]",
  warn: "bg-[rgb(var(--warn)_/_0.15)] text-[rgb(var(--warn))]",
  bad: "bg-[rgb(var(--bad)_/_0.12)] text-[rgb(var(--bad))]",
  info: "bg-[rgb(var(--brand-blue)_/_0.12)] text-[rgb(var(--brand-blue-ink))]",
};

/** The 3px leading edge on a compact tile. Same tones as the chip — the edge is
 *  the tile's tone stated once at a glance, so a column of tiles can be read for
 *  "which of these needs me" without reading a single label. */
const EDGE: Record<string, string> = {
  accent: "border-l-brand-blue",
  ok: "border-l-[rgb(var(--ok))]",
  warn: "border-l-[rgb(var(--warn))]",
  bad: "border-l-[rgb(var(--bad))]",
  info: "border-l-brand-blue",
};

/** Set by `<KpiRow stack>`, read by every `<KpiTile>` under it. A tile's own
 *  `stack` prop still wins, so the row sets the house style and a tile can
 *  disagree. */
const StackContext = React.createContext(false);

export function KpiTile({
  label,
  value,
  hint,
  icon,
  delta,
  tone = "accent",
  onClick,
  ariaLabel,
  stack,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  delta?: { value: React.ReactNode; dir?: "up" | "down" };
  tone?: "accent" | "ok" | "warn" | "bad" | "info";
  /** When provided, the tile renders as a `<button>` and reacts to clicks. */
  onClick?: () => void;
  /** Accessible name override for the button variant (defaults to "Open <label>"). */
  ariaLabel?: string;
  /** Two-line layout: value on top, label + hint underneath. Defaults to what
   *  the enclosing `<KpiRow>` asked for, which is how the 360s turn it on for a
   *  whole strip at once. Set it here only to override that. */
  stack?: boolean;
}) {
  const rowStack = React.useContext(StackContext);
  const compact = useIsCompact();
  // A phone tile is ~150px of usable width, which is not enough for a
  // full-precision money figure AND the word naming it side by side — so the
  // two-line layout is not a preference down there, it is the only one that
  // fits. `stack` still governs from `md` up.
  const twoLine = compact || (stack ?? rowStack);

  const valueTitle =
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : undefined;

  // The default accent is blue on a phone. See the header: orange is the
  // action colour, and a KPI band is not an action.
  const chipTone = compact && tone === "accent" ? TONE.info : TONE[tone];

  const iconEl = icon ? (
    <span
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center rounded-md text-[14px]",
        chipTone,
      )}
    >
      {icon}
    </span>
  ) : null;

  const deltaTone =
    delta?.dir === "down" ? "text-[rgb(var(--bad))]" : "text-[rgb(var(--ok))]";
  const deltaClass = cn("ml-auto shrink-0 text-[11px] font-semibold", deltaTone);

  // A drill-in tile is a button, and a phone has no hover state to say so. The
  // chevron is the whole affordance — small, muted, and the same one the app's
  // index rows use for the same job.
  const chevron =
    compact && onClick ? (
      <ChevronIcon
        width={14}
        height={14}
        className="-rotate-90 shrink-0 text-muted-foreground"
      />
    ) : null;

  // Stacked: the value is the headline and the label + hint are the subtitle on
  // their own row. Used by every 360 strip and by the costing worksheet's
  // totals, where inline would read "16,924,000 XAF Subtotal (HT) of which
  // débours…" — the shape both were trying to escape.
  const stackedBody = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        {iconEl}
        <span
          className={cn(
            "num min-w-0 truncate font-semibold leading-none",
            compact ? "text-[17px]" : "text-[18px]",
          )}
          title={valueTitle}
        >
          {value}
        </span>
        {(delta || chevron) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {delta && (
              <span className={cn("text-[11px] font-semibold", deltaTone)}>
                {delta.value}
              </span>
            )}
            {chevron}
          </span>
        )}
      </span>
      {/* Wraps rather than truncates: down here the hint is a real qualifier
          ("of which débours 16,824,000.00 XAF", "oldest 12/03/2026"), and a
          reader who loses it to an ellipsis is a reader who never sees why the
          figure above is what it is.

          The label and the hint each get their OWN span rather than sitting as
          two text nodes in this one. Testing Library matches on an element's
          direct text, so "Open pipeline" and "43.2M XAF weighted" merged into a
          single node makes `getByText("Open pipeline")` miss — which is exactly
          what the Lead 360's loading test caught. Same reason the inline layout
          has always kept them apart. */}
      <span
        className={cn(
          "leading-snug text-muted-foreground",
          compact ? "text-[11px]" : "text-[12px]",
        )}
        title={hint ? `${label} · ${hint}` : label}
      >
        <span>{label}</span>
        {hint ? (
          <>
            {" · "}
            <span>{hint}</span>
          </>
        ) : null}
      </span>
    </>
  );

  const inlineBody = (
    <>
      {iconEl}
      {/* `min-w-0 truncate` + the title attribute are the overflow fix — see
          the note on KpiRow. A long value had nothing constraining it, so it
          WRAPPED onto a second line and shoved the hint out of the card. */}
      <span
        className="num min-w-0 truncate text-[18px] font-semibold leading-none"
        title={valueTitle}
      >
        {value}
      </span>
      <span className="truncate text-[12px] text-muted-foreground" title={label}>
        {label}
      </span>
      {delta && <span className={deltaClass}>{delta.value}</span>}
      {hint && !delta && (
        // NOT `shrink-0`. That is what put the hint outside the card: it refused
        // to give up any width, so when the row ran out it was laid out past the
        // right edge and clipped by the container's `overflow-hidden` — the
        // reader saw "43,200,000.00 XAF we". It may shrink and truncate now, and
        // it still wins its space before the label does.
        <span
          className="ml-auto min-w-0 max-w-[55%] truncate text-[11px] text-muted-foreground"
          title={hint}
        >
          {hint}
        </span>
      )}
    </>
  );

  // One shell for both layouts and both elements, so the button variant cannot
  // drift from the static one — which is exactly what happened while `stack`
  // returned early: a stacked tile silently lost its `onClick`.
  const shell = cn(
    "flex min-w-0",
    compact
      ? // A self-contained card in the row's two-up grid: its own border,
        // radius, surface and leading edge. The tile IS the card down here —
        // there is no strip around it to divide, and a 2px gutter between two
        // bordered boxes reads better than one more hairline.
        cn(
          "flex-col justify-center gap-1 rounded-lg border border-l-[3px] bg-card px-3 py-2.5 shadow-[var(--shadow-s)]",
          EDGE[tone],
        )
      : // The desktop strip's segment, unchanged: it shares the row's border,
        // its dividers and its surface, and only the inline basis is its own.
        cn(
          "flex-1 px-4 py-2.5",
          twoLine ? "basis-[13rem] flex-col justify-center gap-1" : "basis-[9rem] items-center gap-2.5",
        ),
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel || `Open ${label}`}
        // The tile keeps the same footprint as the static variant; the button
        // just adds hover feedback, keyboard focus and a pointer cursor so the
        // drill-in affordance reads without a chrome change.
        className={cn(
          shell,
          "text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        )}
      >
        {twoLine ? stackedBody : inlineBody}
      </button>
    );
  }

  return <div className={shell}>{twoLine ? stackedBody : inlineBody}</div>;
}

/**
 * The strip. Tiles share one divided row on desktop and a two-up grid of cards
 * on a phone.
 *
 * ── THE OVERFLOW FIX (and what was actually wrong) ──────────────────────────
 * Three things combined to push content out of this card, and all three had to
 * go. Measured in a real browser against the built stylesheet, on the Lead 360's
 * five-tile strip, at 1440 / 1024 / 820 / 640px — it failed at ALL of them, so
 * this was never only a small-screen problem:
 *
 *   1. `min-w-[9rem]` with no `min-w-0` meant a tile could not shrink below its
 *      content. Five tiles then demanded more than the row had, and the excess
 *      was simply laid out past the right edge.
 *   2. The value had no `truncate`, so a long figure wrapped to a second line
 *      and made the strip two rows tall.
 *   3. The hint was `shrink-0`, so it refused to yield width and was the piece
 *      that ended up outside the card, half-clipped.
 *
 * Now: the basis is 9rem (the old intent — every tile gets a fair share) but the
 * minimum is 0 (so it can yield), text truncates rather than wrapping, and the
 * strip WRAPS to a second line instead of overflowing when the tiles genuinely
 * cannot fit. Titles keep the full text one hover away.
 *
 * ── `fit` ───────────────────────────────────────────────────────────────────
 * By default every tile takes an equal share, which is right when the values are
 * short and similar — most of the 40-odd screens using this. `fit="content"`
 * switches to `flex: 1 1 auto`, so a tile carrying "72M XAF · Open pipeline ·
 * 43.2M XAF weighted" is given the room it needs and the neighbours give it up.
 * Opt-in rather than the default precisely so no existing strip changes shape.
 *
 * ── `stack` ─────────────────────────────────────────────────────────────────
 * Two lines per tile — the figure, then what it is — for every tile in the row.
 * This is the 360 house style (FRONTEND_GUIDE §3.11): a record's headline band
 * carries money at full precision, and inline the number eats the width its own
 * label needed. List screens stay inline, where the strip is chrome above a
 * table and the figures are short counts.
 */
export function KpiRow({
  children,
  fit = "equal",
  stack = false,
}: {
  children: React.ReactNode;
  /** `equal` (default) — every tile the same width. `content` — sized to what
   *  each tile holds, for strips mixing a long money figure with short counts. */
  fit?: "equal" | "content";
  /** Two-line tiles: value on top, label (and hint) under it. The 360 strips
   *  set this; a tile may still override it with its own `stack`. */
  stack?: boolean;
}) {
  const compact = useIsCompact();

  // Two shells, and only one of them is ever in the document — the grid (one
  // per breakpoint) is the layout, and `divide-y`/`divide-x` cannot express it.
  // The desktop classes are byte-for-byte what this row has always rendered, so
  // a screen that never sees a phone is unchanged.
  const shell = compact
    ? "mb-4 grid grid-cols-2 gap-2"
    : cn(
        // A ROW, unconditionally — never `flex-col`. The column form is what
        // turned `basis-[13rem]` into a 208px height (see the header), and the
        // only window in which it could still apply is the frame before
        // `matchMedia` answers on a phone, where it would re-create the exact
        // layout shift this change removes. Wrapping is the correct fallback
        // instead: tiles stay one line tall and the strip takes a second row.
        "mb-4 flex flex-wrap divide-x overflow-hidden rounded-[10px] border bg-card shadow-[var(--shadow-s)]",
        fit === "content" && "[&>*]:flex-auto [&>*]:basis-auto",
      );

  return (
    <StackContext.Provider value={stack}>
      <div className={shell}>{children}</div>
    </StackContext.Provider>
  );
}
