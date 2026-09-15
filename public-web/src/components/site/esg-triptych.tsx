import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useScrollScrub } from "@/lib/motion";
import type { EsgPillar } from "@/lib/site-api";

/**
 * The ESG interactive — guide §8.4, and the programme's worked example of §1.5.
 *
 * ── THE PROBLEM IT EXISTS TO SOLVE ─────────────────────────────────────────
 *
 * The supplied ESG copy is three columns of bullets: fourteen short lines under
 * three headings. It is the single most text-heavy block in the programme and
 * the one Q12 named specifically. §1.5's rule — "every list of three or more
 * parallel items is a candidate for a diagram, not a `<ul>`" — is not satisfied
 * by setting that in a nicer typeface.
 *
 * So each pillar is a DRAWING that assembles as it enters, and its points are
 * ANNOTATIONS ON that drawing: a leader line from a marked place in the
 * illustration to the sentence about it. The claim and the picture of the claim
 * are the same object, which is the whole difference between a diagram and a
 * list with an image above it.
 *
 * ── WHY IT IS A GRID AND NOT A HORIZONTAL SCROLL HIJACK ────────────────────
 *
 * "Scroll-scrubbed triptych" could mean the three panels move sideways as the
 * page scrolls. That was considered and rejected on two grounds, and the second
 * one is decisive:
 *
 *   · A scroll hijack has no keyboard equivalent. §1.2 rule 3 binds without
 *     exception — every narrative set piece is reachable, operable and escapable
 *     without a pointer — and a band whose content is only reachable by scroll
 *     wheel fails that on its own.
 *   · It makes reduced motion a DIFFERENT LAYOUT. §8.4 asks for the settled
 *     state to be "genuinely good ... it is what a meaningful share of readers
 *     will see", and a component with two layouts has one that is designed and
 *     one that is the fallback. Nobody maintains the fallback.
 *
 * The triptych is therefore three columns at every width and in every motion
 * preference. What the scrub drives is the ASSEMBLY of each drawing — the paths
 * draw themselves, the annotations arrive in order — so the reduced-motion
 * state is the same composition with `--scrub: 1`: fully drawn, every
 * annotation present, nothing missing and nothing to catch up on.
 *
 * `useScrollScrub` already does exactly that: under `prefers-reduced-motion` it
 * writes `settled` (1) once and attaches no listener. (§5.4's table says the
 * hook "returns a static 0"; the implementation is better than the spec and the
 * spec is what is out of date.)
 *
 * ── ONE CONCESSION, AT PHONE WIDTH ─────────────────────────────────────────
 *
 * Annotations anchored to a drawing need room for the leader line and the
 * sentence. Below 768px there is none, and a 360px screen would get overlapping
 * labels — which is not "annotations on a drawing", it is an unreadable
 * drawing. So below `md` the drawing settles above and the points render as a
 * list beneath it. The drawing is still the tenant's picture of their own
 * commitment; it simply stops carrying the labels. Recorded as a deviation.
 */

/**
 * Where a pillar's points attach to its drawing, in the SVG's own coordinates.
 *
 * ── THE ANCHOR IS NOT THE LABEL'S POSITION ────────────────────────────────
 *
 * The first version placed each label at its anchor's own height, which reads
 * correctly and lays out wrongly: several anchors on one drawing sit within a
 * few units of each other (the environment drawing has three between y=128 and
 * y=178), and a two-line label at each of them overlaps its neighbours into an
 * unreadable stack. It was invisible in every unit test and obvious in the
 * first screenshot — which is the argument for taking one.
 *
 * So the anchor marks the PLACE on the drawing, and the label gets an evenly
 * spaced slot down the side. The leader line runs between the two, which is how
 * an annotated diagram has always worked: the line exists precisely because the
 * label cannot sit on top of the thing it names.
 *
 * `side` is a hint the slot allocator uses to keep a label near its anchor
 * where it can.
 */
type Anchor = { x: number; y: number; side: "left" | "right" };

/**
 * THE THREE DRAWINGS.
 *
 * Hand-written inline SVG, not an asset and not a library. Three reasons, in
 * order of weight: §4.1 says this repository contains zero image files and
 * media arrives by upload rather than by commit; an illustration that IS the
 * data cannot be a static file anyway, because the annotations come from the
 * tenant's own rows; and inline SVG costs no request, no chunk and no layout
 * shift, which is what keeps this band off the deferred budget entirely.
 *
 * Each drawing is built from paths whose `stroke-dashoffset` is driven by
 * `--scrub`, so the line draws itself as the reader arrives. `pathLength="1"`
 * normalises every path to one unit regardless of its real geometry — without
 * it the dash arithmetic would need each path's measured length, which is a
 * layout read per path per frame.
 */
