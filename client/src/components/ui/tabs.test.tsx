/**
 * `TabList` marks the active tab without being told which one it is.
 *
 * The active style (underline, weight, foreground — `TAB_TRIGGER`) and the
 * strip's scroll-into-view both key off `data-strip-active`, which `TabList`
 * set only when a caller passed `activeKey`. None of the four standalone strips
 * did — the hub, the milestones views, the inbox record drawer, the scaffold
 * screens — so none of them ever showed which tab was open. The Root holds the
 * answer; these pin that the list reads it, whichever way the Root is driven.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import { TabList, TabsRoot, Tabs } from "./tabs";

const TABS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

const marked = () =>
  screen
    .getAllByRole("tab")
    .filter((t) => t.getAttribute("data-strip-active") === "true")
    .map((t) => t.textContent);

describe("TabList", () => {
  it("marks the controlled Root's value when no activeKey is passed", () => {
    render(
      <TabsRoot value="b" onValueChange={() => {}}>
        <TabList label="Sections" tabs={TABS} />
      </TabsRoot>,
    );
    expect(marked()).toEqual(["Bravo"]);
  });

  it("follows a controlled Root as its value changes", async () => {
    function Harness() {
      const [v, setV] = React.useState("a");
      return (
        <TabsRoot value={v} onValueChange={setV} activationMode="manual">
          <TabList label="Sections" tabs={TABS} />
        </TabsRoot>
      );
    }
    render(<Harness />);
    expect(marked()).toEqual(["Alpha"]);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Charlie" }));
    expect(marked()).toEqual(["Charlie"]);
  });

  it("tracks an uncontrolled Root too", async () => {
    render(
      <TabsRoot defaultValue="a">
        <TabList label="Sections" tabs={TABS} />
      </TabsRoot>,
    );
    expect(marked()).toEqual(["Alpha"]);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Bravo" }));
    expect(marked()).toEqual(["Bravo"]);
  });

  it("keeps the highlight when activeKey is null (null only stops the scroll)", () => {
    render(
      <TabsRoot value="c" onValueChange={() => {}}>
        <TabList label="Sections" tabs={TABS} activeKey={null} />
      </TabsRoot>,
    );
    expect(marked()).toEqual(["Charlie"]);
  });

  it("lets an explicit activeKey win, as <Tabs> passes one", () => {
    render(
      <Tabs
        value="b"
        onValueChange={() => {}}
        label="Sections"
        tabs={TABS.map((t) => ({ ...t, content: <p>{t.label} panel</p> }))}
      />,
    );
    expect(marked()).toEqual(["Bravo"]);
  });
});
