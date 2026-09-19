/**
 * PR-09 — Scalable entity pickers: the SCREEN-level contract.
 *
 * The component contract (server-side ACTIVE-only search, history, states) is
 * pinned in components/entity-picker.test.tsx. What this file pins is that the
 * screens actually moved to it:
 *
 *   - the corporate-entities LIST pages and searches server-side (a 205-entity
 *     tenant can find and open entity 205 — the acceptance condition for
 *     CE-03/CE-35), and no `?limit=200` full-tenant fetch happens anywhere;
 *   - opening a client form or a nested entity modal costs NO tenant-wide
 *     entity list — the fetch happens only when a picker is opened;
 *   - the parent pickers (entity form + group structure) search server-side
 *     and exclude the entity itself / its descendants.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as apiClient from "@/lib/api-client";
import { CorporateEntitiesPage } from "./corporate-entities";
import { ClientsPage } from "./clients";
import { EntityDossier } from "./entity-360";

const ENTITY_360 = {
  entity: {
    entity_id: "e1",
    code: "SBX",
    legal_name: "SmartBox SARL",
    legal_form: "SARL",
    country_code: "CM",
    incorporation_date: "2021-09-21",
    dissolution_date: "2026-12-11",
    registration_status: "ACTIVE",
    is_active: true,
    share_capital: 10_000_000,
    share_capital_currency: "XAF",
    default_currency: "XAF",
    logo_light_ref: "/media/smartbox.png",
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
  contacts: [
    {
      contact_id: "ct1",
      name: "Comptabilité",
      email: "compta@smartbox.cm",
      role_tags: ["BILLING", "TAX"],
      is_primary: true,
    },
  ],
  addresses: [],
  // `issued_on` deliberately carries a TIMESTAMP, which is what the API sent
  // before `shared/db/pg-date-types` — and what a cached response still can.
  // `expires_on` is the plain `YYYY-MM-DD` it sends now. Both must reach the
  // form as a value the date input can render; see the date test below.
  registrations: [
    {
      registration_id: "rg1",
      country_code: "CM",
      kind: "RCCM",
      number: "RC/DLA/2021/B/206",
      issuing_authority: "TPI Douala-Bonanjo",
      issued_on: "2021-09-21T00:00:00.000Z",
      expires_on: "2026-08-14",
      is_primary: false,
      notes: "Filed in the vendor profile folder.",
    },
  ],
  establishments: [
    {
      establishment_id: "es1",
      name: "Siège social",
      kind: "HEAD_OFFICE",
      city: "Douala",
    },
  ],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: {
    as_of: "2026-07-01",
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
  // PR-01: the write gates read this. These tests exercise the edit surfaces
  // (Add/Edit/Remove/Add role), so the fixture carries the full set rather
  // than the read-only default the component falls back to when absent.
  capabilities: {
    view: true,
    edit: true,
    approve: true,
    public_story: true,
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
    as_of: "2026-07-01",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
};
/** The tenant the audit describes: 204 reachable entities plus the 205th. */
const MANY_ENTITIES = Array.from({ length: 205 }, (_, i) => {
  const n = i + 1;
  return {
    entity_id: `e${n}`,
    code: `E${String(n).padStart(3, "0")}`,
    legal_name:
      n === 205
        ? "Omega Freight 205 SAS"
        : `Entity ${String(n).padStart(3, "0")} SARL`,
    registration_status: "ACTIVE",
    is_active: true,
  };
});

const ALPHA = {
  entity_id: "e-alpha",
  code: "ALPHA",
  legal_name: "Alpha Logistics SARL",
  registration_status: "ACTIVE",
  is_active: true,
};
const GONE = {
  entity_id: "e-gone",
  code: "GONE",
  legal_name: "Gone Bureau SARL",
  registration_status: "DEACTIVATED",
  is_active: false,
};

/**
 * Serve `/entities` searches and `/entities/:id` lookups with q-filtering,
 * recording paths — the harness's fixture map keys on the bare path and cannot
 * see `q=`, but "the term reached the server" is the assertion PR-09 exists to
 * make. Everything else (the /360 bundle) is delegated to the fixture map, and
 * writes go to `onWrite` when one is supplied.
 */
