import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CorridorScene, __capable } from "./corridor-scene";
import { buildGraph, abstractGraph } from "@/lib/corridor-graph";
import * as api from "@/lib/corridors-api";
import * as site from "@/lib/site-api";

/**
 * The signature set piece (§7.5).
 *
 * ── THE BASELINE IS TESTED WITHOUT WEBGL, WHICH IS THE POINT ──────────────
 *
 * jsdom has no WebGL context, no `deviceMemory` and no `navigator.connection`.
 * That makes it exactly the environment §7.5(b) cares about: "a visitor who
 * never gets the WebGL scene must not be able to tell something is missing."
 * Every test below runs in that world, and the scene is expected to be
 * complete — labelled, navigable, readable — with no error state and no hole.
 */

const lane = (over: Partial<api.Corridor> = {}): api.Corridor => ({
  origin: "Douala",
  destination: "N'Djamena",
  mode: "LAND",
  files: 12,
  ...over,
});

function setMedia(opts: { reduced?: boolean; fine?: boolean } = {}) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion")
        ? Boolean(opts.reduced)
        : query.includes("pointer: fine")
          ? opts.fine !== false
          : false,
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

/** Most tests do not care about entities; the endpoint answering an empty
 *  array is the NORMAL state (`public_enabled` is off by default, 13787). */
beforeEach(() => {
  setMedia();
  vi.spyOn(site, "listPublicEntities").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the graph", () => {
  it("makes one node per place, not one per endpoint", () => {
    // A hub that is the origin of two lanes and the destination of a third is
    // ONE place. Drawing it three times is what turns a network back into a
    // list of pairs.
    const g = buildGraph([
      lane({ origin: "Douala", destination: "Kribi" }),
      lane({ origin: "Douala", destination: "Yaoundé" }),
      lane({ origin: "Kribi", destination: "Douala" }),
    ]);
    expect(g.nodes.map((n) => n.label).sort()).toEqual(["Douala", "Kribi", "Yaoundé"]);
    expect(g.lanes).toHaveLength(3);
  });

  it("weights a place by the files through it, both directions", () => {
    const g = buildGraph([
      lane({ origin: "Douala", destination: "Kribi", files: 10 }),
      lane({ origin: "Kribi", destination: "Douala", files: 5 }),
    ]);
    expect(g.nodes.find((n) => n.label === "Douala")?.weight).toBe(15);
  });

  it("falls back to the abstract graph when the ledger publishes nothing", () => {
    // The k-anonymity floor answers an empty array for a young tenant, which is
    // the NORMAL case, not an error.
    expect(buildGraph([]).abstract).toBe(true);
  });

  it("gives the abstract graph no labels and no weights", () => {
    // §7.5: "abstract by design … it must never imply lanes the tenant does not
    // run." A node with a name is a claim; a node with a count is a bigger one.
    const g = abstractGraph();
    expect(g.nodes.every((n) => n.label === null)).toBe(true);
    expect(g.nodes.every((n) => n.weight === 0)).toBe(true);
  });
});

describe("the baseline, with no WebGL anywhere", () => {
  it("draws a complete, labelled scene", async () => {
    vi.spyOn(api, "listCorridors").mockResolvedValue([lane()]);
    render(<CorridorScene />);
    expect(await screen.findByRole("group")).toBeTruthy();
    // Real places, from the ledger.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Douala" })).toBeTruthy(),
    );
  });

  it("shows no error, no spinner and no 'unavailable' anywhere", async () => {
    // The absence of the enhancement is not a state to report. There is a
    // scene, and it is this one.
    vi.spyOn(api, "listCorridors").mockResolvedValue([lane()]);
    const { container } = render(<CorridorScene />);
    await screen.findByRole("group");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.textContent).not.toMatch(/unavailable|indisponible|loading/i);
  });

  it("still draws a scene when the read fails", async () => {
    // FEATURE_DISABLED for a tenant without the website package. The abstract
    // graph is the answer, not a blank band.
    vi.spyOn(api, "listCorridors").mockRejectedValue(new Error("off"));
    render(<CorridorScene />);
    expect(await screen.findByRole("group")).toBeTruthy();
  });

  it("names no place and shows no count when the graph is abstract", async () => {
    vi.spyOn(api, "listCorridors").mockResolvedValue([]);
    render(<CorridorScene />);
    await screen.findByRole("group");
    // No node is a button, because none of them means anything to press.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // And the readout, which is the only place a number ever appears, is absent.
    expect(document.querySelector(".corridor-readout")).toBeNull();
  });
});

