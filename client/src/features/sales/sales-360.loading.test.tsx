/**
 * Switching leads used to flash. This is the guard on the fix.
 *
 * The cause was the placeholder, not the request: the dossier rendered
 * `<SkeletonTable />` while loading, so picking another lead went full dossier →
 * a short table-shaped card → full dossier. The shape changed and the page
 * height collapsed and sprang back, which on a scrolled page moves everything
 * under the cursor.
 *
 * Three things make it calm, and each is asserted here because each can be
 * undone by an innocent-looking edit:
 *
 *   1. The loading state is DOSSIER-shaped, not table-shaped.
 *   2. It shows the record's real name and state straight away — the register
 *      already has both from the row that was clicked — so nothing about the
 *      identity changes when the data lands.
 *   3. It does NOT show the previous record's data while fetching the next.
 *      That is the cheaper way to kill a flash and it is the wrong one: it
 *      renders one lead's figures under another lead's name for as long as the
 *      request takes.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { LeadDossier } from "./sales-360";

const dossier = (name: string, status = "QUALIFIED") => ({
  lead: { lead_id: "L1", company_name: name, status, public_ref: "LD-1" },
  kpis: {
    meetings: 1,
    discovery_sections_captured: 2,
    quote_requests: 0,
    proposals: 1,
    proposals_sent: 1,
    proposals_accepted: 0,
    enquiries: 0,
    opportunities: 1,
    open_opportunities: 1,
    won_opportunities: 0,
    lost_opportunities: 0,
    open_pipeline_value: 72_000_000,
    weighted_pipeline_value: 43_200_000,
    proposals_value: 4_000_000,
    money_visible: true,
  },
  meetings: [],
  quote_requests: [],
  proposals: [],
  opportunities: [],
  enquiries: [],
  client: null,
  timeline: [],
});

describe("Lead 360 · the loading state", () => {
  it("shows the name and status the register already knew, before the data lands", async () => {
    renderScreen(
      <LeadDossier
        leadId="L1"
        placeholder={{ title: "Tema Shipping", status: "QUALIFIED" }}
      />,
      { routes: { "/leads/L1/360": dossier("Tema Shipping") } },
    );

    // Synchronously, on the very first paint — no blank frame, no spinner.
    expect(screen.getByRole("status", { name: /loading record/i })).toBeInTheDocument();
    expect(screen.getByText("Tema Shipping")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByRole("status", { name: /loading dossier/i })).toBeNull(),
    );
    // Still the same heading afterwards: the identity never changed.
    expect(screen.getByText("Tema Shipping")).toBeInTheDocument();
  });

  it("keeps the dossier's shape — its own tabs, not a table", async () => {
    renderScreen(
      <LeadDossier leadId="L1" placeholder={{ title: "Tema Shipping" }} />,
      { routes: { "/leads/L1/360": dossier("Tema Shipping") } },
    );

    // The tab labels are known before the data is, so they are drawn for real.
    // (`getAllByText` because once loaded, some of these words also appear as a
    // KPI label — the point here is that the tab strip exists in both states.)
    for (const tab of ["Overview", "Meetings", "Proposals", "Opportunities", "History"]) {
      expect(screen.getAllByText(tab).length).toBeGreaterThan(0);
    }
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: /loading dossier/i })).toBeNull(),
    );
    // And they are still there, so the tab strip did not move.
    for (const tab of ["Overview", "Meetings", "Proposals", "Opportunities", "History"]) {
      expect(screen.getAllByText(tab).length).toBeGreaterThan(0);
    }
  });

  it("never shows one lead's figures under another lead's name", async () => {
    // A register in miniature: the same component instance, a different record.
    // Rendered through the harness so the providers stay in place across the
    // switch — the thing a bare `rerender` would drop.
    function Switcher() {
      const [id, setId] = React.useState("L1");
      return (
        <div>
          <button onClick={() => setId("L2")}>switch</button>
          <LeadDossier
            leadId={id}
            placeholder={{ title: id === "L1" ? "Tema Shipping" : "Nordic Cargo" }}
          />
        </div>
      );
    }

    const user = userEvent.setup();
    renderScreen(<Switcher />, {
      routes: {
        "/leads/L1/360": dossier("Tema Shipping"),
        "/leads/L2/360": dossier("Nordic Cargo"),
      },
    });
    await screen.findByText("Open pipeline");

    await user.click(screen.getByRole("button", { name: "switch" }));

    // The header reads the NEW lead immediately, and the old one is gone —
    // the failure mode "keep previous data while loading" would have introduced.
    expect(screen.getByText("Nordic Cargo")).toBeInTheDocument();
    expect(screen.queryByText("Tema Shipping")).toBeNull();

    await waitFor(() => expect(screen.getByText("Open pipeline")).toBeInTheDocument());
    expect(screen.getByText("Nordic Cargo")).toBeInTheDocument();
  });

  it("says so plainly when the dossier comes back without its record", async () => {
    renderScreen(<LeadDossier leadId="L1" />, {
      routes: { "/leads/L1/360": { kpis: {}, meetings: [] } },
    });
    expect(await screen.findByText(/came back empty/i)).toBeInTheDocument();
  });
});
