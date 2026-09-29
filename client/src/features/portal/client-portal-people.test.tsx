/**
 * A client's portal, managed from the Client 360's Portal tab: who at the
 * client can sign in, the invitation each is waiting on, and their onboarding
 * checklist. Every write goes to the client-scoped routes (MOD-29), never to
 * the investor/auditor screen's.
 *
 * Both shells are exercised: the desktop table (jsdom's default — no
 * matchMedia means "desktop") and the phone's cards, with `matchMedia`
 * stubbed to a narrow screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

const calls = vi.hoisted(() => [] as { path: string; method?: string; body?: unknown }[]);
const replies = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      const key = `${opts?.method ?? "GET"} ${path}`;
      if (replies.has(key)) return Promise.resolve(replies.get(key));
      return base.tenant(path);
    },
  };
});

import { ClientOnboarding, ClientPortalPeople } from "./client-portal-people";

const PEOPLE = "/portal/clients/c1/people";
const ama = {
  portal_access_id: "g-ama",
  email: "ama@acme.cm",
  client_id: "c1",
  access_scope: "ALL",
  is_client_admin: true,
  invited_by_email: null,
  created_at: "2026-09-01T09:00:00Z",
  expires_at: null,
  full_name: "Ama Owusu",
  last_login_at: "2026-09-20T09:00:00Z",
  sign_in: "ACTIVE",
  invited_at: null,
  invite_expires_at: null,
};
const kofi = {
  ...ama,
  portal_access_id: "g-kofi",
  email: "kofi@acme.cm",
  full_name: null,
  access_scope: "BILLING",
  is_client_admin: false,
  last_login_at: null,
  sign_in: "INVITE_EXPIRED",
};
const DEFAULTS = { access_scope: "OPERATIONS", first_is_admin: true };

const writes = () => calls.filter((c) => c.method === "POST");

/** A phone: `(min-width: 768px)` does not match, so `useIsCompact()` is true. */
function onAPhone() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  calls.length = 0;
  replies.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("who can sign in — on a desktop, a table like the 360's other tabs", () => {
  it("has a column per fact and the row's actions at its end", async () => {
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama, kofi], defaults: DEFAULTS } } });
    const table = await screen.findByRole("table");
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Person", "What they see", "Sign-in", "Access until", "Actions"]);

    const [, amaRow, kofiRow] = within(table).getAllByRole("row");
    expect(within(amaRow).getByText("Ama Owusu")).toBeInTheDocument();
    expect(within(amaRow).getByText("ama@acme.cm")).toBeInTheDocument();
    expect(within(amaRow).getByText("Admin")).toBeInTheDocument();
    expect(within(amaRow).getByText("Can sign in")).toBeInTheDocument();
    expect(within(amaRow).getByText("No end date")).toBeInTheDocument();
    // Someone already signing in is not offered an invitation.
    expect(within(amaRow).queryByRole("button", { name: /invitation/i })).toBeNull();

    expect(within(kofiRow).getByText("Invitation expired")).toBeInTheDocument();
    expect(within(kofiRow).getByRole("button", { name: "Send invitation" })).toBeInTheDocument();
    expect(within(kofiRow).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(kofiRow).getByRole("button", { name: "Actions for kofi@acme.cm" })).toBeInTheDocument();
  });

  it("sends an expired invitation again straight from the row", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}/g-kofi/invite`, { ...kofi, sign_in: "INVITED", invite: { sent: true, emailed: true } });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama, kofi], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Send invitation" }));
    expect(writes()).toEqual([{ path: `${PEOPLE}/g-kofi/invite`, method: "POST", body: undefined }]);
    expect(await screen.findByText("Invitation sent to kofi@acme.cm.")).toBeInTheDocument();
  });

  it("offers the first invitation when nobody has access", async () => {
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [], defaults: DEFAULTS } } });
    expect(await screen.findByText("Nobody at this client can sign in yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite someone" })).toBeInTheDocument();
  });

  it("says the portal is off rather than showing an error, when the plan does not have it", async () => {
    renderScreen(<ClientPortalPeople clientId="c1" />, {
      routes: { [PEOPLE]: { __error: { status: 403, message: "off", code: "FEATURE_DISABLED" } } },
    });
    expect(await screen.findByText("The client portal is not switched on")).toBeInTheDocument();
  });
});

describe("who can sign in — on a phone, a card per person", () => {
  it("shows the same facts as cards, one action visible and the rest behind ⋯", async () => {
    onAPhone();
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama, kofi], defaults: DEFAULTS } } });
    // Wait for the data: the phone's cards are what renders once it lands.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Ama Owusu")).toBeInTheDocument();
    expect(screen.getByText("Invitation expired")).toBeInTheDocument();
    // The invitation is in kofi's ⋯, not a second visible button on a narrow card.
    expect(screen.queryByRole("button", { name: "Send invitation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Actions for kofi@acme.cm" })).toBeInTheDocument();
  });
});

describe("inviting someone", () => {
  it("starts from the tenant's defaults, fills from a contact in one tap, and sends to the client's own route", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}`, { ...ama, email: "esi@acme.cm", invite: { sent: true, emailed: true } });
    renderScreen(
      <ClientPortalPeople clientId="c1" contacts={[{ name: "Esi Mensah", email: "esi@acme.cm" }, { name: "Ama Owusu", email: "ama@acme.cm" }]} />,
      { routes: { [PEOPLE]: { members: [], defaults: DEFAULTS } } },
    );
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    const dialog = await screen.findByRole("dialog");

    // The tenant's default scope, and admin because this is the client's first person.
    expect(within(dialog).getByRole("radio", { name: "Shipments & documents" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Portal admin/ })).toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Esi Mensah" }));
    expect(within(dialog).getByDisplayValue("esi@acme.cm")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    expect(writes()).toEqual([
      {
        path: PEOPLE,
        method: "POST",
        body: { email: "esi@acme.cm", full_name: "Esi Mensah", access_scope: "OPERATIONS", is_client_admin: true, expires_at: null, send_invite: true },
      },
    ]);
    expect(await screen.findByText("Invitation sent to esi@acme.cm.")).toBeInTheDocument();
  });

  it("does not suggest someone who already has access, nor pre-tick admin after the first person", async () => {
    const user = userEvent.setup();
    renderScreen(<ClientPortalPeople clientId="c1" contacts={[{ name: "Ama Owusu", email: "AMA@acme.cm" }]} />, {
      routes: { [PEOPLE]: { members: [ama], defaults: DEFAULTS } },
    });
    await user.click(await screen.findByRole("button", { name: "+ Invite" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("From this client's contacts")).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: /Portal admin/ })).not.toBeChecked();
  });

  it("says so when access was given but the email did not go", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}`, { ...ama, email: "esi@acme.cm", invite: { sent: true, emailed: false } });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Email/ }), "esi@acme.cm");
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Esi Mensah");
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText(/has access, but the email could not be sent/)).toBeInTheDocument();
  });

  it("will not send without a name — the team has to know who it is", async () => {
    const user = userEvent.setup();
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Email/ }), "esi@acme.cm");
    expect(within(dialog).getByRole("button", { name: "Send invitation" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Esi Mensah");
    expect(within(dialog).getByRole("button", { name: "Send invitation" })).toBeEnabled();
    expect(writes()).toEqual([]);
  });
});

describe("a person with no name", () => {
  it("is flagged on the list, and staff add the name from Edit", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}/g-kofi`, { ...kofi, full_name: "Kofi Boateng" });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [kofi], defaults: DEFAULTS } } });
    expect(await screen.findByText("Name missing")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Kofi Boateng");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(writes()).toEqual([
      {
        path: `${PEOPLE}/g-kofi`,
        method: "POST",
        body: { full_name: "Kofi Boateng", access_scope: "BILLING", is_client_admin: false, expires_at: null },
      },
    ]);
  });
});

