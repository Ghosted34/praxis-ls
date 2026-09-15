import * as React from "react";
import { cn } from "@/lib/cn";
import { useInView } from "@/components/ui/reveal";
import { motionReduced } from "@/lib/motion";
import { afterPaint } from "@/lib/after-paint";

/**
 * The hero's route network, alive.
 *
 * ── WHAT REPLACED WHAT ─────────────────────────────────────────────────────
 *
 * `RouteGraphic` (graphics.tsx) is a static SVG with three dashed lanes and a
 * CSS marching-ants stroke. It is a good drawing and it stays — the proof band
 * and the empty states still use it. What it cannot do is carry cargo: the
 * dashes march, but nothing travels, so the diagram says "these are routes"
 * rather than "these are routes in use".
 *
 * Guide §7.1 asks for the second thing, on the LCP element, for ≤ 6 kB.
 *
 * ── WHY A CANVAS AND NOT MORE SVG ──────────────────────────────────────────
 *
 * Twenty moving cargo marks in SVG is twenty DOM nodes whose `cx`/`cy` are
 * written every frame — twenty style recalculations and a layout the browser
 * cannot skip, on the element that decides this page's LCP. One `<canvas>` is
 * one composited surface and one draw call per frame. The whole scene below is
 * about a hundred lines of arithmetic; the SVG version would be about the same
 * amount of code and would cost the main thread far more.
 *
 * ── HAND-WRITTEN, AND THAT IS THE BUDGET DECISION ─────────────────────────
 *
 * No library. The smallest general-purpose canvas/animation package worth
 * having is larger than this entire file, and none of them would be on the LCP
 * path anyway — §7.1 forbids anything here waiting on a lazy import, so a
 * dependency would have to be bundled into first paint. The 128 kB budget is
 * spent on the app, not on a tweening engine used by one component.
 *
 * ── IT STOPS ───────────────────────────────────────────────────────────────
 *
 * Two ways, both of them non-negotiable:
 *
 *   · OFF SCREEN. `useInView` (a shared observer — see reveal.tsx) cancels the
 *     frame loop the moment the hero scrolls away. A marketing page that keeps
 *     a rAF loop running for a canvas nobody can see is a page that drains a
 *     phone while the reader is four bands further down.
 *   · REDUCED MOTION. One frame, drawn once, showing the network AT REST with
 *     its cargo distributed along the lanes. Not a slower animation, not a
 *     shorter one — the settled state, which is what §1.2 rule 1 means and what
 *     `check:motion` asserts the umbrella still enforces for CSS.
 *
 * ── COLOUR COMES FROM TOKENS, READ AT RUN TIME ─────────────────────────────
 *
 * A canvas cannot reference a CSS custom property, so the values are read once
 * from the computed style and re-read when the theme attribute changes. That
 * keeps the one rule white-labelling depends on: the lanes are `--mode-sea`,
 * `--mode-air`, `--mode-road` and `--mode-rail`, harmonised per §5.2 to the
 * tenant's own palette, and nothing here contains a colour literal.
 */

/** The four transport modes, in the order the lanes are drawn. */
const MODES = ["sea", "air", "road", "rail"] as const;

/**
 * The network, in a 0…1 coordinate space so it scales to any box without a
 * second set of numbers.
 *
 * One hub, four spokes. It is deliberately ABSTRACT — no port names, no country
 * outlines, no counts. §7.5 states the rule for the corridor set piece and it
 * applies here first: a diagram that implies lanes the tenant does not run is a
 * claim, and N12 forbids the site making one. This says "a network exists",
 * which is true of every freight company that has a website.
 */
const HUB = { x: 0.42, y: 0.52 };
const LANES: ReadonlyArray<{
  /** Where the lane ends. The hub is always the other end. */
  to: { x: number; y: number };
  /** How far the curve bows off the straight line, as a fraction of its length.
   *  Signed: alternating signs are what stop four lanes reading as a fan. */
  bow: number;
  /** Cargo marks in flight on this lane, and how fast they travel. Speed is
   *  per-second so a slow frame changes distance travelled, never the pace. */
  cargo: number;
  speed: number;
}> = [
  { to: { x: 0.06, y: 0.84 }, bow: -0.18, cargo: 3, speed: 0.055 },
  { to: { x: 0.86, y: 0.14 }, bow: 0.2, cargo: 2, speed: 0.075 },
  { to: { x: 0.92, y: 0.7 }, bow: -0.14, cargo: 3, speed: 0.048 },
  { to: { x: 0.3, y: 0.08 }, bow: 0.16, cargo: 2, speed: 0.062 },
];

/** A point on a lane's quadratic curve at `t` ∈ 0…1. */
function pointOn(
  lane: (typeof LANES)[number],
  t: number,
  w: number,
  h: number,
): [number, number] {
  const x0 = HUB.x * w;
  const y0 = HUB.y * h;
  const x1 = lane.to.x * w;
  const y1 = lane.to.y * h;
  // The control point sits on the perpendicular at the midpoint, pushed out by
  // `bow`. Deriving it rather than storing it means a lane's shape survives a
  // change of aspect ratio instead of flattening on a wide screen.
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const cx = mx - dy * lane.bow;
  const cy = my + dx * lane.bow;
  const u = 1 - t;
  return [
    u * u * x0 + 2 * u * t * cx + t * t * x1,
    u * u * y0 + 2 * u * t * cy + t * t * y1,
  ];
}

/** The four mode colours plus the accent, as `r g b` triples read from the
 *  cascade. Returns null before the element is in the document. */
