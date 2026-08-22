/** The corporate-entity form is wired to the country-aware closed picker. */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CorporateEntitiesPage } from "./corporate-entities";

const openNew = async () => {
  const user = userEvent.setup();
  renderScreen(<CorporateEntitiesPage />, {
    routes: { "/entities": [], "/tax-jurisdictions": [] },
  });
  await user.click(await screen.findByRole("button", { name: "New entity" }));
  await screen.findByRole("dialog", { name: "New corporate entity" });
  return user;
};

describe("Corporate entity · legal form", () => {
  it("renders every visible date day-first rather than using the workstation locale", async () => {
    const user = await openNew();
    const incorporated = screen.getByLabelText("Date of incorporation");
    const dissolved = screen.getByLabelText("Dissolution date");

    expect(incorporated).toHaveAttribute("placeholder", "dd/mm/yyyy");
    expect(dissolved).toHaveAttribute("placeholder", "dd/mm/yyyy");
    expect(incorporated).toHaveAttribute("type", "text");
    expect(dissolved).toHaveAttribute("type", "text");

    await user.type(incorporated, "03072026");
    await user.type(dissolved, "11122026");
    expect(incorporated).toHaveValue("03/07/2026");
    expect(dissolved).toHaveValue("11/12/2026");
  });

  it("uses Cameroon from the country library to offer the OHADA picker", async () => {
    const user = await openNew();
    const legalForm = screen.getByRole("combobox", { name: "Legal form" });
    expect(legalForm).toHaveTextContent("Select a legal form");

    await user.click(legalForm);
    expect(
      screen.getByRole("option", {
        name: /^SARL, Société à Responsabilité Limitée,/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /^legal form$/i }),
    ).not.toBeInTheDocument();
  });

  it("clears a jurisdiction-specific form when the country changes", async () => {
    const user = await openNew();
    await user.click(screen.getByRole("combobox", { name: "Legal form" }));
    await user.click(
      screen.getByRole("option", {
        name: /^SARL, Société à Responsabilité Limitée,/i,
      }),
    );
    expect(
      screen.getByRole("combobox", { name: "Legal form" }),
    ).toHaveTextContent("SARL");

    const country = screen.getByRole("button", { name: "Country" });
    await user.click(country);
    await user.type(screen.getByLabelText("Search countries"), "Germany");
    await user.click(screen.getByRole("option", { name: /Germany/i }));

    expect(
      screen.getByRole("combobox", { name: "Legal form" }),
    ).toHaveTextContent("Select a legal form");
    await user.click(screen.getByRole("combobox", { name: "Legal form" }));
    await user.type(
      screen.getByRole("combobox", { name: "Search legal form" }),
      "Gesellschaft mit beschränkter Haftung",
    );
    expect(
      screen.getByRole("option", {
        name: /^GmbH, Gesellschaft mit beschränkter Haftung,/i,
      }),
    ).toBeInTheDocument();
  });
});