describe("editing one person", () => {
  it("changes what they see, and only saves once something changed", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}/g-ama`, { ...ama, access_scope: "BILLING" });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Ama Owusu" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(within(dialog).getByRole("radio", { name: "Billing" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(writes()).toEqual([
      { path: `${PEOPLE}/g-ama`, method: "POST", body: { access_scope: "BILLING", is_client_admin: true, expires_at: null } },
    ]);
  });

  it("removes access only once confirmed", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}/g-ama/revoke`, { revoked: true, email: "ama@acme.cm" });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove access" }));
    // The confirmation opens over the person's dialog: the newest dialog.
    const confirm = (await screen.findAllByRole("dialog")).at(-1)!;
    expect(within(confirm).getByText("Remove Ama Owusu's access?")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Remove access" }));
    expect(writes()).toEqual([{ path: `${PEOPLE}/g-ama/revoke`, method: "POST", body: undefined }]);
    expect(await screen.findByText("Ama Owusu no longer has access.")).toBeInTheDocument();
  });
});

describe("the onboarding checklist", () => {
  const ONB = "/portal/clients/c1/onboarding";
  const steps = [
    { step_key: "KYC_DOCUMENTS", label_en: "KYC documents received", label_fr: "Documents KYC reçus", done: true, done_at: "2026-09-10T09:00:00Z" },
    { step_key: "FIRST_BOOKING", label_en: "First shipment booked", label_fr: "Première expédition réservée", done: false, done_at: null },
  ];

  it("is a dense list of real checkboxes on a desktop, ticked through the client's own route", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${ONB}/FIRST_BOOKING`, { ...steps[1], done: true });
    renderScreen(<ClientOnboarding clientId="c1" />, { routes: { [ONB]: { client_id: "c1", progress: 50, steps } } });
    expect(await screen.findByText("1 of 2 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Onboarding progress" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("checkbox", { name: "KYC documents received" })).toBeChecked();

    const step = screen.getByRole("checkbox", { name: "First shipment booked" });
    expect(step).not.toBeChecked();
    await user.click(step);
    expect(writes()).toEqual([{ path: `${ONB}/FIRST_BOOKING`, method: "POST", body: undefined }]);
  });

  it("is a row per step a thumb can hit on a phone", async () => {
    onAPhone();
    renderScreen(<ClientOnboarding clientId="c1" />, { routes: { [ONB]: { client_id: "c1", progress: 50, steps } } });
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
    const step = await screen.findByRole("button", { name: /First shipment booked/ });
    expect(step).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("says where the steps come from when there are none", async () => {
    renderScreen(<ClientOnboarding clientId="c1" />, { routes: { [ONB]: { client_id: "c1", progress: 0, steps: [] } } });
    expect(await screen.findByText("No onboarding steps")).toBeInTheDocument();
  });
});
