/**
 * statusTone / StatusPill — the replacement for the deleted `Badge`.
 *
 * `Badge`'s 27-entry hardcoded map (`bg-sky-500/10 text-sky-600
 * dark:text-sky-400`, …) was the single largest source of the 122 raw-palette
 * violations in F14 — one table, not scatter. These tests pin the semantic
 * mapping that replaced it, and pin the invariant that matters commercially:
 * status colour must come from tokens, so it re-tints per tenant and inherits
 * Phase 1's AA-corrected --ok/--warn/--bad.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Pill, StatusPill, statusTone } from "./pill";

describe("statusTone", () => {
  it.each([
    ["WON", "ok"],
    ["ACCEPTED", "ok"],
    ["ACTIVE", "ok"],
    ["GREEN", "ok"],
    ["LOST", "bad"],
    ["REJECTED", "bad"],
    ["RED", "bad"],
    ["IN_PROGRESS", "warn"],
    ["IN_REVIEW", "warn"],
    ["YELLOW", "warn"],
    ["NEW", "blue"],
    ["OPEN", "blue"],
    ["SENT", "blue"],
    ["QUALIFIED", "orange"],
    ["DRAFT", "mute"],
    ["CLOSED", "mute"],
    ["EXPIRED", "mute"],
  ] as const)("maps %s to the %s tone", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it("is case-insensitive", () => {
    expect(statusTone("won")).toBe("ok");
    expect(statusTone("In_Progress")).toBe("warn");
  });

  it("falls back to mute for an unknown status rather than rendering nothing", () => {
    expect(statusTone("SOME_NEW_BACKEND_STATE")).toBe("mute");
    expect(statusTone(null)).toBe("mute");
    expect(statusTone(undefined)).toBe("mute");
  });
});

describe("StatusPill", () => {
  it("humanises the enum token — Badge rendered 'in review', this renders 'In review'", () => {
    render(<StatusPill status="IN_REVIEW" />);
    expect(screen.getByText("In review")).toBeInTheDocument();
  });

  it("uses only design-system status classes, never a raw palette colour (F14)", () => {
    const { container } = render(<StatusPill status="WON" />);
    const el = container.querySelector("span")!;
    expect(el.className).toContain("st-ok");
    // The whole point: no bg-emerald-500/10, no text-sky-600, no dark: variants.
    expect(el.className).not.toMatch(/emerald|sky|amber|rose|violet|red-\d/);
  });

  it("accepts a tone override for module-specific ladders", () => {
    const { container } = render(<StatusPill status="OPEN" tone="warn" />);
    expect(container.querySelector("span")!.className).toContain("st-warn");
  });

  it("renders an em dash for a missing status instead of an empty pill", () => {
    render(<StatusPill status={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <>
        <StatusPill status="WON" />
        <Pill tone="bad">Overdue</Pill>
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