const VIEW_W = 300;
const VIEW_H = 300;
/** The height each drawing is composed in, centred inside the taller stage. */
const ART_H = 220;
const VIEWBOX = `0 0 ${VIEW_W} ${VIEW_H}`;

/** Environment — a route being straightened, which is what route optimisation
 *  IS. The meander is drawn first and fades as the direct line completes. */
function EnvironmentDrawing() {
  return (
    <>
      <path
        className="esg-ghost"
        pathLength="1"
        d="M28 178 C 78 178, 66 120, 108 118 C 150 116, 138 62, 186 60 C 226 58, 240 46, 272 44"
      />
      <path
        className="esg-line"
        pathLength="1"
        d="M28 178 C 110 168, 190 96, 272 44"
      />
      {/* The load, riding the optimised line. */}
      <rect className="esg-mark" x="140" y="100" width="20" height="14" rx="2" />
      <circle className="esg-node" cx="28" cy="178" r="5" />
      <circle className="esg-node" cx="272" cy="44" r="5" />
      {/* Emissions, drawn as a diminishing series rather than as a number —
          there is no figure behind this and N12 forbids inventing one. */}
      <circle className="esg-dot" cx="70" cy="150" r="4" />
      <circle className="esg-dot" cx="112" cy="128" r="3" />
      <circle className="esg-dot" cx="154" cy="104" r="2" />
    </>
  );
}

/** Social — people around the operation, not a stack of policies. A core with
 *  spokes out to five positions; the spokes draw outward as the reader
 *  arrives, which is the direction the claims run. */
function SocialDrawing() {
  return (
    <>
      <circle className="esg-core" cx="150" cy="110" r="26" />
      {[
        [60, 54],
        [244, 54],
        [40, 152],
        [260, 152],
        [150, 190],
      ].map(([x, y], i) => (
        <g key={i}>
          <path
            className="esg-line"
            pathLength="1"
            d={`M150 110 L${x} ${y}`}
          />
          <circle className="esg-node" cx={x} cy={y} r="8" />
        </g>
      ))}
      <circle className="esg-mark" cx="150" cy="110" r="9" />
    </>
  );
}

/** Governance — the two named committees over the operation they govern, with
 *  the accountability lines between them. This one is a structure because the
 *  claim is structural: the tenant's copy names a Strategic Planning Committee
 *  and an Operational Excellence Committee, and a diagram of a structure is a
 *  more honest rendering of that than a bullet saying it exists. */
function GovernanceDrawing() {
  return (
    <>
      <rect className="esg-plate" x="52" y="30" width="82" height="34" rx="4" />
      <rect className="esg-plate" x="166" y="30" width="82" height="34" rx="4" />
      <path className="esg-line" pathLength="1" d="M93 64 L93 104 L207 104 L207 64" />
      <path className="esg-line" pathLength="1" d="M150 104 L150 134" />
      <rect className="esg-core" x="86" y="134" width="128" height="40" rx="4" />
      {/* The controls, drawn as gates on the line rather than as ticks in a
          list — a control is a thing cargo passes through. */}
      <path className="esg-line" pathLength="1" d="M110 174 L110 196 M150 174 L150 196 M190 174 L190 196" />
      <circle className="esg-node" cx="110" cy="196" r="5" />
      <circle className="esg-node" cx="150" cy="196" r="5" />
      <circle className="esg-node" cx="190" cy="196" r="5" />
    </>
  );
}

type PillarKey = "environment" | "social" | "governance";

const DRAWINGS: Record<PillarKey, { Art: () => JSX.Element; anchors: Anchor[] }> = {
  environment: {
    Art: EnvironmentDrawing,
    anchors: [
      { x: 28, y: 178, side: "left" },
      { x: 112, y: 128, side: "left" },
      { x: 150, y: 107, side: "right" },
      { x: 272, y: 44, side: "right" },
      { x: 70, y: 150, side: "left" },
    ],
  },
  social: {
    Art: SocialDrawing,
    anchors: [
      { x: 60, y: 54, side: "left" },
      { x: 244, y: 54, side: "right" },
      { x: 40, y: 152, side: "left" },
      { x: 260, y: 152, side: "right" },
      { x: 150, y: 190, side: "right" },
    ],
  },
  governance: {
    Art: GovernanceDrawing,
    anchors: [
      { x: 93, y: 47, side: "left" },
      { x: 207, y: 47, side: "right" },
      { x: 150, y: 154, side: "right" },
      { x: 110, y: 196, side: "left" },
      { x: 190, y: 196, side: "right" },
    ],
  },
};

