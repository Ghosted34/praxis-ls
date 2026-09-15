import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Timeline,
  ENTRY_FADE,
  ENTRY_LAST_AT,
  entryAt,
} from "@/components/site/timeline";
import "@/lib/i18n";
import type { TimelineEntry } from "@/lib/site-api";

/**
 * The scroll-scrubbed timeline (§9.1's "time as depth").
 *
 * ── THE ARITHMETIC IS PINNED, NOT THE NUMBER ──────────────────────────────
 *
 * PR 4 shipped an ESG triptych whose last annotation sat at 0.83 opacity
 * FOREVER, because the thresholds spread to 0.9 and the settled state is
 * `--scrub: 1`. Three labels of fourteen, permanently greyed out, on the block
 * §8.4 says must be genuinely good in exactly that state. No unit test caught
 * it and no screenshot of the animation would have.
 *
 * So this suite asserts the RELATIONSHIP — that the last entry's threshold plus
 * the fade lands on or before 1 — rather than the literal 0.86. Changing either
 * constant to a pair that reintroduces the defect fails this.
 */

const ENTRIES: TimelineEntry[] = [
  { year: 2021, label: "Founded", text: "Douala." },
  { year: 2023, label: "First licence", text: "Customs brokerage." },
  { year: 2026, label: "Chad corridor", text: "N'Djamena." },
];

describe("the entry thresholds", () => {
  it("finishes the last entry at --scrub: 1", () => {
    // The condition that failed in the ESG triptych, stated directly.
    expect(ENTRY_LAST_AT + ENTRY_FADE).toBeLessThanOrEqual(1);
  });

  it("puts the last entry exactly at the cap, for any count above one", () => {
    for (const total of [2, 3, 9, 40]) {
      expect(entryAt(total - 1, total)).toBeCloseTo(ENTRY_LAST_AT, 6);
    }
  });

  it("brings a lone entry in early rather than holding it at the cap", () => {
    // A one-entry timeline whose only entry waited until the reader was 86%
    // through the block would be a heading over an empty spine for most of the
    // scroll. `Math.max(total - 1, 1)` makes the span contribute nothing, so
    // the entry sits at the FIRST threshold — which is the behaviour, not an
    // accident of the guard.
    expect(entryAt(0, 1)).toBeCloseTo(0.05, 6);
  });

  it("spreads entries in order and never past the cap", () => {
    const ats = ENTRIES.map((_, i) => entryAt(i, ENTRIES.length));
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    for (const at of ats) expect(at).toBeLessThanOrEqual(ENTRY_LAST_AT);
  });

  it("gives a single entry a threshold it can actually pass", () => {
    // `Math.max(total - 1, 1)` guards the division; without it a one-entry
    // timeline divides by zero and the only entry never arrives.
    expect(Number.isFinite(entryAt(0, 1))).toBe(true);
    expect(entryAt(0, 1) + ENTRY_FADE).toBeLessThanOrEqual(1);
  });
});

describe("the rendered timeline", () => {
  it("draws one entry per moment, with its year", () => {
    const { container } = render(<Timeline entries={ENTRIES} />);
    expect(container.querySelectorAll(".timeline-entry")).toHaveLength(3);
    expect(screen.getByText("2021")).toBeInTheDocument();
    expect(screen.getByText("Chad corridor")).toBeInTheDocument();
  });

  it("writes each entry's own --at, so CSS does the scrubbing", () => {
    const { container } = render(<Timeline entries={ENTRIES} />);
    const ats = [...container.querySelectorAll<HTMLElement>(".timeline-entry")].map((el) =>
      Number(el.style.getPropertyValue("--at")),
    );
    expect(ats[0]).toBeLessThan(ats[1]);
    expect(ats[2]).toBeCloseTo(ENTRY_LAST_AT, 2);
  });

  it("renders nothing for an empty history", () => {
    const { container } = render(<Timeline entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels the year for a screen reader, which sees a bare number otherwise", () => {
    render(<Timeline entries={ENTRIES} />);
    // "2021" read aloud in a list of headings is not obviously a year.
    expect(screen.getAllByText(/Year/i).length).toBeGreaterThan(0);
  });
});

describe("under prefers-reduced-motion", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          onchange: null,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("settles at 1 rather than animating faster", () => {
    // §1.2 rule 1, without exception: the SETTLED state, not a shorter
    // animation. `useScrollScrub` writes `settled` once and attaches no
    // listener.
    const { container } = render(<Timeline entries={ENTRIES} />);
    const root = container.querySelector<HTMLElement>(".timeline");
    expect(root?.style.getPropertyValue("--scrub")).toBe("1");
  });
});