describe("where the tenant IS, not merely where they deliver", () => {
  const entity = (codes: string[]): site.PublicEntity => ({
    id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
    trading_name: null,
    country_code: codes[0] ?? null,
    coverage: codes.slice(1).map((c) => ({ country_code: c })),
  });

  it("joins on the country CODE, never on a place name", () => {
    // Matching an entity's address against a corridor's place name is
    // inference — "Douala" against "Douala, Littoral, Cameroun" works until the
    // first tenant who writes it differently, and a page that mislabels where a
    // company is, is what N12 exists to prevent. Both sides here are codes the
    // tenant authored.
    const g = buildGraph(
      [
        lane({ origin: "Douala", origin_country: "CM", destination: "Paris", destination_country: "FR" }),
      ],
      site.coveredCountries([entity(["CM"])]),
    );
    expect(g.nodes.find((n) => n.label === "Douala")?.present).toBe(true);
    expect(g.nodes.find((n) => n.label === "Paris")?.present).toBe(false);
  });

  it("marks nothing when a corridor row carries no country", () => {
    // `origin_country` is optional on the endpoint and plenty of rows have
    // none. An unmarked node is the correct answer; a guessed one is a claim.
    const g = buildGraph([lane({ origin: "Douala", destination: "Paris" })], new Set(["CM"]));
    expect(g.nodes.every((n) => n.present === false)).toBe(true);
  });

  it("marks nothing when the tenant has published no entity", () => {
    // `public_enabled` is off by default, so this is the DEFAULT state. An
    // absence marks nothing rather than everything.
    const g = buildGraph(
      [lane({ origin: "Douala", origin_country: "CM", destination: "Paris", destination_country: "FR" })],
      site.coveredCountries([]),
    );
    expect(g.nodes.every((n) => n.present === false)).toBe(true);
  });

  it("reads an entity's own country AND its coverage list", () => {
    const covered = site.coveredCountries([entity(["CM", "TD", "CF"])]);
    expect([...covered].sort()).toEqual(["CF", "CM", "TD"]);
  });

  it("is case-insensitive on the code, since two tables author it", () => {
    const covered = site.coveredCountries([
      { ...entity(["cm"]), coverage: [{ country_code: "td" }] },
    ]);
    expect(covered.has("CM")).toBe(true);
    expect(covered.has("TD")).toBe(true);
  });

  it("says it in words, not only as a ring", async () => {
    // The ring means nothing to a reader who cannot see it, and this is the one
    // genuinely new fact the entities read contributes.
    vi.spyOn(api, "listCorridors").mockResolvedValue([
      lane({ origin: "Douala", origin_country: "CM", destination: "Paris", destination_country: "FR", files: 30 }),
    ]);
    vi.spyOn(site, "listPublicEntities").mockResolvedValue([entity(["CM"])]);
    render(<CorridorScene />);
    await screen.findByRole("group");
    await waitFor(() => expect(document.querySelector(".corridor-readout-present")).toBeTruthy());
  });
});

describe("the keyboard", () => {
  it("is ONE tab stop — the figure — with no node in the tab sequence", async () => {
    // The WAI-ARIA composite-widget pattern. Fifteen nodes as fifteen tabstops
    // is a decoration that costs a keyboard user fifteen keystrokes to get
    // past; and the near-miss version — a roving `tabindex="0"` on the active
    // node — puts them straight back inside the scene on the first Tab after
    // Escape. Every node is `-1`, which is programmatically focusable and
    // untabbable, which is exactly what the arrow keys need and nothing more.
    vi.spyOn(api, "listCorridors").mockResolvedValue([
      lane({ origin: "Douala", destination: "Kribi", files: 9 }),
      lane({ origin: "Kribi", destination: "Yaoundé", files: 4 }),
    ]);
    render(<CorridorScene />);
    const group = await screen.findByRole("group");
    await waitFor(() => expect(screen.getAllByRole("button").length).toBe(3));

    expect(group.getAttribute("tabindex")).toBe("0");
    for (const node of screen.getAllByRole("button")) {
      expect(node.getAttribute("tabindex")).toBe("-1");
    }

    // The arrows still move focus, which is the half that has to keep working.
    group.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).not.toBe(group);
    expect(
      (document.activeElement as Element)?.classList.contains("corridor-node"),
    ).toBe(true);
  });

  it("leaves on Escape rather than trapping anybody", async () => {
    // §7.5 asks for a focus trap; this deliberately does not build one — see
    // the note on onKeyDown. Escape returns focus to the figure, so the next
    // Tab continues down the page.
    vi.spyOn(api, "listCorridors").mockResolvedValue([lane()]);
    render(<CorridorScene />);
    const group = await screen.findByRole("group");
    group.focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(group);
  });
});

describe("the capability gate", () => {
  const nav = navigator as Navigator & {
    connection?: unknown;
    deviceMemory?: number;
  };
  const set = (key: string, value: unknown) =>
    Object.defineProperty(nav, key, { value, configurable: true, writable: true });

  afterEach(() => {
    set("connection", undefined);
    set("deviceMemory", undefined);
  });

  it("passes on a capable desktop that reports nothing", () => {
    // deviceMemory and connection are Chromium-only. Treating "not reported" as
    // a failure would withhold the scene from every Safari and Firefox visitor
    // on a workstation — the opposite of what the gate is for.
    setMedia({ fine: true });
    expect(__capable()).toBe(true);
  });

  it("refuses a slow connection", () => {
    setMedia({ fine: true });
    set("connection", { effectiveType: "3g" });
    expect(__capable()).toBe(false);
  });

  it("obeys Save-Data", () => {
    // The visitor has asked their browser to use less data. Nothing decorative
    // overrides that.
    setMedia({ fine: true });
    set("connection", { effectiveType: "4g", saveData: true });
    expect(__capable()).toBe(false);
  });

  it("refuses a low-memory device", () => {
    setMedia({ fine: true });
    set("deviceMemory", 2);
    expect(__capable()).toBe(false);
  });

  it("refuses when the visitor asked for reduced motion", () => {
    setMedia({ reduced: true, fine: true });
    expect(__capable()).toBe(false);
  });
});
