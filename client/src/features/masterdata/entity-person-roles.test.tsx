/**
 * Corporate entities → People & shareholding: one person, several roles (13850).
 *
 * THE REPORT. "We have a shareholder with full ownership as at now who is acting
 * director as well but there is no option of being a shareholder and director."
 * The tab is even captioned "ONE PERSON CAN HOLD SEVERAL ROLES" — while the
 * schema allowed exactly one, so the operator either typed the same human twice
 * or left one of the two facts unrecorded.
 *
 * WHAT THIS PINS, and why at the SCREEN level rather than on the schema:
 *
 *   1. The person who owns 100% and directs the company appears in the
 *      shareholding table AND in the directors' table — one row, two tables. A
 *      correct schema that the screen still partitions by `role` would pass a
 *      unit test and fail the user.
 *   2. The extra roles are VISIBLE where the person is listed, because the
 *      failure being fixed was a row that read as "owner, not on the board".
 *   3. The quick route: "Add role" on a holder row opens the person's form with
 *      the roles already ticked, and saving sends `role_tags` — the field the
 *      server validates and the 13850 CHECK constrains.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as apiClient from "@/lib/api-client";

import { EntityDossier } from "./entity-360";

/** The owner-director, filed under the role that pays the bills. */
const OWNER_DIRECTOR = {
  person_id: "p1",
  role: "SHAREHOLDER",
  role_tags: ["DIRECTOR"],
  holder_type: "PERSON",
  full_name: "Massomba Timothée",
  title: "Directeur Général",
  share_class: "ORDINARY",
  share_count: 1000,
  share_nominal_value: 10000,
  ownership_percent: 100,
  voting_percent: 100,
  effective_from: "2021-09-21",
  is_active: true,
};

/** A second shareholder with no other hat — the control case. */
const PLAIN_HOLDER = {
  person_id: "p2",
  role: "SHAREHOLDER",
  role_tags: [],
  holder_type: "COMPANY",
  full_name: "SLAS Holding SA",
  share_class: "ORDINARY",
  share_count: 0,
  ownership_percent: 0,
  is_active: true,
};

const BASE = {
  entity: {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
    legal_form: "SARL",
    country_code: "CM",
    registration_status: "ACTIVE",
    is_active: true,
    default_currency: "XAF",
    share_capital: 10_000_000,
    share_capital_currency: "XAF",
  },
  structure: {
    parent_entity_id: null,
    relationship_type: null,
    ownership_percent: null,
    consolidates: false,
    is_group_parent: false,
    ancestors: [],
    children: [],
  },
  contacts: [],
  addresses: [],
  registrations: [],
  establishments: [],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: {
    as_of: "2026-07-01",
    holder_count: 2,
    total_percent: 100,
    total_shares: 1000,
    issued_capital: 10_000_000,
    balanced: true,
    findings: [],
  },
  usage: {
    journal_entries: 0,
    employees: 0,
    treasury_accounts: 0,
    subsidiaries: 0,
  },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [],
  can_see_governance: true,
  letterhead_config: null,
  letterhead_source: {},
  letterhead_preview: {
    language: "fr",
    paper_size: "A4",
    logo_position: "LEFT",
    header: {},
    footer: {},
    payment_block: { source: "none", accounts: [] },
    identifiers: [],
    empty_blocks: [],
  },
  renewals: {
    as_of: "2026-07-01",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
};

const routes = (people: unknown[]) => ({
  "/entities/e1/360": { ...BASE, people },
  "/party-document-types": [],
});

async function openPeopleTab(people: unknown[] = [OWNER_DIRECTOR, PLAIN_HOLDER]) {
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: routes(people),
  });
  await user.click(
    await screen.findByRole("button", { name: /people & shareholding/i }),
  );
  return user;
}

/** The table a person's row sits in, found by its section heading. */
function tableOf(section: string | RegExp): HTMLElement {
  const heading = screen.getByRole("heading", { name: section });
  const sectionEl = heading.closest("section") as HTMLElement;
  return within(sectionEl).getByRole("table");
}

