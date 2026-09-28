import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isoToDisplay, displayToIso, maskInput } from "./day-first-date";

/**
 * This app's copy of the day-first conversion must be the canonical one,
 * function for function — see the header of `day-first-date.ts` for why it is
 * a subset rather than the byte-identical third twin.
 */
const CANONICAL = join(process.cwd(), "..", "client", "src", "lib", "day-first-date.ts");
const HERE = join(process.cwd(), "src", "lib", "day-first-date.ts");

/** The source of one exported function, from `export function name` to the
 *  closing brace at column zero. */
function body(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end + 2);
}

describe("the day-first conversion", () => {
  it.each(["isoToDisplay", "displayToIso", "maskInput"])("%s is the canonical function, verbatim", (name) => {
    const canonical = body(readFileSync(CANONICAL, "utf8"), name);
    expect(canonical.length).toBeGreaterThan(40);
    expect(body(readFileSync(HERE, "utf8"), name)).toBe(canonical);
  });

  it("reads day-first and refuses a date that does not exist", () => {
    expect(displayToIso("03/07/2026")).toBe("2026-07-03");
    expect(displayToIso("31/02/2026")).toBe("");
    expect(isoToDisplay("2026-07-03")).toBe("03/07/2026");
    expect(maskInput("03072026")).toBe("03/07/2026");
  });
});
