import { describe, expect, it } from "vitest";
import {
  IDENTITY_COUNT,
  modeColor,
  serviceIdentity,
} from "@/lib/service-identity";

/**
 * The identity table is what makes four service cards read as four service
 * lines. Three properties hold it up, and each one is a way the grid has
 * already been got wrong once.
 */
describe("the service identity palette", () => {
  it("gives the first four cards four distinct colours, glyphs and codes", () => {
    // The acceptance line for the whole item: four cards, four colours. A table
    // that repeated a mode at position two would still typecheck and would
    // still look deliberate to whoever wrote it.
    const four = [0, 1, 2, 3].map(serviceIdentity);
    expect(new Set(four.map((i) => i.mode)).size).toBe(4);
    expect(new Set(four.map((i) => i.code)).size).toBe(4);
    expect(new Set(four.map((i) => i.icon)).size).toBe(4);
  });

  it("cycles, so an eleven-service index still gets a card for each", () => {
    expect(serviceIdentity(IDENTITY_COUNT)).toBe(serviceIdentity(0));
    expect(serviceIdentity(IDENTITY_COUNT + 2)).toBe(serviceIdentity(2));
  });

  it("folds a negative index rather than reading from the end", () => {
    // `findIndex` returns -1 for a service the published list does not carry,
    // and `IDENTITIES[-1 % 4]` is `undefined` — a crash on the service page,
    // one row of the array away from looking correct. Call sites guard on -1;
    // this is the second lock on the same door.
    expect(serviceIdentity(-1)).toBeDefined();
    expect(serviceIdentity(-1).mode).toBe(serviceIdentity(3).mode);
  });

  it("paints from a token, never a literal", () => {
    // A hex here would bake one tenant's palette into a component every tenant
    // renders, and would survive a re-brand that changed everything around it.
    expect(modeColor("sea")).toBe("rgb(var(--mode-sea))");
    expect(modeColor("rail")).toContain("var(--mode-");
  });
});
