import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StageSequence } from "./stage-sequence";

/**
 * The how-we-work sequence (§7.4).
 *
 * ── WHAT IS WORTH ASSERTING HERE ───────────────────────────────────────────
 *
 * The scrub itself is CSS driven by a custom property, so there is nothing
 * meaningful to assert about it in jsdom — and `motion.test.ts` already covers
 * the hook. What CAN go wrong, silently, is the contract between the two:
 *
 *   · a stage whose `--at` is wrong never lights, at any scroll position;
 *   · a diagram that is not `aria-hidden` gets announced as an image with no
 *     description, which is worse than no diagram;
 *   · and the body copy fading with the decoration, which is the one thing that
 *     would turn a designed reveal into a contrast failure on real text.
 */

const stages = [
  { title: "You send the shipment", body: "Origin, destination, what you are moving." },
  { title: "We price and book", body: "Routing, carrier, customs, a written proposal." },
  { title: "You watch it move", body: "Milestones as they happen, on one reference." },
];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});
afterEach(cleanup);

describe("the stage sequence", () => {
  it("spreads the stages evenly across the scrub, first at 0 and last at 1", () => {
    // A stage whose `--at` is past 1 never lights, however far the reader
    // scrolls — and nothing else in the system would report it.
    const { container } = render(<StageSequence stages={stages} />);
    const items = [...container.querySelectorAll(".stage-item")] as HTMLElement[];
    expect(items).toHaveLength(3);
    expect(items[0].style.getPropertyValue("--at")).toBe("0");
    expect(items[2].style.getPropertyValue("--at")).toBe("1");
  });

  it("does not divide by zero on a single stage", () => {
    // A tenant's own `feature_list` decides how many stages there are. One is a
    // legitimate answer and `(i / (n - 1))` is NaN for it.
    const { container } = render(<StageSequence stages={[stages[0]]} />);
    const at = (container.querySelector(".stage-item") as HTMLElement).style.getPropertyValue("--at");
    expect(at).toBe("0");
    expect(at).not.toContain("NaN");
  });

  it("keeps every diagram out of the accessibility tree", () => {
    // The stage's meaning is entirely in its heading and sentence. A decorative
    // svg that is announced is a screen reader reading "image" three times.
    const { container } = render(<StageSequence stages={stages} />);
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders every stage's real text, at any scroll position", () => {
    // The decoration fades; the copy never does. This is the assertion that
    // would fail if somebody moved the opacity from `.stage-figure` onto
    // `.stage-item`, which is the tempting simplification.
    render(<StageSequence stages={stages} />);
    for (const s of stages) {
      expect(screen.getByText(s.title)).toBeTruthy();
      expect(screen.getByText(s.body)).toBeTruthy();
    }
  });

  it("gives each stage a heading, so the band has an outline", () => {
    render(<StageSequence stages={stages} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("cycles the diagram set rather than leaving a stage without one", () => {
    // A tenant with four steps must not get three pictures and a gap.
    const four = [...stages, { title: "It arrives", body: "Proof of delivery on the file." }];
    const { container } = render(<StageSequence stages={four} />);
    expect(container.querySelectorAll(".stage-figure svg")).toHaveLength(4);
  });
});
