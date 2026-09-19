/**
 * Corporate entities → KPI tiles that open the rows behind the number.
 *
 * WHY THIS FILE EXISTS. The dossier's tiles used to be inert: "12 employees" was
 * a figure with no way to see the twelve, and the screens that DO drill in (the
 * client and supplier 360s) never covered MOD-01. `screens.axe.test.tsx` renders
 * the dossier but never clicks a tile, so nothing above the primitive level
 * asserted any of this.
 *
 * WHAT IT PINS, in the order the reader meets it:
 *
 *   1. The four tiles that open something are BUTTONS with an accessible name
 *      ("Open Employees"), which is what makes them reachable by keyboard — and
 *      "Ownership recorded" is not one of them (a percentage is not a list).
 *   2. Each drill reads its rows from the module that owns them, with the ENTITY
 *      FILTER on the request: a drill that asked for the tenant's whole roster
 *      would show the right-looking wrong list, which is the failure mode this
 *      test exists for.
 *   3. The Employees drill carries what was asked for: matricule, job title, and
 *      the photo when HR has one (initials otherwise — never a broken image).
 *   4. The Shareholders drill shows EVERY role a person holds, which is the same
 *      union the tile counted (13850), and a person with no page of their own is
 *      rendered as text rather than a link to nowhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

// Imported AFTER the mock so this is the faked namespace — the request tests
// below read the paths the drills actually put on the wire.
import * as apiClient from "@/lib/api-client";

import { EntityDossier } from "./entity-360";

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
  },
  structure: {
    parent_entity_id: null,
    relationship_type: null,
    ownership_percent: null,
    consolidates: false,
    is_group_parent: true,
    ancestors: [],
    children: [
      {
        entity_id: "e2",
        code: "SLAS-TR",
        legal_name: "Smart Logistics Transit SARL",
        country_code: "CM",
        relationship_type: "SUBSIDIARY",
        ownership_percent: 60,
        consolidates: true,
        registration_status: "ACTIVE",
        is_active: true,
        accounting_framework: "SYSCOHADA",
      },
    ],
  },
  people: [],
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
    holder_count: 1,
    total_percent: 100,
    total_shares: 1000,
    issued_capital: 10_000_000,
    balanced: true,
    findings: [],
  },
  usage: {
    journal_entries: 3,
    employees: 2,
    treasury_accounts: 0,
    subsidiaries: 1,
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

const EMPLOYEES = [
  {
    employee_id: "emp1",
    full_name: "Massomba Timothée",
    staff_no: "SLAS-0007",
    job_title: "Directeur Général",
    avatar_ref: "/media/slas/avatars/emp1.jpg",
  },
  {
    employee_id: "emp2",
    full_name: "Ngo Bakang Alice",
    staff_no: "SLAS-0011",
    job_title: "Comptable",
    avatar_ref: null,
  },
];

const JOURNAL = [
  {
    entry_id: "je1",
    entry_no: 41,
    entry_date: "2026-07-04",
    description: "Carburant — camion CE 123 AB",
    source_doc_ref: "FUEL-2026-07-004",
    status: "VALIDATED",
    source: "MANUAL",
  },
];

const routes = (extra: Record<string, unknown> = {}) => ({
  "/entities/e1/360": BASE,
  "/employees": EMPLOYEES,
  "/journal-entries": JOURNAL,
  ...extra,
});

/** Record every path the screen requests, and let the fixture map answer. */
function requestSpy() {
  const paths: string[] = [];
  const readThrough = apiClient.tenant;
  const spy = vi.spyOn(apiClient, "tenant").mockImplementation((async (
    path: string,
    init?: unknown,
  ) => {
    paths.push(path);
    return readThrough(path, init as never);
  }) as typeof apiClient.tenant);
  return { paths, restore: () => spy.mockRestore() };
}

function open(entity360 = BASE, people: unknown[] = []) {
  renderScreen(
    <EntityDossier entityId="e1" onEdit={() => {}} />,
    { routes: routes({ "/entities/e1/360": { ...entity360, people } }) },
  );
}

/** The modal's own title, so an assertion cannot pass on a same-named tile. */
const dialogTitle = (text: RegExp) =>
  screen.findByRole("heading", { name: text });

let spy: ReturnType<typeof requestSpy> | null = null;
beforeEach(() => {
  spy = requestSpy();
});
afterEach(() => {
  spy?.restore();
  spy = null;
});