function readPalette(el: HTMLElement): string[] | null {
  const cs = getComputedStyle(el);
  const out = MODES.map((m) => cs.getPropertyValue(`--mode-${m}`).trim());
  if (out.some((v) => !v)) return null;
  return out;
}

export function RouteCanvas({
  className,
  /** Fraction of the box the drawing may use, 0…1. The hero paints it under
   *  type, so it is dimmed here rather than by an opacity on a wrapper — a
   *  wrapper opacity would also fade the light-catch the scene draws. */
  alpha = 0.5,
}: {
  className?: string;
  alpha?: number;
}) {
  const [box, visible] = useInView<HTMLDivElement>();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const host = box.current;
    if (!canvas || !host) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const still = motionReduced();
    /* Seeded with the shipped light-theme values rather than read here: a
       `getComputedStyle` on mount is a style recalculation on the critical
       path, and the real tokens are read inside `afterPaint` below before
       anything is drawn with them. These are only ever used if that read
       fails. */
    let palette = ["40 148 94", "28 155 215", "224 122 26", "147 51 234"];
    let raf = 0;
    let last = 0;
    // Seconds of scene time. Under reduced motion it never advances, and the
    // starting offsets below are what put cargo along the lanes rather than
    // stacked at the hub — the settled state has to look composed, not empty.
    let clock = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      // Cap the backing store at 2× regardless of the device's ratio: a 3×
      // phone would otherwise paint nine times the pixels for a decorative
      // layer, which is exactly the trade this app's budget exists to refuse.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(rect.width, 1);
      h = Math.max(rect.height, 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = alpha;

      LANES.forEach((lane, i) => {
        const rgb = palette[i % palette.length];
        const [x0, y0] = pointOn(lane, 0, w, h);
        const [xm, ym] = pointOn(lane, 0.5, w, h);
        const [x1, y1] = pointOn(lane, 1, w, h);

        // The lane itself: a faint quadratic, drawn through the midpoint so the
        // control point never has to be recomputed here.
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(2 * xm - (x0 + x1) / 2, 2 * ym - (y0 + y1) / 2, x1, y1);
        ctx.strokeStyle = `rgb(${rgb} / 0.32)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // The terminal.
        ctx.beginPath();
        ctx.arc(x1, y1, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${rgb} / 0.85)`;
        ctx.fill();

        // Cargo in flight. Each mark is offset by its index so they are spread
        // along the lane rather than departing together, and `clock` is the
        // only thing that moves — which is why a still frame is a composed one.
        for (let c = 0; c < lane.cargo; c++) {
          const t = ((clock * lane.speed + c / lane.cargo) % 1 + 1) % 1;
          const [cx, cy] = pointOn(lane, t, w, h);
          // Fades in at departure and out at arrival, so a mark never pops into
          // existence on top of a node.
          const edge = Math.min(t, 1 - t) * 6;
          ctx.globalAlpha = alpha * Math.min(edge, 1);
          ctx.beginPath();
          ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${rgb})`;
          ctx.fill();
        }
        ctx.globalAlpha = alpha;
      });

      // The hub, last, so it sits over every lane that meets it.
      const [hx, hy] = [HUB.x * w, HUB.y * h];
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${palette[0]} / 0.9)`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx, hy, 11, 0, Math.PI * 2);
      ctx.strokeStyle = `rgb(${palette[0]} / 0.35)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      // Elapsed rather than a frame count: a 30 Hz phone and a 120 Hz laptop
      // must see cargo move at the same speed, and `+= 1/60` per frame is the
      // bug where they do not. Clamped so a backgrounded tab returning after a
      // minute does not teleport everything a whole lap.
      clock += Math.min((now - last) / 1000, 0.1);
      last = now;
      draw();
      raf = requestAnimationFrame(frame);
    };

    // A theme flip changes every mode colour. Re-read and repaint rather than
    // polling the computed style each frame, which would be a layout read per
    // frame for a value that changes about twice a year.
    const themeWatch = new MutationObserver(() => {
      palette = readPalette(host) ?? palette;
      if (still) draw();
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    const onResize = () => {
      resize();
      if (still) draw();
    };
    window.addEventListener("resize", onResize, { passive: true });

    // NOTHING HERE TOUCHES LAYOUT UNTIL THE BROWSER HAS PAINTED.
    //
    // Every expensive thing this component does is a layout or style read:
    // `getComputedStyle` for the mode colours, `getBoundingClientRect` for the
    // backing-store size, then a full canvas draw. Doing them in the mount
    // effect put 301 ms of FORCED REFLOW on the critical path — measured, and
    // absent from `main` — behind the very element they decorate. §7.1 names
    // the hero as the LCP element; this canvas is the thing sitting behind it.
    //
    // So the whole sequence waits. The cost is that the network is empty for
    // one paint, at 42% alpha, behind a headline — which nobody can perceive.
    // The reduced-motion path waits too and then draws its ONE settled frame:
    // cargo already distributed, nothing scheduled, ever. Deferring is not
    // animating, so that promise is untouched.
    const release = afterPaint(() => {
      palette = readPalette(host) ?? palette;
      resize();
      clock = still ? 4 : 0;
      draw();
      if (!still && visible) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });

    return () => {
      release();
      if (raf) cancelAnimationFrame(raf);
      themeWatch.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [box, visible, alpha]);

  return (
    <div ref={box} aria-hidden className={cn("pointer-events-none", className)}>
      {/* No `role`, no label: this is decoration behind a headline, and the
          network it draws asserts nothing a screen reader needs. The hero's
          meaning is entirely in its text. */}
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
