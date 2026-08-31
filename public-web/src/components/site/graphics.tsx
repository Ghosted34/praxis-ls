import * as React from "react";
import { cn } from "@/lib/cn";
import { useRevealed } from "@/components/ui/reveal";

/**
 * The two graphics this app draws by hand, in the brand's node-network language:
 * **orange nodes, orange 1px connectors, slate structure**
 * (`doc/BRAND_GUIDELINES.md` §2 — "every diagram on the site … is drawn in it").
 *
 * WHY SVG AND NOT PHOTOGRAPHY. Three reasons, and the first is a rule rather than
 * a taste: `doc/WEB_BUILD_BRIEF.md` N12 forbids stock photos of people and any
 * fact not present in the source documents, and this app has no image library and
 * no rights to one. The second is the tenant: an unbranded tenant has no photos,
 * and a hero that ships a stranger's face until they upload theirs is a bug that
 * appears on the day it matters. The third is the meter — these are a few hundred
 * bytes of path data where a hero JPEG is 200 kB, against a 600 kB page budget.
 *
 * Both are `aria-hidden`, and both carry no invented facts: no port names, no
 * vessel names, no percentages that purport to be somebody's shipment. The copy
 * beside them is what says something.
 *
 * Every colour is a token, so a tenant re-brand repaints the diagram along with
 * the page.
 */

/** The route ribbon: legs and nodes. The dash marches, so it reads as movement
 *  rather than as a wireframe — and stops entirely under `prefers-reduced-motion`
 *  via the global rule in `index.css`. */
export function RouteGraphic({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 360"
      aria-hidden
      focusable="false"
      className={cn("h-auto w-full", className)}
      fill="none"
    >
      {/* Slate structure — the grid the lanes are routed on. */}
      <g stroke="currentColor" strokeOpacity="0.18" strokeWidth="1">
        <path d="M0 90h640M0 180h640M0 270h640" />
        <path d="M160 0v360M320 0v360M480 0v360" />
      </g>

      {/* Three legs, three modes, in the transport colours the Control Tower map
          uses (`--mode-sea/-air/-road`): the marketing site and the product draw
          the same fact the same way. */}
      <g strokeWidth="1.5" strokeLinecap="round">
        <path
          d="M60 268 C 150 268 170 150 268 150"
          stroke="rgb(var(--mode-sea))"
          strokeDasharray="6 6"
          className="animate-lane-sea"
        />
        <path
          d="M268 150 C 370 150 390 60 492 60"
          stroke="rgb(var(--mode-air))"
          strokeDasharray="4 8"
          className="animate-lane-air"
        />
        <path
          d="M268 150 C 360 150 380 240 492 240"
          stroke="rgb(var(--mode-road))"
          strokeDasharray="6 6"
          className="animate-lane-road"
        />
      </g>

      {/* Orange nodes: a central one, radiating spokes, terminal dots. */}
      <g>
        <circle cx="268" cy="150" r="9" fill="var(--primary)" />
        <circle
          cx="268"
          cy="150"
          r="16"
          stroke="var(--primary)"
          strokeOpacity="0.4"
        />
        <circle cx="60" cy="268" r="4.5" fill="var(--primary)" />
        <circle cx="492" cy="60" r="4.5" fill="var(--primary)" />
        <circle cx="492" cy="240" r="4.5" fill="var(--primary)" />
        <path
          d="M268 150 240 96M268 150l40-46M268 150l-30 60"
          stroke="var(--primary)"
          strokeOpacity="0.5"
          strokeWidth="1"
        />
      </g>
    </svg>
  );
}

export type PreviewStage = {
  label: string;
  state: "done" | "current" | "next";
};

/**
 * The portal band's figure: what a client's tracking panel looks like.
 *
 * Drawn rather than screenshotted because `scripts/marketing/capture-screens.mjs`
 * needs a live seeded tenant and a browser, and the brief is explicit that a
 * hand-drawn fake screenshot is WORSE than an obvious placeholder — so this is an
 * obviously-not-the-product diagram, and its one number (74 %) is presented as
 * part of a shape, never as a claim. The stage labels are passed in by the caller
 * because they are the only on-screen words in the picture, and a bilingual page
 * cannot afford one of them being hardcoded English.
 */
export function PortalPreview({
  reference,
  percent,
  statusLabel,
  stages,
  className,
}: {
  reference: string;
  percent: number;
  statusLabel: string;
  stages: PreviewStage[];
  className?: string;
}) {
  /* The ledger advances when the card is first scrolled to. This is the one
     piece of scroll-triggered motion on the site, and it is here rather than on
     the bands because it is not decoration: the thing this panel claims about
     the product — that a file moves through stages you can watch — is the thing
     the animation performs. A static drawing of four ticks asserts it; the
     drawing that fills in demonstrates it, in the three seconds a visitor gives
     a mock before scrolling past.

     Everything below degrades to the finished state rather than to an empty one:
     without `IntersectionObserver` the hook reports true on first render, and
     under `prefers-reduced-motion` the global rule collapses the durations, so
     the ticks are simply already there. */
  const [ref, shown] = useRevealed<HTMLDivElement>();

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "lux-card w-full max-w-md select-none p-5 text-left shadow-[var(--shadow-l)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="micro">File</p>
          <p className="num mt-1 truncate font-display text-title font-semibold tracking-tight">
            {reference}
          </p>
        </div>
        <span className="status st-warn shrink-0">{statusLabel}</span>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--ink)/0.08)]">
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: shown ? `${Math.max(0, Math.min(100, percent))}%` : "0%",
            transition: "width 900ms var(--ease)",
          }}
        />
      </div>

      <ol className="mt-5 space-y-3">
        {stages.map((s, i) => (
          <li
            key={i}
            className="flex items-center gap-3 text-sm"
            style={{
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : "translateY(6px)",
              // Staggered against the bar, not against each other's arrival: the
              // 220ms head start lets the progress fill begin before the first
              // tick lands, so the two read as one movement rather than two.
              transition: `opacity 320ms var(--ease) ${220 + i * 120}ms, transform 320ms var(--ease) ${220 + i * 120}ms`,
            }}
          >
            <span
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                s.state === "done"
                  ? "bg-primary text-primary-foreground"
                  : "border border-[var(--border)] text-muted-foreground",
                s.state === "current" &&
                  "ring-2 ring-[var(--primary)] ring-offset-2",
              )}
            >
              {s.state === "done" ? "✓" : ""}
            </span>
            <span
              className={
                s.state === "current"
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              }
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
