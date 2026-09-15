import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  EsgTriptych,
  annotationStyle,
  ANNOTATION_FADE,
  ANNOTATION_LAST_AT,
} from "@/components/site/esg-triptych";
/* For its side effect: `lib/i18n` initialises i18next on import, and this is
   the one component test in the tree that renders no provider — so without it
   `t()` returns the raw key and every assertion on a translated string fails
   for a reason that has nothing to do with the component. */
import "@/lib/i18n";
import { en } from "@/lib/i18n-dict";
import type { EsgPillar } from "@/lib/site-api";

/**
 * §8.4 — the programme's worked example of the 90-word rule.
 *
 * The section names one thing as non-negotiable: "under reduced motion it
 * renders as a clean, static, three-column layout with the drawings settled.
 * That state must be genuinely good; it is what a meaningful share of readers
 * will see." The way this component guarantees it is by having only ONE
 * composition — the scrub drives assembly, not layout — so the tests that
 * matter most are the ones that would catch a second layout appearing.
 *
 * They are written against `matchMedia`, because that is what the guarantee
 * actually rests on: `useScrollScrub` reads `prefers-reduced-motion` and writes
 * `--scrub: 1` once instead of subscribing.
 */

const PILLAR = (points: string[], text = "Prose about this pillar."): EsgPillar => ({
  text,
  points,
});

const FULL = {
  environment: PILLAR([
    "Route optimisation to reduce fuel consumption",
    "Responsible handling of regulated cargo",
    "Waste reduction within warehouse operations",
  ]),
  social: PILLAR(["Strict health and safety standards", "Continuous training"]),
  governance: PILLAR(["Clear accountability structures"]),
};

/** Drive `prefers-reduced-motion`. jsdom has no matchMedia at all, so both
 *  branches have to be stubbed rather than only the reduced one. */
