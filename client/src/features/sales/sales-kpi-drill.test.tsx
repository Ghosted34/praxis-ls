/**
 * Lead and quote-request 360s → the list tiles open the rows they count.
 *
 * What is pinned, in the order the reader meets it:
 *
 *   1. The five list tiles on a lead are buttons; "Days open" and "Converted
 *      deal" on a quote request are figures and stay inert.
 *   2. Each dialog lists the rows the tile counted — "Open deals" only the OPEN
 *      ones, which is how the server counts them — and "Open pipeline" ranks
 *      them by weighted value, the order they make up the figure in.
 *   3. A row lands on its record: a proposal via `?focus=` on the register, a
 *      quote request on its own route.
 *   4. The register honours that `?focus=`: Proposals opens the proposal.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { IntakeDossier, LeadDossier } from "./sales-360";
import { useFocusOpen } from "@/lib/use-focus-row";

const PROPOSALS = [
  {
    proposal_id: "p1",
    doc_number: "PRO-2026-0012",
    title: "Tema → Douala FCL, 6 × 40ft",
    status: "SENT",
    currency: "XAF",
    total: 4_000_000,
    share_live: true,
    viewed_at: "2026-09-20T09:00:00Z",
    downloaded_at: null,
  },
];
const OPPORTUNITIES = [
  {
    opportunity_id: "o1",
    name: "Small lane",
    status: "OPEN",
    estimated_value: 10_000_000,
    weighted_value: 2_000_000,
    currency: "XAF",
    probability: 20,
    stage_name: "Qualified",
  },
  {
    opportunity_id: "o2",
    name: "Won lane",
    status: "WON",
    estimated_value: 50_000_000,
    weighted_value: 50_000_000,
    currency: "XAF",
    probability: 100,
    stage_name: "Won",
  },
  {
    opportunity_id: "o3",
    name: "Big lane",
    status: "OPEN",
    estimated_value: 62_000_000,
    weighted_value: 41_200_000,
    currency: "XAF",
    probability: 66,
    stage_name: "Proposal",
  },
];

const LEAD = {
  lead: {
    lead_id: "L1",
    company_name: "Tema Shipping",
    status: "QUALIFIED",
    public_ref: "LD-1",
  },
  kpis: {
    meetings: 0,
    discovery_sections_captured: 0,
    quote_requests: 1,
    proposals: 1,
    proposals_sent: 1,
    proposals_accepted: 0,
    enquiries: 0,
    opportunities: 3,
    open_opportunities: 2,
    won_opportunities: 1,
    lost_opportunities: 0,
    open_pipeline_value: 72_000_000,
    weighted_pipeline_value: 43_200_000,
    proposals_value: 4_000_000,
    money_visible: true,
  },
  meetings: [],
  quote_requests: [
    {
      quote_request_id: "q1",
      public_ref: "QR-2026-0031",
      status: "UNDER_REVIEW",
      origin_location: "Tema",
      destination_location: "Douala",
      incoterm: "FOB",
      created_at: "2026-09-18T08:00:00Z",
    },
  ],
  proposals: PROPOSALS,
  opportunities: OPPORTUNITIES,
  enquiries: [],
  client: null,
  timeline: [],
};

const INTAKE = {
  request: {
    quote_request_id: "q1",
    public_ref: "QR-2026-0031",
    status: "UNDER_REVIEW",
  },
  kpis: {
    attachments: 1,
    has_primary_attachment: true,
    proposals: 1,
    is_converted: false,
    age_days: 10,
    converted_value: null,
    money_visible: true,
  },
  attachments: [
    {
      quote_request_attachment_id: "a1",
      kind: "PRIMARY",
      vault_id: "v1",
      original_name: "packing-list.pdf",
      doc_type: "PACKING_LIST",
      uploaded_by_name: "Ama Owusu",
      created_at: "2026-09-18T08:05:00Z",
    },
  ],
  converted_opportunity: null,
  lead: { lead_id: "L1", company_name: "Tema Shipping", status: "QUALIFIED" },
  proposals: PROPOSALS,
  timeline: [],
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

const openTile = async (name: RegExp) => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name }));
  return { user, dialog: await screen.findByRole("dialog") };
};

describe("Lead 360 · drill-ins", () => {
  const render = () =>
    renderScreen(
      <>
        <LeadDossier leadId="L1" />
        <Where />
      </>,
      { routes: { "/leads/L1/360": LEAD } },
    );

  it("makes all five list tiles buttons", async () => {
    render();
    for (const n of [
      /^open meetings$/i,
      /^open quote requests$/i,
      /^open proposals$/i,
      /^open open deals$/i,
      /^open open pipeline$/i,
    ]) {
      expect(
        await screen.findByRole("button", { name: n }),
      ).toBeInTheDocument();
    }
  });

  it("lists only the open deals, as the tile counts them", async () => {
    render();
    const { dialog } = await openTile(/^open open deals$/i);
    expect(within(dialog).getByText("Small lane")).toBeInTheDocument();
    expect(within(dialog).getByText("Big lane")).toBeInTheDocument();
    expect(within(dialog).queryByText("Won lane")).toBeNull();
  });

  it("ranks the pipeline by weighted value", async () => {
    render();
    const { dialog } = await openTile(/^open open pipeline$/i);
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Big lane");
    expect(rows[1]).toHaveTextContent("Small lane");
  });

  it("opens a proposal on the register, focused, and a quote request on its route", async () => {
    render();
    let { user, dialog } = await openTile(/^open proposals$/i);
    expect(
      within(dialog).getByText("Opened", { exact: false }),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "PRO-2026-0012" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/sales/proposals?focus=p1",
      ),
    );

    ({ user, dialog } = await openTile(/^open quote requests$/i));
    await user.click(
      within(dialog).getByRole("button", { name: "QR-2026-0031" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/sales/quote-requests/q1",
      ),
    );
  });
});

describe("Quote-request 360 · drill-ins", () => {
  it("opens attachments and proposals, and leaves the figures inert", async () => {
    renderScreen(<IntakeDossier quoteRequestId="q1" />, {
      routes: { "/quote-requests/q1/360": INTAKE },
    });
    const { user, dialog } = await openTile(/^open attachments$/i);
    expect(within(dialog).getByText("packing-list.pdf")).toBeInTheDocument();
    expect(within(dialog).getByText("Primary")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(
      await screen.findByRole("button", { name: /^open proposals$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open days open/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /open converted deal/i }),
    ).toBeNull();
  });
});

describe("useFocusOpen · the register opens the focused record once", () => {
  /** `rows` starts unloaded (null) unless given; "load" delivers the page. */
  function Register({
    rows: initial = null,
  }: {
    rows?: { id: string }[] | null;
  }) {
    const [rows, setRows] = React.useState(initial);
    const [open, setOpen] = React.useState<string | null>(null);
    useFocusOpen(
      rows,
      (r) => r.id,
      (r) => setOpen(r.id),
    );
    return (
      <>
        <button
          type="button"
          onClick={() => setRows([{ id: "p1" }, { id: "p2" }])}
        >
          load
        </button>
        <p data-testid="open">{open ?? "none"}</p>
        <Where />
      </>
    );
  }

  it("opens the row once it has loaded, then drops the parameter", async () => {
    renderScreen(<Register />, { path: "/sales/proposals?focus=p2" });
    expect(screen.getByTestId("open")).toHaveTextContent("none");
    // Still waiting for the list — the parameter is kept until it can be used.
    expect(screen.getByTestId("where")).toHaveTextContent("?focus=p2");
    await userEvent.setup().click(screen.getByRole("button", { name: "load" }));
    await waitFor(() =>
      expect(screen.getByTestId("open")).toHaveTextContent("p2"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        /^\/sales\/proposals$/,
      ),
    );
  });

  it("drops a focus it cannot find rather than opening anything", async () => {
    renderScreen(<Register rows={[{ id: "p1" }]} />, {
      path: "/sales/proposals?focus=gone",
    });
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        /^\/sales\/proposals$/,
      ),
    );
    expect(screen.getByTestId("open")).toHaveTextContent("none");
  });
});