afterEach(() => vi.restoreAllMocks());

describe("Corporate entities · a person with several roles", () => {
  it("lists the owner-director in BOTH tables, in one row each", async () => {
    await openPeopleTab();

    const holders = tableOf(/^Shareholding$/i);
    const officers = tableOf(/^Directors, officers and signatories$/i);

    expect(within(holders).getAllByText("Massomba Timothée")).toHaveLength(1);
    expect(within(officers).getAllByText("Massomba Timothée")).toHaveLength(1);
    // …and the person with no second role is only a holder.
    expect(within(holders).getByText("SLAS Holding SA")).toBeInTheDocument();
    expect(within(officers).queryByText("SLAS Holding SA")).toBeNull();
  });

  it("shows the extra role on the shareholding row", async () => {
    await openPeopleTab();

    const row = within(tableOf(/^Shareholding$/i))
      .getByText("Massomba Timothée")
      .closest("tr") as HTMLElement;
    // Without the pill, the row reads as an owner who is not on the board —
    // the exact misreading the feature exists to prevent.
    expect(within(row).getByText("Director")).toBeInTheDocument();
  });

  it("shows every role on the directors' row, primary one included", async () => {
    await openPeopleTab();

    const row = within(tableOf(/^Directors, officers and signatories$/i))
      .getByText("Massomba Timothée")
      .closest("tr") as HTMLElement;
    expect(within(row).getByText("Director")).toBeInTheDocument();
    // A director who owns the company is a shareholder on this row too: a
    // contract clause about "the shareholder" may be about this person.
    expect(within(row).getByText("Shareholder")).toBeInTheDocument();
  });

  it("counts them once as a holder and once as a director", async () => {
    await openPeopleTab();

    const holders = tableOf(/^Shareholding$/i);
    const officers = tableOf(/^Directors, officers and signatories$/i);
    // One person, two rows — not two people (two database rows would have made
    // the cap table read 2 holders and the totals wrong).
    expect(within(holders).getAllByRole("row")).toHaveLength(3); // header + 2
    expect(within(officers).getAllByRole("row")).toHaveLength(2); // header + 1
  });
});

describe("Corporate entities · adding a second role to an existing holder", () => {
  it("offers a one-press route from the holder row", async () => {
    const user = await openPeopleTab();
    const row = within(tableOf(/^Shareholding$/i))
      .getByText("Massomba Timothée")
      .closest("tr") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: /add role/i }));

    // The person's own form, opened for THIS person (not a blank "Add person"),
    // with the roles they already hold ticked.
    expect(
      await screen.findByText(/also acts as — massomba timothée/i),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("group", { name: /also acts as/i }),
      ).getByRole("checkbox", { name: "Director" }),
    ).toBeChecked();
  });

  it("sends role_tags when the third role is ticked and saved", async () => {
    const bodies: Record<string, unknown>[] = [];
    const readThrough = apiClient.tenant;
    const spy = vi.spyOn(apiClient, "tenant").mockImplementation((async (
      path: string,
      init?: { method?: string; body?: Record<string, unknown> },
    ) => {
      if (init?.method === "PATCH" || init?.method === "POST") {
        if (init.body) bodies.push(init.body);
        return {};
      }
      return readThrough(path, init as never);
    }) as typeof apiClient.tenant);

    const user = await openPeopleTab();
    const row = within(tableOf(/^Shareholding$/i))
      .getByText("Massomba Timothée")
      .closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /add role/i }));

    const group = await screen.findByRole("group", { name: /also acts as/i });
    await user.click(
      within(group).getByRole("checkbox", { name: /^legal representative$/i }),
    );
    await user.click(screen.getByRole("button", { name: /^save/i }));

    expect(bodies).toHaveLength(1);
    // Both roles the person holds, in the field the server validates and the
    // 13850 CHECK constrains — not a second row for the same human.
    expect(bodies[0].role_tags).toEqual(["DIRECTOR", "LEGAL_REPRESENTATIVE"]);
    spy.mockRestore();
  });
});