function motion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the ESG triptych (§8.4)", () => {
  it("renders one panel per pillar the tenant has written", () => {
    motion(false);
    const { container } = render(<EsgTriptych esg={FULL} />);
    expect(container.querySelectorAll(".esg-pillar")).toHaveLength(3);
    expect(screen.getByText(en.site.esg.environment)).toBeInTheDocument();
    expect(screen.getByText(en.site.esg.social)).toBeInTheDocument();
    expect(screen.getByText(en.site.esg.governance)).toBeInTheDocument();
  });

  it("draws each pillar rather than listing it — §1.5's whole point", () => {
    motion(false);
    const { container } = render(<EsgTriptych esg={FULL} />);
    // A drawing per pillar, with real geometry in it. This is what makes the
    // block a diagram instead of three columns of bullets in a nicer typeface.
    expect(container.querySelectorAll("svg.esg-art")).toHaveLength(3);
    expect(container.querySelectorAll("path.esg-line").length).toBeGreaterThan(2);
  });

  it("attaches every point to the drawing as an annotation", () => {
    motion(false);
    const { container } = render(<EsgTriptych esg={FULL} />);
    const first = container.querySelector(".esg-pillar") as HTMLElement;
    // Three points → three leader lines and three notes, and the leader count
    // must match the note count or a line points at nothing.
    expect(first.querySelectorAll(".esg-leader")).toHaveLength(3);
    expect(first.querySelectorAll(".esg-note")).toHaveLength(3);
  });

  it("renders NOTHING when the tenant has written no ESG", () => {
    // N12, and the same rule the figures strip follows: no heading, no empty
    // columns, no "coming soon". A tenant who has not filled in Settings ›
    // Website › About gets one fewer band, not a promise.
    motion(false);
    const { container } = render(
      <EsgTriptych esg={{ environment: null, social: null, governance: null }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("draws only the pillars that exist, not three regardless", () => {
    motion(false);
    const { container } = render(
      <EsgTriptych esg={{ ...FULL, social: null, governance: null }} />,
    );
    expect(container.querySelectorAll(".esg-pillar")).toHaveLength(1);
    expect(screen.queryByText(en.site.esg.social)).toBeNull();
  });
});

describe("the settled state under reduced motion (§8.4)", () => {
  it("renders the FINISHED composition, not a blank one waiting for a scroll", () => {
    /*
     * The assertion this whole component is shaped around.
     *
     * `useScrollScrub` writes `--scrub: 1` once under `prefers-reduced-motion`
     * and attaches no listener. Every rule in the stylesheet is written so that
     * 1 is the finished picture — paths fully drawn, annotations at full
     * opacity — so "settled" and "designed" are the same state rather than a
     * design and a fallback.
     */
    motion(true);
    const { container } = render(<EsgTriptych esg={FULL} />);
    for (const panel of container.querySelectorAll(".esg-pillar")) {
      expect((panel as HTMLElement).style.getPropertyValue("--scrub")).toBe("1");
    }
  });

  it("keeps the SAME layout it has with motion — there is no second design", () => {
    /*
     * A component with two layouts has one that is designed and one that is the
     * fallback, and nobody maintains the fallback. So the reduced-motion
     * rendering is compared structurally against the ordinary one: same panels,
     * same drawings, same annotations, same text. Only `--scrub` differs.
     */
    motion(false);
    const moving = render(<EsgTriptych esg={FULL} />);
    const movingShape = [
      moving.container.querySelectorAll(".esg-pillar").length,
      moving.container.querySelectorAll("svg.esg-art").length,
      moving.container.querySelectorAll(".esg-note").length,
      moving.container.querySelectorAll(".esg-leader").length,
    ];
    moving.unmount();

    motion(true);
    const settled = render(<EsgTriptych esg={FULL} />);
    expect([
      settled.container.querySelectorAll(".esg-pillar").length,
      settled.container.querySelectorAll("svg.esg-art").length,
      settled.container.querySelectorAll(".esg-note").length,
      settled.container.querySelectorAll(".esg-leader").length,
    ]).toEqual(movingShape);
  });

  it("never re-renders React from the scrub", () => {
    /*
     * §5.4: "writes only CSS custom properties (never React state — a scrub
     * through state re-renders 60 times a second)". The threshold comparison
     * for each annotation is `--at` against `--scrub` in CSS for the same
     * reason, so the panel carries `--at` as an inline property and holds no
     * state of its own.
     */
    motion(false);
    const { container } = render(<EsgTriptych esg={FULL} />);
    const note = container.querySelector(".esg-note") as HTMLElement;
    expect(note.style.getPropertyValue("--at")).not.toBe("");
  });
});

describe("the points are always real text (§8.4)", () => {
  it("keeps every point in the DOM for a screen reader, at any width", () => {
    /*
     * The annotations are positioned with CSS and hidden below 900px, where the
     * same sentences render in `.esg-list` instead. Whichever is visible, the
     * words are real text in document order — never an SVG `<text>` node and
     * never an image. The duplicate is hidden by CSS rather than removed,
     * which is why this asserts on presence and the CSS asserts on visibility.
     */
    motion(false);
    const { container } = render(<EsgTriptych esg={FULL} />);
    const first = container.querySelector(".esg-pillar") as HTMLElement;
    const list = first.querySelector(".esg-list") as HTMLElement;
    for (const point of FULL.environment.points) {
      expect(within(list).getByText(point)).toBeInTheDocument();
    }
  });

  it("spills a point past the fifth into the list, never onto the drawing", () => {
    /*
     * The schema allows twelve points and each drawing is designed to hold
     * five. Twelve labels on one illustration is not a diagram, it is a list
     * drawn badly — so the sixth onward has no anchor and lands in the list,
     * which is visible at every width for exactly that reason.
     */
    motion(false);
    const many = PILLAR(["a", "b", "c", "d", "e", "f", "g"]);
    const { container } = render(
      <EsgTriptych esg={{ environment: many, social: null, governance: null }} />,
    );
    expect(container.querySelectorAll(".esg-note")).toHaveLength(5);
    expect(container.querySelectorAll(".esg-list-extra")).toHaveLength(2);
    // …and the spilled ones are still readable.
    expect(screen.getByText("g")).toBeInTheDocument();
  });
});

/**
 * ── THE DEFECT A REAL BROWSER FOUND, PINNED AS ARITHMETIC ──────────────────
 *
 * The annotation opacity is `clamp(0, (--scrub − --at) / FADE, 1)`, so a label
 * reaches full opacity only once the scrub has passed its threshold by FADE.
 * The thresholds first spread to 0.9, which meant that at `--scrub: 1` — the
 * settled state, and what every reduced-motion visitor sees — the LAST label of
 * each pillar sat at (1 − 0.9) / 0.12 = 0.83 opacity, permanently. Three of
 * fourteen, greyed out forever, on the block §8.4 says must be genuinely good
 * in exactly that state.
 *
 * jsdom does not compute `clamp()`, so asserting the rendered opacity here
 * would assert nothing. What CAN be pinned is the arithmetic that decides it,
 * which is where the defect actually was.
 */
describe("every annotation is fully opaque in the settled state (§8.4)", () => {
  const opacityAtSettled = (at: number) =>
    Math.min(1, Math.max(0, (1 - at) / ANNOTATION_FADE));

  it("leaves no label part-faded at --scrub: 1, at any pillar length", () => {
    // One point through the schema's maximum of twelve.
    for (let total = 1; total <= 12; total++) {
      for (let i = 0; i < total; i++) {
        const at = Number(
          String(
            (annotationStyle(i, total) as Record<string, string>)["--at"],
          ),
        );
        expect(opacityAtSettled(at)).toBeCloseTo(1, 5);
      }
    }
  });

  it("still staggers — the last label arrives after the first", () => {
    // The cap must not collapse the range into a single instant, or the
    // annotations all appear at once and the assembly reads as a flash.
    const first = Number(
      (annotationStyle(0, 5) as Record<string, string>)["--at"],
    );
    const last = Number(
      (annotationStyle(4, 5) as Record<string, string>)["--at"],
    );
    expect(last).toBeGreaterThan(first + 0.3);
    expect(last).toBeLessThanOrEqual(ANNOTATION_LAST_AT);
  });
});