describe("Corporate entities · KPI drill-ins", () => {
  it("makes the tiles that have rows open them, and leaves the percentage inert", async () => {
    open();
    // The tile renders as a button with an "Open <label>" name (kpi-tile.tsx).
    for (const label of [/^open shareholders$/i, /^open employees$/i, /^open subsidiaries$/i, /^open journal entries$/i]) {
      expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
    }
    // 100% is a figure, not a list — same call the party 360s make for
    // "Credit available".
    expect(
      screen.queryByRole("button", { name: /open ownership recorded/i }),
    ).toBeNull();
  });

  it("lists the entity's employees with matricule, photo and job title", async () => {
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^open employees$/i }));

    expect(await dialogTitle(/employees · smart logistics/i)).toBeInTheDocument();

    // The filter is the whole point of the drill: the roster read has to be
    // scoped to this entity, not the tenant.
    expect(
      spy?.paths.some(
        (p) => p.startsWith("/employees?") && p.includes("entity_id=e1"),
      ),
    ).toBe(true);

    const row = (await screen.findByText("Massomba Timothée")).closest("tr") as HTMLElement;
    expect(within(row).getByText("SLAS-0007")).toBeInTheDocument();
    expect(within(row).getByText("Directeur Général")).toBeInTheDocument();
    // HR has a photo for this person, so the drill shows it…
    const photo = within(row).getByRole("presentation", { hidden: true });
    expect(photo).toBeDefined();
    // …and initials for the one who has none, rather than a broken image.
    const plain = screen.getByText("Ngo Bakang Alice").closest("tr") as HTMLElement;
    expect(within(plain).getByText("NB")).toBeInTheDocument();
  });

  it("does not request a drill's rows until its tile is opened", async () => {
    open();
    await screen.findByRole("button", { name: /^open employees$/i });
    expect(spy?.paths.some((p) => p.startsWith("/employees"))).toBe(false);
    expect(spy?.paths.some((p) => p.startsWith("/journal-entries"))).toBe(false);
  });

  it("reads the ledger for the entity that was clicked", async () => {
    open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open journal entries$/i }),
    );

    expect(await dialogTitle(/journal entries · smart logistics/i)).toBeInTheDocument();
    expect(
      spy?.paths.some(
        (p) => p.startsWith("/journal-entries?") && p.includes("entity_id=e1"),
      ),
    ).toBe(true);

    const row = (await screen.findByText("FUEL-2026-07-004")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Carburant — camion CE 123 AB")).toBeInTheDocument();
    expect(within(row).getByText("Validated")).toBeInTheDocument();
  });

  it("lists subsidiaries from the structure the dossier already holds", async () => {
    open();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open subsidiaries$/i }),
    );

    expect(await dialogTitle(/subsidiaries · smart logistics/i)).toBeInTheDocument();
    const row = (await screen.findByText("Smart Logistics Transit SARL")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("SLAS-TR")).toBeInTheDocument();
    expect(within(row).getByText("60%")).toBeInTheDocument();
    // A subsidiary HAS a dossier of its own, so its code is the row activator.
    expect(within(row).getByRole("button", { name: "SLAS-TR" })).toBeInTheDocument();
  });
});

describe("Corporate entities · the Shareholders drill shows the whole role set", () => {
  const OWNER_DIRECTOR = {
    person_id: "p1",
    role: "SHAREHOLDER",
    role_tags: ["DIRECTOR"],
    holder_type: "PERSON",
    full_name: "Massomba Timothée",
    share_count: 1000,
    ownership_percent: 100,
    is_active: true,
  };
  const HOLDING = {
    person_id: "p2",
    role: "SHAREHOLDER",
    role_tags: [],
    holder_type: "COMPANY",
    full_name: "SLAS Holding SA",
    holder_entity_id: "e9",
    share_count: 0,
    ownership_percent: 0,
    is_active: true,
  };

  it("names every role the person holds, not just the primary one", async () => {
    open(BASE, [OWNER_DIRECTOR, HOLDING]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^open shareholders$/i }));

    expect(await dialogTitle(/shareholders · smart logistics/i)).toBeInTheDocument();
    const row = (await screen.findByText("Massomba Timothée")).closest("tr") as HTMLElement;
    // `role` + `role_tags` (13850) — the same union the tile counted, which is
    // why an owner who is also the director is ONE holder and not two.
    expect(within(row).getByText("Shareholder, Director")).toBeInTheDocument();
    expect(within(row).getByText("1,000")).toBeInTheDocument();
    expect(within(row).getByText("100%")).toBeInTheDocument();
    // A natural person has no screen of their own: text, not a link to nowhere.
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("links a corporate holder to its own dossier", async () => {
    open(BASE, [HOLDING]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^open shareholders$/i }));

    const row = (await screen.findByText("SLAS Holding SA")).closest("tr") as HTMLElement;
    expect(
      within(row).getByRole("button", { name: "SLAS Holding SA" }),
    ).toBeInTheDocument();
  });

  it("explains the empty cap table instead of showing a blank table", async () => {
    open(BASE, []);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^open shareholders$/i }));

    expect(
      await screen.findByText(/no shareholders recorded yet/i),
    ).toBeInTheDocument();
  });
});
