import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Hero, HERO_SCRIMS, SCRIM_FLOOR, BEAM_PEAK } from "./hero";
import { RouteCanvas } from "./route-canvas";

/** The stylesheet, read the way `check-motion.mjs` reads it: the numbers that
 *  bind this band live in CSS, and a test that cannot see them is a test that
 *  protects the component and not the design. */
const HERE = __dirname;
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");
/* The band's own stylesheet, which is where its numbers live — it is a separate
   file so the rules ride the marketing chunk instead of the entry, and `hero.css`
   carries the reasoning. Read here for the same reason `check-motion.mjs` reads
   CSS: the values that bind this band are declarations, and a test that cannot
   see them protects the component and not the design. */
const css = read("./hero.css");

/**
 * The hero — the LCP element, and the one band whose contrast was MEASURED
 * rather than eyeballed.
 *
 * ── WHY THE SCRIM TESTS EXIST ──────────────────────────────────────────────
 *
 * Guide §7.1 says any new treatment of this band must "re-derive [the scrim's
 * opacities] or keep them". Before this file those numbers lived in a comment,
 * which is a rule with nothing enforcing it: the next person to make a tenant's
 * photograph more visible nudges a percentage in a gradient string, every test
 * still passes, and an eyebrow at 3.1:1 ships. The floor is a constant now and
 * these assert against it.
 */

/** jsdom has no matchMedia. Each test says which world it is in, because the
 *  whole reduced-motion contract is "a different render", not "a faster one". */
function setMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("the scrim floors", () => {
  it("holds every stop that sits under copy at or above the binding floor", () => {
    // The eyebrow binds at 0.87 — small text, #ff5a00, 4.5:1 against a
    // near-white upload. A stop below this is a contrast failure on the one
    // band a visitor sees before anything else.
    for (const scrim of [HERO_SCRIMS.stacked, HERO_SCRIMS.split]) {
      for (const stop of scrim.stops) {
        if (stop.over) expect(stop.alpha).toBeGreaterThanOrEqual(SCRIM_FLOOR);
      }
    }
  });

  it("still lets the photograph through where copy is not", () => {
    // The other half of the requirement, and the reason this is two layers.
    // A scrim that met the floor everywhere would be the flat wash this band
    // was rescued from: safe, and a black rectangle.
    const openStops = [...HERO_SCRIMS.stacked.stops, ...HERO_SCRIMS.split.stops]
      .filter((s) => !s.over);
    expect(openStops.length).toBeGreaterThan(0);
    for (const stop of openStops) expect(stop.alpha).toBeLessThan(0.7);
  });

  it("paints from the band's own ground token, never a literal", () => {
    // A colour typed in here is a colour a tenant re-brand cannot move.
    const css = HERO_SCRIMS.css(HERO_SCRIMS.split);
    expect(css).toContain("var(--hero)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});

describe("the pass", () => {
  /*
   * ── WHY THE BEAM GETS TESTS AT ALL ───────────────────────────────────────
   *
   * It is decoration, and decoration is exactly what nobody re-checks. Two of
   * the three things below are safety properties that are invisible in every
   * screenshot: the brightness ceiling the eyebrow's contrast depends on, and
   * the fact that the layer sits UNDER the scrims. Both are one careless edit
   * away, both would ship looking better, and neither the token contrast gate
   * nor the motion gate can see them — one measures token pairs, the other
   * measures durations.
   */

  it("never lets the beam past the brightness its contrast was derived at", () => {
    // 22% is not a taste. On carbon, `screen` at that alpha lifts the ground to
    // L = 0.0237 and the eyebrow — #ff5a00 at 11px, the same element that binds
    // the scrim floors — lands at 4.56:1. At 26% it is 4.30:1 and the band
    // fails AA every eleven seconds, in a way no still frame shows.
    const declared = css.match(/--beam-peak:\s*([\d.]+)%/);
    expect(declared).toBeTruthy();
    expect(Number(declared![1])).toBeLessThanOrEqual(BEAM_PEAK * 100);

    // The flank cannot quietly become the peak either.
    const flank = css.match(/--beam-flank:\s*([\d.]+)%/);
    expect(Number(flank![1])).toBeLessThanOrEqual(Number(declared![1]));

    // And nothing in the stripe may be painted from a literal: a colour typed
    // in here is a colour a tenant re-brand cannot move, and the ceiling above
    // was derived for the tenant's accent, not for whatever gets pasted in.
    const stripe = css.slice(css.indexOf(".hero-beam {"), css.indexOf("@keyframes hero-beam-pass"));
    expect(stripe).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(stripe).toContain("var(--beam-peak)");
  });

  it("keeps the band's rules off the entry stylesheet", () => {
    // These rules are mounted by this component and by nothing else, and this
    // component is reachable only from the lazily-loaded marketing page. On the
    // entry they were first-paint weight for every route in the app, including
    // the ones that cannot render a hero — and the entry is the budget that is
    // measured to the kilobyte. Moving one back is a silent regression that the
    // bundle gate would only catch once the budget had already been spent.
    const entry = read("../../index.css");
    for (const selector of [".hero-beam", ".hero-word-light", ".track-widget", ".tilt-plate"]) {
      expect(entry).not.toContain(`${selector} {`);
      expect(css).toContain(`${selector} {`);
    }
    // …and what deliberately STAYED, because every §8 page wears it: moving
    // these would duplicate them into a dozen route chunks, which costs more in
    // total than it saves on the entry.
    for (const shared of [".band-hero {", ".hero-title {", ".staged-clip {"]) {
      expect(entry).toContain(shared);
    }
  });

  it("mounts the beam under the scrims, which is what caps it on a photograph", () => {
    // Paint order IS the safety argument on an image-backed hero: the scrims
    // render after the beam and therefore above it, so the measured wash caps
    // the beam exactly as it caps the upload and the floors bind unchanged. A
    // future tidy-up that moves this block inside the image branch — or below
    // it — silently re-derives contrast this band never re-measured.
    const source = read("./hero.tsx");
    expect(source.indexOf('className="hero-beam-track"')).toBeLessThan(
      source.indexOf("HERO_SCRIMS.css(SCRIM_STACKED)"),
    );
  });

  it("lights the headline only in colours that were measured on this ground", () => {
    // The word sweep is allowed to be dramatic precisely because it spends
    // nothing: it moves type between two known-good colours and never touches
    // the ground. The moment a keyframe here carries a literal, that claim is
    // no longer true and nothing else in the tree would notice.
    const frames = (
      css.match(/@keyframes hero-word-light(?:-accent)? \{[\s\S]*?\n\}/g) || []
    ).join("\n");
    expect(frames).toContain("hero-word-light-accent");
    expect(frames).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(frames).toContain("var(--hero-foreground)");
    expect(frames).toContain("var(--primary)");
    /* The accent word's resting colour is the hero's own AA-corrected ink, not
       `--brand-orange`. That token is the tenant's raw FILL on this app —
       `applyBrand` overwrites its declared value at runtime — so using it as
       type measured 2.12:1 for a navy-primary tenant, and no gate could see it
       because the failing value never appears in a stylesheet. Asserted here
       because a keyframe is exactly the kind of place the fill would come
       back: it reads as a colour rather than as a contrast decision. */
    expect(frames).toContain("var(--primary-ink-hero)");
    expect(frames).not.toContain("--brand-orange");
  });
});

describe("the hero", () => {
  beforeEach(() => setMotion(false));
  afterEach(cleanup);

  const renderHero = () =>
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>,
    );

  it("announces its headline as ONE heading, not a word at a time", () => {
    // `StagedLines` fragments the line into spans so each can carry its own
    // delay. Every fragment is aria-hidden and the whole string is on the
    // container as aria-label, so assistive technology reads a sentence.
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toBeTruthy();
    expect(h1.textContent?.trim().length).toBeGreaterThan(0);
    const staged = h1.querySelector(".staged");
    // Named by real text in a visually-hidden span, NOT by `aria-label` — ARIA
    // prohibits that attribute on a generic element, and with every fragment
    // aria-hidden the heading would announce as empty.
    expect(staged?.hasAttribute("aria-label")).toBe(false);
    expect(staged?.querySelector(".sr-only")?.textContent?.trim()).toBeTruthy();
    // Every animated fragment is hidden from the accessibility tree.
    for (const word of h1.querySelectorAll(".staged-word")) {
      expect(word.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("keeps exactly one h1", () => {
    // N10, and the reason every band below the hero is an h2.
    renderHero();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("numbers the accent word as the SIXTH light, not a second first", () => {
    // The headline is split across two `StagedLines` so the accent can arrive on
    // its own beat, and a left-to-right sweep has to keep reading it as one
    // sentence. Without `wordOffset` the accent word is index 0 of its own
    // instance, its per-word delay collapses to zero, and the wave restarts on
    // the last word — which reads as the effect stuttering.
    renderHero();
    const words = screen
      .getByRole("heading", { level: 1 })
      .querySelectorAll<HTMLElement>(".staged-word");
    const indices = [...words].map((w) => Number(w.style.getPropertyValue("--wi")));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("masks the headline without hiding it from the first paint", () => {
    // Both halves of F-17 at once. The clip is what makes the words rise out of
    // an edge; `paintImmediately` is what stops that edge costing the 691 ms the
    // fade once cost. A clip deep enough to hide a word completely would be the
    // same defect in a different property. Measured on the built page over seven
    // loads each: 248 ms median with the mask, 248 ms without, the H1 both
    // times.
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.querySelectorAll(".staged-clip").length).toBeGreaterThan(0);
    // The line the LCP depends on is painted, not faded: `.staged-word-lit`.
    expect(h1.querySelector(".staged-word-lit")).toBeTruthy();
    // …and the accent word is the one place that is allowed to fade in.
    const accent = [...h1.querySelectorAll(".staged-word")].find(
      (w) => !w.className.includes("staged-word-lit"),
    );
    expect(accent).toBeTruthy();
    expect(accent?.className).toContain("hero-word-light-accent");
  });
});

describe("the departure", () => {
  beforeEach(() => setMotion(false));
  afterEach(cleanup);

  it("settles at 0 under reduced motion, not at 1", () => {
    /* THE REDUCED-MOTION DECISION, AND IT IS NOT AN OFF-BY-ONE.
 
       Every other scrub in this app settles at its END state, because that is
       what §1.2 rule 1 asks for: the animation's finished frame, rendered
       immediately. A DEPARTURE has no end state a reader should be parked in.
       Settling this one at 1 would hand somebody who asked their system for
       less motion a hero that is permanently 62 % sunk, its copy at zero
       opacity and its plate shrunk — the band's own resting composition
       replaced by the state it passes through on the way out.
 
       So `settled: 0` is the deliberate inversion, and it is asserted here
       because it reads like a mistake: the next person to "fix" it to match
       every other call site would blank the front door for exactly the
       audience the rule exists to protect. */
    const source = read("./hero.tsx");
    const call = source.slice(
      source.indexOf("useScrollScrub<HTMLElement>({"),
      source.indexOf("const bandRef"),
    );
    expect(call).toContain('prop: "--exit"');
    expect(call).toMatch(/settled:\s*0\b/);
    // …and the range is narrowed, per F-28: the default finishes after the
    // band has left the screen, which is where §9.1's timeline shipped.
    expect(call).toMatch(/start:\s*0\b/);
    expect(call).toMatch(/end:\s*0\.5\b/);
  });

  it("darkens the band rather than lightening it, which is what makes it free", () => {
    /* The sink is the one departure layer that paints over the copy's ground,
       so it is the one that could spend the scrim's measured contrast. It
       cannot, and the reason is structural rather than careful: every piece of
       copy here is light type on carbon, and this washes TOWARD carbon. A
       future edit to a lighter colour — or to `screen`, which is what the
       beam's first draft reached for — would take the eyebrow down the same
       way that draft took it to 1.9:1, and no gate in this repo could see it.
 
       Asserted as the ground token and nothing else: any literal here is a
       colour a tenant re-brand cannot move, and any blend mode is a different
       effect wearing this one's name. */
    const rule = css.slice(css.indexOf(".hero-sink {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("background: var(--hero)");
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toContain("mix-blend-mode");
  });

  it("mounts the sink under the copy, which is the whole safety argument", () => {
    // Paint order, exactly as it is for the beam above: the sink renders
    // before the grid that holds the headline, so it darkens the GROUND and
    // never the type. Moving this block after the grid would tint every word
    // on the band and no test would otherwise notice.
    const source = read("./hero.tsx");
    expect(source.indexOf('className="hero-sink"')).toBeLessThan(
      source.indexOf('className="hero-grid'),
    );
  });
});

describe("the figure rail", () => {
  beforeEach(() => setMotion(false));
  afterEach(cleanup);

  const withFigures = (figures: React.ComponentProps<typeof Hero>["figures"]) =>
    render(
      <MemoryRouter>
        <Hero figures={figures} />
      </MemoryRouter>,
    );

  it("draws nothing at all for a tenant who has authored no figures", () => {
    // The default, and for most tenants the permanent state. Not a row of
    // dashes and not a skeleton: a placeholder here holds a hole open on the
    // front door of every tenant who has written none, which is the same harm
    // as an invented number in the honest direction. Same rule as the proof
    // strip, asserted separately because this band could regress on its own.
    withFigures([]);
    expect(document.querySelector(".hero-foot")).toBeNull();
    expect(document.querySelector(".hero-cue")).toBeNull();
  });

  it("shows the tenant's own label, figure and unit", () => {
    withFigures([
      { label: { fr: "Volume géré", en: "CBM managed" }, unit: "CBM", value: 41850 },
    ]);
    // Grouping belongs to the reader's locale; the digits are ours.
    expect(screen.getByText(/41.?850/)).toBeInTheDocument();
    expect(screen.getByText("CBM")).toBeInTheDocument();
    expect(screen.getByText("CBM managed")).toBeInTheDocument();
  });

  it("keeps the cue out of the accessibility tree", () => {
    // It names a GESTURE rather than a destination. A screen-reader user moves
    // by landmark and heading and is already past it, so "scroll to explore"
    // announced aloud is an instruction in the wrong modality — and everything
    // it points at is a labelled landmark of its own.
    withFigures([{ label: { fr: "Dossiers", en: "Files" }, value: 12 }]);
    const cue = document.querySelector(".hero-cue");
    expect(cue).not.toBeNull();
    expect(cue).toHaveAttribute("aria-hidden");
  });

  it("still keeps exactly one h1 with the rail mounted", () => {
    // N10. The rail adds two more paragraphs to the band a crawler reads
    // first, and a figure promoted to a heading would be the easy mistake.
    withFigures([{ label: { fr: "Dossiers", en: "Files" }, value: 12 }]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("the route canvas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("schedules no frame loop under reduced motion, even after the paint", async () => {
    // The settled state, drawn once. §1.2 rule 1 is not "a shorter animation",
    // and a rAF loop running for somebody who asked their system to stop moving
    // things is the exact thing it forbids.
    //
    // Waits for the deferral, because "no loop" has to hold AFTER the work is
    // released, not merely before it starts — a test that checked only the
    // synchronous tick would pass on a component that started looping 200 ms
    // later.
    setMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<RouteCanvas />);
    await new Promise((r) => setTimeout(r, 350));
    expect(raf).not.toHaveBeenCalled();
  });

  it("draws its settled frame after the paint, rather than never", async () => {
    // "Settled" means the finished composition — cargo distributed along the
    // lanes. A blank rectangle would be a fallback, not a designed state.
    //
    // It arrives one paint late ON PURPOSE: every call this component makes is
    // a layout or style read, and doing them on mount put 301 ms of forced
    // reflow behind the LCP element. Deferring is not animating, so the
    // reduced-motion promise is untouched — the frame still comes, and it is
    // still the only one.
    setMotion(true);
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === "setTransform" || key === "clearRect") return () => calls.push(key);
          return typeof key === "string" ? () => calls.push(key) : undefined;
        },
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    render(<RouteCanvas />);
    expect(calls).toHaveLength(0);
    await waitFor(() => expect(calls).toContain("arc"), { timeout: 2000 });
    expect(calls).toContain("stroke");
  });

  it("is hidden from assistive technology and takes no pointer events", () => {
    // Decoration behind a headline. It asserts nothing a screen reader needs,
    // and a decoration that ate clicks on the hero's own buttons would be the
    // worst possible trade.
    setMotion(false);
    const { container } = render(<RouteCanvas />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(host.className).toContain("pointer-events-none");
  });
  it("lets the pointer reach the plate: the entrance wrapper is deaf, the plate is not", () => {
    /* THE REGRESSION THIS EXISTS FOR, AND WHAT IT CANNOT SEE.
 
       `.hero-plate-enter` carries `transform-style: preserve-3d` so the plate's
       tilt reaches `.tilt-stage`'s perspective two elements up. Chromium
       hit-tests a nested `preserve-3d` subtree against the flat box of the
       element that opens it, so presses over the left ~40% of the plate — the
       reference field's own centre among them — resolved to the WRAPPER and the
       field never saw them. Measured in Chromium before the fix: 22 of 56 sample
       points across the plate reported `div.hero-plate-enter` as the mousedown
       target, focus stayed on `<body>`, and typing went nowhere.
 
       jsdom has no compositor, so no amount of `fireEvent` here reproduces it —
       clicking the input in this file works with the bug present and with it
       gone. What CAN be protected is the pairing, and the pairing is the whole
       fix: the wrapper takes itself out of hit-testing, and the plate puts
       itself back in because `pointer-events` inherits. Delete either line and
       the band is broken in a way nothing else in this repo would notice —
       silently for the wrapper's line, and visibly for the plate's. */
    expect(css).toMatch(/\.hero-plate-enter\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.track-widget\s*\{[^}]*pointer-events:\s*auto/);
  });
});
