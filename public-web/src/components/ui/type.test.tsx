import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StagedLines, PullQuote, FigureCallout } from "@/components/ui/type";

/**
 * The accessibility hazard these components create, and the proof they defuse
 * it.
 *
 * Fragmenting a heading into one element per word is fine for a sighted reader
 * and a real problem for assistive technology, which can announce the result a
 * word at a time — "Freight. That. Moves. Your. Business." — with a pause
 * between each. That is the standard way this effect ships broken, it is
 * invisible to everyone who builds it, and it lands on exactly the visitors
 * least able to work around it.
 *
 * So the container carries the whole string and the fragments are hidden. These
 * tests pin that, and they pin the reduced-motion contract that `Reveal`
 * established: the settled state, not a faster animation.
 */

type Entry = { target: Element; isIntersecting: boolean };
let fire: (entries: Entry[]) => void = () => {};

class FakeObserver {
  constructor(cb: (e: Entry[]) => void) {
    fire = cb;
  }
  observe() {}
  unobserve() {}
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
  setReducedMotion(false);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("StagedLines", () => {
  it("announces the whole sentence, not one word at a time", () => {
    render(<StagedLines as="h1" text="Freight that moves your business" />);
    // One accessible name, the full sentence.
    const heading = screen.getByRole("heading", {
      name: "Freight that moves your business",
    });
    // And every visual fragment is hidden from the accessibility tree, so the
    // name above is the ONLY thing announced.
    const words = heading.querySelectorAll(".staged-word");
    expect(words.length).toBe(5);
    for (const w of words) expect(w).toHaveAttribute("aria-hidden");
  });

  it("keeps the words separated when they are laid out inline-block", () => {
    // `display: inline-block` collapses whitespace between elements, so the
    // spaces have to survive as real text nodes or the headline renders as
    // "Freightthatmoves". Measured over the ANIMATED fragments only: the
    // heading also carries a visually-hidden copy of the whole sentence, so
    // `heading.textContent` is the sentence twice by design.
    render(<StagedLines as="h2" text="Sea freight import" />);
    const heading = screen.getByRole("heading");
    const visible = [...heading.childNodes]
      .filter((n) => !(n instanceof HTMLElement && n.classList.contains("sr-only")))
      .map((n) => n.textContent)
      .join("");
    expect(visible).toBe("Sea freight import");
  });

  it("names the heading with real text, never with a prohibited aria-label", () => {
    // ARIA forbids `aria-label` on a generic element — a span or div with no
    // role — because there is no role for the label to name. This was that
    // bug: every fragment is aria-hidden, so with the label ignored the
    // heading announced as empty. Lighthouse reports it as
    // `aria-prohibited-attr`; it was found by running the built page rather
    // than by reading the component.
    render(<StagedLines as="h2" text="Sea freight import" />);
    const heading = screen.getByRole("heading");
    const staged = heading.classList.contains("staged")
      ? heading
      : heading.querySelector(".staged");
    expect(staged?.hasAttribute("aria-label")).toBe(false);
    // The accessible name comes from a real, readable text node instead.
    expect(heading.querySelector(".sr-only")?.textContent).toBe("Sea freight import");
    expect(screen.getByRole("heading", { name: "Sea freight import" })).toBeTruthy();
  });

  it("keeps the readable copy out of what a visitor pastes", () => {
    /* THE COST OF THE TEST ABOVE, AND WHERE IT IS PAID.
 
       The `.sr-only` span is the RIGHT answer for the accessible name and it
       puts the sentence in the DOM twice. `clip-path` hides those glyphs from
       the eye and from nothing else, so they stayed in the text flow and a
       visitor who selected the homepage headline and pressed copy got
 
         "Freight that moves your businessFreight that moves your business
          forwardforward"
 
       `index.css` answers it with `user-select: none` on `.sr-only`, which is
       asserted there rather than here because it is one rule covering every
       sr-only node in the app, not something this component declares.
 
       ⚠ DO NOT REACH FOR `getSelection()` TO TEST THIS. Chromium's clipboard
       serialiser honours `user-select: none`; `Selection.toString()` does not,
       and returns the hidden copy anyway for a range that spans it. The paste
       is clean while the JS API still shows the duplicate — verified in
       Chromium against the real page, both before and after. jsdom has neither
       path, so this asserts the rule's presence and the browser evidence lives
       in the comment beside it. */
    const css = readFileSync(
      join(__dirname, "..", "..", "index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.sr-only\s*\{[^}]*[^-]user-select:\s*none/);
  });

  it("caps the total stagger so a long headline stays inside the narrative budget", () => {
    // Twelve words at the default 45ms would be 495ms of stagger PLUS each
    // word's own 420ms transition — comfortably past the 600ms ceiling that
    // check-motion.mjs enforces. The step shrinks instead of the phrase
    // overrunning.
    const text = "one two three four five six seven eight nine ten eleven twelve";
    render(<StagedLines as="h2" text={text} />);
    act(() => fire([{ target: screen.getByRole("heading"), isIntersecting: true }]));

    const words = screen.getByRole("heading").querySelectorAll<HTMLElement>(".staged-word");
    const last = words[words.length - 1];
    const delay = parseInt(last.style.transitionDelay || "0", 10);
    expect(delay).toBeLessThanOrEqual(420);
  });

  it("rises out of a clip without hiding the word from the first paint", () => {
    // The mask and the LCP protection are the same constraint seen twice. A clip
    // deep enough to hide a word BEFORE it moves is `opacity: 0` wearing a
    // different property — clipped text is no more painted than transparent
    // text, and the hero's fade once measured +691 ms for exactly that.
    //
    // So: the clip exists, and the word inside it is the one that carries the
    // paint flag. What keeps the illusion is the travel being smaller than the
    // clip, which is `.staged-clip`'s job in index.css and not this one's.
    render(<StagedLines as="h2" masked paintImmediately text="Sea freight import" />);
    const heading = screen.getByRole("heading");
    const clips = heading.querySelectorAll(".staged-clip");
    expect(clips.length).toBe(3);
    for (const clip of clips) {
      const word = clip.querySelector(".staged-word");
      expect(word).toBeTruthy();
      // `aria-hidden` stays on the WORD, not on the box around it: every
      // `.staged-word` in the tree being hidden is the invariant, and a future
      // caller rendering one without a clip must not quietly lose it.
      expect(word).toHaveAttribute("aria-hidden");
      expect(word?.className).toContain("staged-word-lit");
    }
  });

  it("holds a second instance back, and keeps counting from where the first stopped", () => {
    // A headline split across two instances — the hero's is, so its accent word
    // can land on its own beat — is still ONE sentence to a reader and to
    // anything sweeping across it. `startDelay` is the beat; `wordOffset` is
    // what stops a left-to-right effect restarting on the second half.
    render(<StagedLines as="h2" startDelay={340} wordOffset={5} text="forward now" />);
    act(() => fire([{ target: screen.getByRole("heading"), isIntersecting: true }]));

    const words = screen.getByRole("heading").querySelectorAll<HTMLElement>(".staged-word");
    expect(words.length).toBe(2);
    // The hold applies to every word, and the stagger still runs on top of it.
    expect(parseInt(words[0].style.transitionDelay, 10)).toBe(340);
    expect(parseInt(words[1].style.transitionDelay, 10)).toBeGreaterThan(340);
    // …and the positions continue the line rather than starting it again.
    expect(words[0].style.getPropertyValue("--wi")).toBe("5");
    expect(words[1].style.getPropertyValue("--wi")).toBe("6");
  });

  it("renders settled immediately under reduced motion", () => {
    setReducedMotion(true);
    render(<StagedLines as="h2" text="Track a shipment" />);
    const words = screen.getByRole("heading").querySelectorAll(".staged-word");
    // `is-in` is the settled class; under reduced motion it is present on the
    // first paint, with no observer and nothing to wait for.
    for (const w of words) expect(w.className).toContain("is-in");
  });
});

describe("PullQuote", () => {
  it("attributes a quote as a figure rather than as loose small text", () => {
    render(<PullQuote cite="Timothée Massomba, CEO">Logistics is a strategic driver of trade.</PullQuote>);
    const figure = screen.getByRole("figure");
    expect(figure).toContainElement(screen.getByText("Timothée Massomba, CEO"));
  });

  it("omits the caption entirely when there is no attribution", () => {
    // An empty <figcaption> is announced as a caption with no content, which is
    // worse than no caption.
    const { container } = render(<PullQuote>No attribution here.</PullQuote>);
    expect(container.querySelector("figcaption")).toBeNull();
  });
});

describe("FigureCallout", () => {
  it("renders the value, label and optional sublabel", () => {
    render(<FigureCallout value="2021" label="Operating since" sublabel="Douala" />);
    expect(screen.getByText("2021")).toBeInTheDocument();
    expect(screen.getByText("Operating since")).toBeInTheDocument();
    expect(screen.getByText("Douala")).toBeInTheDocument();
  });

  it("asserts nothing on its own", () => {
    // N12: the component supplies presentation, never a fact. If this ever
    // grows a default value, a tenant who set none would be publishing a number
    // this codebase invented.
    const { container } = render(<FigureCallout value="" label="" />);
    expect(container.textContent).toBe("");
  });
});
