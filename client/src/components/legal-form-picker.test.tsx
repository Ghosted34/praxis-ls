/** Country-aware legal-form picker: complete lists, no free-text escape hatch. */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { legalForms } from "@shared";
import { LegalFormPicker } from "./legal-form-picker";

function setup(
  countryCode = "CM",
  value = "",
  onChange = vi.fn(),
  reference = {},
) {
  render(
    <main>
      <LegalFormPicker
        countryCode={countryCode}
        value={value}
        reference={reference}
        onChange={onChange}
      />
    </main>,
  );
  return { onChange };
}

describe("LegalFormPicker", () => {
  it("requires the country first", () => {
    setup("");
    const picker = screen.getByRole("combobox", { name: "Legal form" });
    expect(picker).toBeDisabled();
    expect(picker).toHaveTextContent("Select a country first");
  });

  it("offers every verified Cameroon/OHADA form", async () => {
    const user = userEvent.setup();
    setup("CM");
    await user.click(screen.getByRole("combobox", { name: "Legal form" }));

    const list = screen.getByRole("listbox", { name: "Legal form results" });
    expect(within(list).getAllByRole("option")).toHaveLength(
      legalForms.forCountry("CM").length + 1,
    );
    for (const form of [
      "SARL",
      "SARLU",
      "SA",
      "SAS",
      "SASU",
      "SNC",
      "SCS",
      "GIE",
      "SCOOPS",
      "COOP-CA",
    ]) {
      expect(
        within(list).getByRole("option", {
          name: new RegExp(`^${form.replace("-", "\\-")},`, "i"),
        }),
      ).toBeInTheDocument();
    }
  });

  it("emits the printable value and complete OHADA reference", async () => {
    const user = userEvent.setup();
    const { onChange } = setup("CM");
    await user.click(screen.getByRole("combobox", { name: "Legal form" }));
    const search = screen.getByRole("combobox", { name: "Search legal form" });
    await user.type(search, "Société à responsabilité limitée");
    await user.click(
      screen.getByRole("option", {
        name: /^SARL, Société à Responsabilité Limitée,/i,
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      code: "SARL",
      source: "OHADA",
      jurisdiction_code: "CM",
      abbreviation: "SARL",
      name: "Société à Responsabilité Limitée",
      kind: "LEGAL_ENTITY",
    });
  });

  it("finds Germany's canonical GmbH record by local name", async () => {
    const user = userEvent.setup();
    const { onChange } = setup("DE");
    await user.click(screen.getByRole("combobox", { name: "Legal form" }));
    await user.type(
      screen.getByRole("combobox", { name: "Search legal form" }),
      "Gesellschaft mit beschränkter Haftung",
    );
    await user.click(
      screen.getByRole("option", {
        name: /^GmbH, Gesellschaft mit beschränkter Haftung,/i,
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "2HBR",
        source: "GLEIF_ISO_20275",
        jurisdiction_code: "DE",
        abbreviation: "GmbH",
      }),
    );
  });

  it("disambiguates US forms by state", async () => {
    const user = userEvent.setup();
    const { onChange } = setup("US");
    await user.click(screen.getByRole("combobox", { name: "Legal form" }));
    await user.type(
      screen.getByRole("combobox", { name: "Search legal form" }),
      "Delaware LLC",
    );

    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.click(
      screen.getByRole("option", {
        name: /^LLC, Limited Liability Company, Delaware, HZEH$/i,
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "HZEH",
        jurisdiction_code: "US-DE",
        abbreviation: "LLC",
      }),
    );
  });

  it("does not commit unmatched text and is accessibility-clean", async () => {
    const user = userEvent.setup();
    const { onChange } = setup("NG");
    await user.click(screen.getByRole("combobox", { name: "Legal form" }));
    const search = screen.getByRole("combobox", { name: "Search legal form" });
    await user.type(search, "Made Up Company Type{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("No legal form found")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "Ltd/Gte");
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("recognises an unambiguous legacy value without rewriting it", () => {
    const onChange = vi.fn();
    setup("CM", "SARL", onChange);
    expect(
      screen.getByRole("combobox", { name: "Legal form" }),
    ).toHaveTextContent("Société à Responsabilité Limitée");
    expect(onChange).not.toHaveBeenCalled();
  });
});
