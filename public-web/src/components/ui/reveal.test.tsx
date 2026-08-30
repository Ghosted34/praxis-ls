import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Reveal } from "@/components/ui/reveal";

/**
 * The two behaviours that make a scroll-reveal wrong, and one that makes it
 * expensive. None is visible in a screenshot, and all three are the usual way
 * this effect ships broken.
 */

type Entry = { target: Element; isIntersecting: boolean };
let observed: Element[] = [];
let unobserved: Element[] = [];
let fire: (entries: Entry[]) => void = () => {};

class FakeObserver {
  constructor(cb: (e: Entry[]) => void) {
    fire = cb;
  }
  observe(el: Element) {
    observed.push(el);
  }
  unobserve(el: Element) {
    unobserved.push(el);
  }
  disconnect() {}
}

const setReducedMotion = (matches: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce") ? matches : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));

beforeEach(() => {
  observed = [];
  unobserved = [];
  setReducedMotion(false);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("reduced motion", () => {
  it("renders settled immediately, with no observer and no transition", () => {
    // Somebody who asked their system for less motion has not asked for FASTER
    // motion. A shorter animation is the wrong reading of that setting.
    setReducedMotion(true);
    render(
      <Reveal>
        <p>Copy</p>
      </Reveal>,
    );
    const el = screen.getByText("Copy").parentElement as HTMLElement;
    expect(el.className).toContain("opacity-100");
    expect(el.className).not.toContain("opacity-0");
    expect(observed).toHaveLength(0);
  });
});

describe("it never re-animates", () => {
  it("unobserves the element the moment it fires", () => {
    // An element that fades every time it is scrolled past is a page that
    // reads as broken, and unobserve-on-fire is the whole mechanism.
    render(
      <Reveal>
        <p>Copy</p>
      </Reveal>,
    );
    const el = screen.getByText("Copy").parentElement as HTMLElement;
    expect(el.className).toContain("opacity-0");
    expect(observed).toHaveLength(1);

    act(() => fire([{ target: observed[0], isIntersecting: true }]));
    expect(el.className).toContain("opacity-100");
    // Asserted as "was unobserved", not "unobserved once": two paths reach it,
    // and both are correct. The observer callback unobserves before firing so a
    // second entry in the same batch cannot fire twice, and the effect's own
    // cleanup unobserves when `shown` flips and it re-runs. `unobserve` is
    // idempotent, so the overlap costs nothing — but a count assertion here
    // would fail on a correct implementation, which is worse than no assertion.
    expect(unobserved).toContain(el);
  });

  it("ignores an entry that is not intersecting", () => {
    render(
      <Reveal>
        <p>Copy</p>
      </Reveal>,
    );
    act(() => fire([{ target: observed[0], isIntersecting: false }]));
    expect(
      (screen.getByText("Copy").parentElement as HTMLElement).className,
    ).toContain("opacity-0");
  });
});

describe("one observer for the whole page", () => {
  it("does not create a second one for a second element", () => {
    // Thirty observers is thirty callbacks the browser schedules per scroll
    // frame; one observer with thirty targets is one.
    const spy = vi.fn(FakeObserver as never);
    vi.stubGlobal("IntersectionObserver", spy);
    render(
      <>
        <Reveal>
          <p>One</p>
        </Reveal>
        <Reveal>
          <p>Two</p>
        </Reveal>
      </>,
    );
    // The module keeps its instance across mounts, so at most one construction
    // happens here — and never one per element.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("an old browser gets the content", () => {
  it("renders settled when IntersectionObserver does not exist", () => {
    // The failure that would matter most: a page of invisible blocks.
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <Reveal>
        <p>Copy</p>
      </Reveal>,
    );
    expect(
      (screen.getByText("Copy").parentElement as HTMLElement).className,
    ).toContain("opacity-100");
  });
});

describe("the stagger", () => {
  it("delays only once shown, and only when asked", () => {
    render(
      <Reveal delay={2}>
        <p>Copy</p>
      </Reveal>,
    );
    const el = screen.getByText("Copy").parentElement as HTMLElement;
    // Hidden: no delay, or the element waits before it starts waiting.
    expect(el.style.transitionDelay).toBe("");
    act(() => fire([{ target: observed[0], isIntersecting: true }]));
    expect(el.style.transitionDelay).toBe("120ms");
  });
});