function serveEntitySearch(
  extraRows: Array<Record<string, unknown>> = [],
  onWrite?: (
    path: string,
    init?: { method?: string; body?: Record<string, unknown> },
  ) => unknown,
) {
  const paths: string[] = [];
  const readThrough = apiClient.tenant;
  const spy = vi.spyOn(apiClient, "tenant").mockImplementation((async (
    path: string,
    init?: { method?: string; body?: Record<string, unknown> },
  ) => {
    const url = new URL(path, "https://tenant.test");
    const byId = /^\/entities\/[^/]+$/.test(url.pathname);
    const isSearch = url.pathname === "/entities";
    if (init?.method && init.method !== "GET" && onWrite)
      return onWrite(path, init);
    if (!byId && !isSearch) return readThrough(path, init as never);
    paths.push(path);
    if (byId) {
      const id = url.pathname.split("/")[2];
      return (
        ([...extraRows, ALPHA, GONE] as { entity_id: string }[]).find(
          (e) => e.entity_id === id,
        ) ?? {}
      );
    }
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return [...extraRows, ALPHA, GONE].filter(
      (e) =>
        !q ||
        String(e.legal_name).toLowerCase().includes(q) ||
        String(e.code).toLowerCase().includes(q),
    );
  }) as typeof apiClient.tenant);
  return { paths, restore: () => spy.mockRestore() };
}

/** Serve the paged list the corporate-entities page reads. */
function serveEntityPages() {
  const paths: string[] = [];
  const spy = vi.spyOn(apiClient, "tenantPaged").mockImplementation((async (
    path: string,
  ) => {
    paths.push(path);
    const url = new URL(path, "https://tenant.test");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const matched = MANY_ENTITIES.filter(
      (e) =>
        !q ||
        e.legal_name.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q),
    );
    return {
      data: matched,
      total: matched.length,
      limit: Number(url.searchParams.get("limit") ?? 0),
      offset: Number(url.searchParams.get("offset") ?? 0),
      hasMore: false,
      meta: null,
    };
  }) as typeof apiClient.tenantPaged);
  return { paths, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
});


describe("PR-09 · the group-structure parent picker", () => {
  it("searches the server, excludes the entity itself and its descendants, and writes the chosen parent", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    const server = serveEntitySearch([], (_path, init) => {
      bodies.push(init?.body ?? {});
      return {};
    });

    renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
      routes: {
        "/entities/e1/360": {
          ...ENTITY_360,
          structure: {
            ...ENTITY_360.structure,
            children: [
              {
                entity_id: "e-child",
                code: "CHILD",
                legal_name: "Child SARL",
                country_code: "CM",
                relationship_type: "SUBSIDIARY",
                ownership_percent: 100,
                consolidates: true,
                registration_status: "ACTIVE",
                is_active: true,
                accounting_framework: "OHADA",
              },
            ],
          },
        },
      },
    });

    await user.click(await screen.findByRole("button", { name: /^structure$/i }));
    await user.click(
      await screen.findByRole("button", { name: /edit structure/i }),
    );

    const parent = await screen.findByRole("combobox", {
      name: /parent entity/i,
    });
    await user.click(parent);
    await screen.findByRole("option", { name: /Alpha Logistics SARL/ });
    // The entity itself and its descendant are excluded from the choices even
    // though the search served them.
    expect(
      screen.queryByRole("option", { name: /SmartBox SARL/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Child SARL/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("option", { name: /Alpha Logistics SARL/ }),
    );
    await user.click(screen.getByRole("button", { name: /save structure/i }));

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies[0]).toMatchObject({ parent_entity_id: "e-alpha" });
    server.restore();
  });
});

