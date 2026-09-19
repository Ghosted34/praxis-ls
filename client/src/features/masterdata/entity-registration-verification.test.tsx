/**
 * PR-03 — the registration register distinguishes a stored identifier from a
 * checked one, and only the approve capability exposes that transition.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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

const registration = (verified: boolean) => ({
  registration_id: "rg1",
  country_code: "CM",
  kind: "RCCM",
  number: "RC/DLA/2021/B/206",
  issuing_authority: "TPI Douala-Bonanjo",
  issued_on: "2021-09-21",
  expires_on: "2027-08-14",
  is_primary: true,
  verified,
  verified_by: verified ? "approver-1" : null,
  verified_at: verified ? "2026-09-19T12:34:56.000Z" : null,
});

const dossier = ({
  verified = false,
  edit = false,
  approve = false,
}: {
  verified?: boolean;
  edit?: boolean;
  approve?: boolean;
}) => ({
  entity: {
    entity_id: "e1",
    code: "SBX",
    legal_name: "SmartBox SARL",
    country_code: "CM",
    registration_status: "ACTIVE",
    is_active: true,
    default_currency: "XAF",
  },
  structure: {
    parent_entity_id: null,
    relationship_type: null,
    ownership_percent: null,
    consolidates: false,
    is_group_parent: true,
    ancestors: [],
    children: [],
  },
  people: [],
  contacts: [],
  addresses: [],
  registrations: [registration(verified)],
  establishments: [],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: {
    as_of: "2026-09-19",
    holder_count: 0,
    total_percent: 0,
    total_shares: 0,
    issued_capital: 0,
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
  capabilities: {
    view: true,
    edit,
    approve,
    public_story: edit,
  },
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
    as_of: "2026-09-19",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
});

async function openRegistrationTab(data: ReturnType<typeof dossier>) {
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: { "/entities/e1/360": data },
  });
  await user.click(
    await screen.findByRole("button", { name: /identity & registrations/i }),
  );
  return user;
}

const registrationRow = () =>
  screen.getByText("RC/DLA/2021/B/206").closest("tr") as HTMLElement;

describe("Corporate entities · registration verification", () => {
  it("lets an approve-only caller verify without exposing edit controls", async () => {
    const calls: { path: string; method?: string }[] = [];
    const readThrough = apiClient.tenant;
    const spy = vi.spyOn(apiClient, "tenant").mockImplementation((async (
      path: string,
      init?: { method?: string },
    ) => {
      if (init?.method === "POST") {
        calls.push({ path, method: init.method });
        return registration(true);
      }
      return readThrough(path, init as never);
    }) as typeof apiClient.tenant);

    try {
      const user = await openRegistrationTab(
        dossier({ approve: true, edit: false }),
      );
      const row = registrationRow();
      expect(within(row).getByText("Not verified")).toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
      expect(within(row).queryByRole("button", { name: "Remove" })).toBeNull();

      await user.click(within(row).getByRole("button", { name: "Verify" }));
      await waitFor(() =>
        expect(calls).toEqual([
          {
            path: "/entities/e1/registrations/rg1/verify",
            method: "POST",
          },
        ]),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("shows verified state/time and offers the selected unverify transition", async () => {
    await openRegistrationTab(dossier({ verified: true, approve: true }));
    const row = registrationRow();

    expect(within(row).getByText("Verified")).toBeInTheDocument();
    expect(within(row).getByText(/19 Sep.*2026/)).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Unverify" }),
    ).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("never exposes verification transitions without caps.approve", async () => {
    await openRegistrationTab(dossier({ edit: true, approve: false }));
    const row = registrationRow();

    expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Verify" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Unverify" })).toBeNull();
  });
});