/** How many points a drawing can carry as annotations before the rest fall to
 *  the list below. Five is what each drawing is designed to hold — the schema
 *  allows twelve, and twelve labels on one illustration is not a diagram, it is
 *  a list drawn badly. */
const ANCHORED = 5;

/**
 * Place each label in an evenly spaced slot and draw a leader to it.
 *
 * ── WHY EVEN SPACING RATHER THAN THE ANCHOR'S OWN HEIGHT ──────────────────
 *
 * Because anchors cluster. The environment drawing has three within fifty units
 * of each other, and labels placed at their heights overlap into a stack that
 * is not readable — which is what the first screenshot of this band showed, and
 * what no unit test could have.
 *
 * Slots alternate sides so consecutive labels never share a column, and the
 * leader bends: out from the anchor, across, and in to the label. That is the
 * ordinary grammar of an annotated diagram, and the bend is what makes the
 * association legible when the label is nowhere near the mark.
 */
function layout(
  points: string[],
  anchors: Anchor[],
): Array<{
  point: string;
  anchor: Anchor;
  side: "left" | "right";
  labelPercent: number;
  leader: string;
}> {
  const n = points.length;
  const shift = (VIEW_H - ART_H) / 2;
  return points.map((point, i) => {
    // The tables below are written in the DRAWING's coordinates, which is where
    // they are readable against the paths they mark. The leader is drawn in the
    // stage's, so the anchor is shifted once here rather than every table being
    // rewritten with an offset baked in.
    const anchor = { ...anchors[i], y: anchors[i].y + shift };
    // Alternating, so two labels are never in the same column in a row. The
    // anchor's own side wins for the FIRST of each pair, which keeps most
    // leaders short.
    const side: "left" | "right" = i % 2 === 0 ? "left" : "right";
    // Slots down the stage, inset top and bottom so the first and last labels
    // are not flush against the edge.
    const top = n === 1 ? 50 : 8 + (84 * i) / (n - 1);
    const y = (top / 100) * VIEW_H;
    const edge = side === "left" ? 10 : VIEW_W - 10;
    // Out from the anchor, then a curve to the label's own height.
    const midX = (anchor.x + edge) / 2;
    const leader = `M${anchor.x} ${anchor.y} C ${midX} ${anchor.y}, ${midX} ${y}, ${edge} ${y}`;
    return { point, anchor, side, labelPercent: top, leader };
  });
}

