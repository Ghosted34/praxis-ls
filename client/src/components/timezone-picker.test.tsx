/**
 * TimezonePicker proves the two things a text box could not: the whole world is
 * present, and search text can only resolve to a catalogue value.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { timezones } from "@shared";

import { TimezonePicker } from "./timezone-picker";

function setup(value = "", onChange = vi.fn()) {
  render(
    <main>
      <TimezonePicker value={value} onChange={onChange} label="Timezone" />
    </main>,
  );
  return { onChange };
}

describe("TimezonePicker", () => {
  it("offers every canonical geographic timezone plus UTC", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("combobox", { name: "Timezone" }));
    const list = await screen.findByRole("listbox", {
      name: "Timezone results",
    });

    // One optional "No timezone" row plus the closed canonical catalogue.
    expect(within(list).getAllByRole("option")).toHaveLength(
      timezones.CATALOGUE.length + 1,
    );
    expect(timezones.CATALOGUE).toHaveLength(419);
    expect(
      within(list).getByRole("option", { name: /Douala.*Africa\/Douala/i }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("option", {
        name: /Auckland.*Pacific\/Auckland/i,
      }),
    ).toBeInTheDocument();
  });

  it("filters immediately by country and stores only the selected IANA id", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("combobox", { name: "Timezone" }));

    const search = screen.getByRole("combobox", {
      name: "Search timezone",
    });
    await user.type(search, "Cameroon");

    const option = screen.getByRole("option", {
      name: /Douala.*Africa\/Douala/i,
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith("Africa/Douala");
  });

  it("finds modern zones from deprecated aliases but never saves the alias", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("combobox", { name: "Timezone" }));
    await user.type(
      screen.getByRole("combobox", { name: "Search timezone" }),
      "Europe/Kiev",
    );

    const option = screen.getByRole("option", {
      name: /Kyiv.*Europe\/Kyiv/i,
    });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith("Europe/Kyiv");
  });

  it("does not commit unmatched search text", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("combobox", { name: "Timezone" }));
    const search = screen.getByRole("combobox", {
      name: "Search timezone",
    });
    await user.type(search, "Mars/Olympus{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("No timezone found")).toBeInTheDocument();
  });

  it("supports keyboard selection and has no accessibility violations", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("combobox", { name: "Timezone" }));
    const search = screen.getByRole("combobox", {
      name: "Search timezone",
    });
    await user.type(search, "Africa/Douala{Enter}");
    expect(onChange).toHaveBeenCalledWith("Africa/Douala");

    // Re-open and narrow the large list before axe; semantics are identical and
    // this keeps the test focused rather than making axe walk 419 duplicate rows.
    await user.click(screen.getByRole("combobox", { name: "Timezone" }));
    await user.type(
      screen.getByRole("combobox", { name: "Search timezone" }),
      "Douala",
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