describe("PR-09 · the corporate-entities list is server-side", () => {
  it("pages and searches on the server, so entity 205 is findable and openable", async () => {
    const user = userEvent.setup();
    const pages = serveEntityPages();

    renderScreen(<CorporateEntitiesPage />, {
      // The auto-selected first row opens the inline dossier, which reads the
      // /360 bundle through the fixture map (not the paged spy).
      routes: { "/entities/e1/360": ENTITY_360 },
    });

    // First page: server-side limit/offset, not a 200-row browser filter.
    await waitFor(() =>
      expect(pages.paths).toContain("/entities?limit=50&offset=0"),
    );
    expect(
      pages.paths.some((p) => p.includes("limit=200")),
    ).toBe(false);
    expect(await screen.findByText(/Omega Freight 205 SAS/)).toBeTruthy();

    // The pager reports the TRUE total out of the X-Total-Count contract.
    expect(screen.getByText(/Showing 1–50 of 205/)).toBeTruthy();

    // Paging forward asks the server for the second page.
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(pages.paths).toContain("/entities?limit=50&offset=50"),
    );

    // Searching types into the server's `q` — the match is row 205 of 205,
    // unreachable through any browser-filtered picker.
    await user.type(
      screen.getByPlaceholderText("Search entity…"),
      "Omega Freight 205",
    );
    await waitFor(() => {
      const withQ = pages.paths.filter((p) => p.includes("q="));
      expect(withQ.length).toBeGreaterThan(0);
      const url = new URL(withQ[withQ.length - 1], "https://tenant.test");
      expect(url.searchParams.get("q")).toBe("Omega Freight 205");
    });
    expect(await screen.findByText(/Omega Freight 205 SAS/)).toBeTruthy();

    pages.restore();
  });

  it("opens the new-entity form without fetching the entity list, and the parent picker searches the server", async () => {
    const user = userEvent.setup();
    const pages = serveEntityPages();
    const server = serveEntitySearch([]);

    renderScreen(<CorporateEntitiesPage />, {
      routes: { "/entities/e1/360": ENTITY_360 },
    });
    await screen.findByText(/Omega Freight 205 SAS/);
    expect(pages.paths.length).toBe(1); // the list page, and nothing else

    await user.click(screen.getByRole("button", { name: "New entity" }));
    await screen.findByRole("dialog", { name: "New corporate entity" });

    // No entity list was fetched to render this form — the fetch happens when
    // the parent picker is opened, and it is a bounded ACTIVE-only search.
    expect(pages.paths.length).toBe(1);
    expect(
      server.paths.filter((p) => p.startsWith("/entities?")).length,
    ).toBe(0);

    const parent = screen.getByRole("combobox", { name: "Parent entity" });
    await user.click(parent);
    await screen.findByRole("option", { name: /Alpha Logistics SARL/ });
    expect(
      server.paths.some(
        (p) => p === "/entities?registration_status=ACTIVE&limit=20",
      ),
    ).toBe(true);

    // Choosing a parent reveals the relationship control, wired to the choice.
    await user.click(screen.getByRole("option", { name: /Alpha Logistics SARL/ }));
    expect(
      await screen.findByRole("combobox", { name: /relationship to parent/i }),
    ).toBeTruthy();

    pages.restore();
    server.restore();
  });
});

describe("PR-09 · the client form's entity link", () => {
  it("opens with no tenant-wide entity fetch, and links only ACTIVE entities", async () => {
    const user = userEvent.setup();
    const server = serveEntitySearch([]);

    renderScreen(<ClientsPage />, { routes: { "/clients": [] } });
    await user.click(screen.getByRole("button", { name: /new client/i }));
    await screen.findByRole("dialog", { name: "New client" });

    // THE OLD DEFECT: this form fetched the whole entity list on open, once
    // per modal. Now nothing is fetched until the picker is opened.
    expect(server.paths.filter((p) => p.startsWith("/entities")).length).toBe(0);

    const picker = screen.getByRole("combobox", {
      name: /corporate entity/i,
    });
    await user.click(picker);
    await screen.findByRole("option", { name: /Alpha Logistics SARL/ });
    // The search was ACTIVE-only and bounded.
    expect(
      server.paths.some(
        (p) => p === "/entities?registration_status=ACTIVE&limit=20",
      ),
    ).toBe(true);
    // A deactivated entity in the results is not offered.
    expect(
      screen.queryByRole("option", { name: /Gone Bureau SARL/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Alpha Logistics SARL/ }));
    expect(
      screen.getByRole("combobox", { name: /corporate entity/i }),
    ).toHaveTextContent("ALPHA — Alpha Logistics SARL");

    server.restore();
  });
});