function Pillar({
  which,
  label,
  pillar,
}: {
  which: PillarKey;
  label: string;
  pillar: EsgPillar;
}) {
  const { t } = useTranslation();
  const { Art, anchors } = DRAWINGS[which];
  /*
   * The scrub, narrowed so the drawing COMPLETES while the panel is still
   * comfortably on screen. The default (1 → 0) finishes as the element leaves
   * the top, which for a tall band means the reader watches it assemble and
   * never sees it whole.
   *
   * Under reduced motion this writes `--scrub: 1` once and attaches no
   * listener — the settled state, which for this component is the finished
   * composition rather than a degraded one.
   */
  const ref = useScrollScrub<HTMLDivElement>({ start: 0.9, end: 0.45 });

  const anchored = pillar.points.slice(0, ANCHORED);
  const overflow = pillar.points.slice(ANCHORED);
  const slots = layout(anchored, anchors);

  return (
    <div ref={ref} className="esg-pillar">
      <h3 className="text-title font-semibold tracking-tight">{label}</h3>
      {pillar.text ? (
        <p className="mt-2 text-sm text-muted-foreground">{pillar.text}</p>
      ) : null}

      <div className="esg-stage mt-5">
        <svg
          viewBox={VIEWBOX}
          className="esg-art"
          role="img"
          /* The drawing is a rendering of the sentences beside it, so its
             accessible name says that rather than describing the picture. The
             points themselves are real text in the DOM below and are read
             normally; describing the illustration too would announce the same
             content twice. */
          aria-label={t("site.esg.figureAlt", { pillar: label })}
        >
          {/* The drawings are composed in a 300x220 box; the stage is 300x300
              so the labels have room to spread down the sides without crowding
              the illustration. Translating rather than redrawing keeps each
              drawing's own proportions, which were tuned against its subject. */}
          <g transform={`translate(0 ${(VIEW_H - ART_H) / 2})`}>
            <Art />
          </g>
          {/* The leader lines, in the SVG's own coordinates so they stay
              attached to the drawing at any width. Drawn after the art so they
              sit over it. Each runs from its anchor — a real place on the
              illustration — to its label's slot, which is why the line exists
              at all: the label cannot sit on top of the thing it names. */}
          {slots.map((slot, i) => (
            <g
              key={i}
              className="esg-leader"
              style={annotationStyle(i, slots.length)}
            >
              <path d={slot.leader} pathLength="1" />
              <circle cx={slot.anchor.x} cy={slot.anchor.y} r="3.5" />
            </g>
          ))}
        </svg>

        {/* THE ANNOTATIONS, as HTML rather than as SVG `<text>`.
            SVG text does not wrap, does not inherit the type scale and is not
            selectable the way a sentence should be. They are positioned from
            the SAME slot geometry the leader lines use, so the two cannot drift
            apart, and they overlay the drawing rather than flanking it: at a
            third of the container's width there is no room either side, and a
            column that gives half its width to labels is a drawing nobody can
            read. */}
        <ul className="esg-notes">
          {slots.map((slot, i) => (
            <li
              key={slot.point}
              className={cn(
                "esg-note",
                slot.side === "left" ? "esg-note-l" : "esg-note-r",
              )}
              style={
                {
                  ...annotationStyle(i, slots.length),
                  top: `${slot.labelPercent}%`,
                } as React.CSSProperties
              }
            >
              {slot.point}
            </li>
          ))}
        </ul>
      </div>

      {/* Below `md` the annotations are unplaceable, and any point past the
          fifth has no anchor at any width. Both land here — as real text, in
          document order, always present for a screen reader. */}
      <ul className="esg-list">
        {anchored.map((point) => (
          <li key={point}>{point}</li>
        ))}
        {overflow.map((point) => (
          <li key={point} className="esg-list-extra">
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * When one annotation arrives, as a fraction of the panel's scrub.
 *
 * Spread across the back half of the travel so the drawing has substantially
 * assembled before the first label appears — a label pointing at a line that is
 * not there yet reads as a mistake. `--at` is compared against `--scrub` in CSS
 * rather than in JS, which is what keeps this off the main thread: the scrub
 * writes one property per frame and the browser recomputes the rest.
 *
 * ── WHY THE RANGE STOPS AT `LAST_AT` AND NOT AT 1 ─────────────────────────
 *
 * The opacity is `clamp(0, (--scrub − --at) / FADE, 1)`, so an annotation only
 * reaches FULL opacity once the scrub has passed its `--at` by `FADE`. The
 * first version spread to 0.9, which meant that at `--scrub: 1` — the settled
 * state, and what every reduced-motion visitor sees — the last annotation of
 * each pillar sat at (1 − 0.9) / 0.12 = **0.83 opacity, permanently**.
 *
 * Three of fourteen labels, greyed out forever, on the block §8.4 says must be
 * "genuinely good" in exactly that state. No test caught it and no screenshot
 * of the animated version would have: it is only visible when the scrub STOPS
 * at 1. It was found by driving a real browser with `prefers-reduced-motion`
 * and reading the computed opacity of every note, which is the pass §8.7 asks
 * for and the reason it asks for it.
 *
 * So the last annotation's threshold is capped at `1 − FADE`, and
 * `esg-triptych.test.tsx` pins the arithmetic rather than the number.
 */
export const ANNOTATION_FADE = 0.12;
export const ANNOTATION_LAST_AT = 1 - ANNOTATION_FADE;

export function annotationStyle(index: number, total: number): React.CSSProperties {
  const first = 0.35;
  const span = ANNOTATION_LAST_AT - first;
  const at = first + (span * index) / Math.max(total - 1, 1);
  return { "--at": at.toFixed(3) } as React.CSSProperties;
}

/**
 * The band. Renders nothing at all when the tenant has written no ESG — no
 * heading, no empty columns, no "coming soon", which is the same rule the
 * figures strip follows and for the same reason (N12).
 */
export function EsgTriptych({
  esg,
}: {
  esg: {
    environment: EsgPillar | null;
    social: EsgPillar | null;
    governance: EsgPillar | null;
  };
}) {
  const { t } = useTranslation();
  const pillars: Array<[PillarKey, EsgPillar]> = (
    ["environment", "social", "governance"] as const
  )
    .map((k) => [k, esg[k]] as [PillarKey, EsgPillar | null])
    .filter((entry): entry is [PillarKey, EsgPillar] => entry[1] !== null);

  if (!pillars.length) return null;

  return (
    <div className="esg-grid">
      {pillars.map(([key, pillar]) => (
        <Pillar
          key={key}
          which={key}
          label={t(`site.esg.${key}`)}
          pillar={pillar}
        />
      ))}
    </div>
  );
}
