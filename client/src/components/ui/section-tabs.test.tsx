/**
 * SectionTabs — the 360's section strip.
 *
 * The behaviour that matters here is not the scrolling (jsdom has no layout, so
 * `scrollWidth` is 0 and the strip correctly reports "nothing to scroll"), it is
 * the contract the six hand-rolled strips disagreed about: a named `<nav>`, a
 * real `<button>` per section, `aria-current="page"` on the live one, and the
 * count as part of the section's own name rather than a separate control the
 * reader has to aim at.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SectionTabs } from "./section-tabs";

const TABS = [
  { value: "Overview" as const, label: "Overview" },
  { value: "Documents" as const, label: "Documents", count: 12 },
  { value: "Renewals" as const, label: "Renewals", count: 0 },
];

function mount(value: string = "Overview", onChange = vi.fn()) {
  render(
    <SectionTabs
      label="Entity sections"
      value={value}
      onChange={onChange}
      tabs={TABS}
    />,
  );
  return onChange;
}

describe("SectionTabs", () => {
  it("shortens a long section on a phone without renaming it anywhere else", () => {
    render(
      <SectionTabs
        label="Entity sections"
        value="Banking & treasury"
        onChange={vi.fn()}
        tabs={[
          { value: "Banking & treasury" as const, label: "Banking & treasury", shortLabel: "Banking" },
        ]}
      />,
    );

    // Both labels are in the DOM and CSS picks one. jsdom loads no stylesheet,
    // so this test can only pin the SHAPE — a phone span and a desktop span —
    // and the thing that actually keeps the two honest: the accessible name is
    // the full label at every width, so nothing downstream (a deep link, a
    // screen reader, a test that named the section) has to know the short one.
    expect(screen.getByText("Banking")).toBeInTheDocument();
    expect(screen.getByText("Banking & treasury")).toBeInTheDocument();
    const tab = screen.getByRole("button", { name: "Banking & treasury" });
    expect(tab).toHaveAttribute("aria-current", "page");
    // The visible spans are hidden from the accessibility tree, so the name can
    // only come from `aria-label` — without it the tab would announce as the
    // two labels run together.
    expect(tab.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2);
  });

  it("keeps the count in the name of a short-labelled section", () => {
    render(
      <SectionTabs
        label="Entity sections"
        value="Documents"
        onChange={vi.fn()}
        tabs={[
          { value: "Documents" as const, label: "Documents", shortLabel: "Docs", count: "3/7" },
        ]}
      />,
    );
    // "Documents 3/7" — `aria-label` wins over content, so a badge left out of
    // it would simply stop being announced.
    expect(screen.getByRole("button", { name: "Documents 3/7" })).toBeInTheDocument();
  });

  it("leaves a tab that needs no shortening alone", () => {
    mount();
    // No `aria-label`: the name comes from the visible text, which is what a
    // reader using voice control will say out loud.
    expect(screen.getByRole("button", { name: "Documents 12" })).not.toHaveAttribute(
      "aria-label",
    );
  });

  it("is a named navigation landmark, not a row of anonymous buttons", () => {
    mount();
    expect(
      screen.getByRole("navigation", { name: "Entity sections" }),
    ).toBeInTheDocument();
  });

  it("marks the section you are on, and only that one", () => {
    mount("Documents");
    const nav = screen.getByRole("navigation", { name: "Entity sections" });

    expect(within(nav).getByRole("button", { name: /^Documents/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(nav).getByRole("button", { name: /^Overview/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("asks for the section that was pressed", async () => {
    const onChange = mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^Renewals/ }));
    expect(onChange).toHaveBeenCalledWith("Renewals");
  });

  it("puts the count in the section's own name, so the tab is one target", () => {
    mount();
    // "Documents 12" — the number is part of the button, not a second control
    // sitting next to it that a thumb can miss.
    expect(screen.getByRole("button", { name: "Documents 12" })).toBeInTheDocument();
  });

  it("shows a zero rather than hiding it — none is information", () => {
    mount();
    expect(screen.getByRole("button", { name: "Renewals 0" })).toBeInTheDocument();
  });

  it("draws no edge fade when there is nothing beyond the edge", () => {
    const { container } = render(
      <SectionTabs label="Entity sections" value="Overview" onChange={vi.fn()} tabs={TABS} />,
    );
    // jsdom reports every scroll metric as 0, which is also the correct
    // behaviour for a strip that fits: a fade over the first tab is a lie the
    // reader pays a swipe to disprove. Scoped to the fades by their own class —
    // a bare `[aria-hidden]` would also count the phone-label span below, and
    // this assertion is about the fades.
    expect(container.querySelectorAll("span[aria-hidden].pointer-events-none")).toHaveLength(0);
  });

  it("disables a section it was told to disable", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionTabs
        label="Entity sections"
        value="Overview"
        onChange={onChange}
        tabs={[...TABS.slice(0, 2), { value: "Renewals" as const, label: "Renewals", disabled: true }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Renewals" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
