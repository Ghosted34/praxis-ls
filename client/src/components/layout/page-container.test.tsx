import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PageContainer } from "./page-container";
import { pageShell } from "@/lib/layout";

describe("PageContainer", () => {
  it("defaults to the wide container — data screens should use the display", () => {
    render(<PageContainer>content</PageContainer>);
    // The default matters: the audit's F3 was 86 screens capped at 1152px.
    expect(screen.getByText("content")).toHaveClass("max-w-wide");
  });

  it("applies each named width", () => {
    const cases = [
      ["wide", "max-w-wide"],
      ["standard", "max-w-standard"],
      ["reading", "max-w-reading"],
    ] as const;
    for (const [width, cls] of cases) {
      const { unmount } = render(
        <PageContainer width={width}>{width}</PageContainer>,
      );
      expect(screen.getByText(width)).toHaveClass(cls);
      unmount();
    }
  });

  it("full width applies no max-width cap", () => {
    render(<PageContainer width="full">bleed</PageContainer>);
    const el = screen.getByText("bleed");
    expect(el.className).not.toMatch(/max-w-/);
  });

  it("renders a <section> landmark by default and honours `as`", () => {
    const { container, unmount } = render(<PageContainer>a</PageContainer>);
    expect(container.querySelector("section")).not.toBeNull();
    unmount();
    const { container: c2 } = render(<PageContainer as="div">b</PageContainer>);
    expect(c2.querySelector("section")).toBeNull();
    expect(c2.querySelector("div")).not.toBeNull();
  });

  it("merges caller classNames without dropping the width token", () => {
    render(<PageContainer className="pb-24">merged</PageContainer>);
    const el = screen.getByText("merged");
    expect(el).toHaveClass("pb-24");
    expect(el).toHaveClass("max-w-wide");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PageContainer>
        <h1>Invoices</h1>
      </PageContainer>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("pageShell tokens", () => {
  it("exposes exactly the four sanctioned widths", () => {
    // Guard against the drift F3 documented: five unruled widths across the app.
    expect(Object.keys(pageShell).sort()).toEqual([
      "full",
      "reading",
      "standard",
      "wide",
    ]);
  });

  it("never re-introduces a raw max-w-6xl cap", () => {
    for (const cls of Object.values(pageShell)) {
      expect(cls).not.toContain("max-w-6xl");
    }
  });
});
