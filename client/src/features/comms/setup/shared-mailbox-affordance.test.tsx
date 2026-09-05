/**
 * "Ask an administrator" — read by the administrator.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * Comms → Setup → Connections is the only button in the product that says
 * "Connect a mailbox", so it is where somebody setting up `invoicing@` goes.
 * It creates a PERSONAL mailbox, of which everyone gets exactly one, so the
 * server refuses with PERSONAL_MAILBOX_EXISTS — a message ending "ask an
 * administrator to set up a shared mailbox", which lands in front of a CEO who
 * IS the administrator. The team address they wanted is a different object, on
 * a tab the refusal never named. The whole flow dead-ended in a red box.
 *
 * ── AND THE RIGHT THAT ACTUALLY GATES IT ────────────────────────────────────
 *
 * The Mailboxes tab is offered on `can_administer`, which the server answers
 * with MOD-72 `can_update`. Creating a shared mailbox is `can_create`. Those
 * are two rights, and the create affordances were gated on the wrong one — a
 * role with edit-but-not-create got a button that could only 403. The seeded
 * roles do not currently produce that combination; the permission matrix is
 * data a tenant edits, which is precisely why the button must follow the right
 * that gates the call rather than the one that gates the tab.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, apiError } from "@/test/screen-harness";
import { MailboxesTab, ConnectionsTab } from "./mailboxes";
import { CommsSetupPage } from "./index";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

beforeEach(() => vi.clearAllMocks());

const CREATE = /new shared mailbox/i;

/* ── The create affordance follows `create`, not `edit` ──────────────────── */

describe("who is offered the shared-mailbox form", () => {
  const inventory = {
    routes: {
      "/mail/mailboxes": [],
      "/mail/catalogue": [
        {
          catalogue_key: "BILLING",
          label_en: "Billing",
          suggested_local_part: "billing",
          configured: false,
          is_enabled: true,
          feeds: [],
        },
      ],
    },
  };

  it("offers it to somebody who holds create", async () => {
    renderScreen(<MailboxesTab canCreate />, inventory);
    expect((await screen.findAllByText(CREATE)).length).toBeGreaterThan(0);
    // The slot shortcuts are the same offer by another route; asserting they
    // ARE here is what gives the withholding test below its meaning.
    await screen.findByText(/team addresses not set up yet/i);
  });

  /* The button is the whole finding: it used to render for anyone who could
   * open the tab, and POST /mail/mailboxes/shared would then 403. */
  it("withholds it from somebody who may edit but not create", async () => {
    renderScreen(<MailboxesTab canCreate={false} />, inventory);
    // Wait for the inventory to settle so this is not merely an early render.
    await screen.findByText(/every mailbox in the company/i);
    expect(screen.queryByText(CREATE)).not.toBeInTheDocument();
  });

  /* The unfilled catalogue slots open the same modal and call the same
   * endpoint, so they are the same right — a second door to the same 403. */
  it("withholds the catalogue slots too", async () => {
    renderScreen(<MailboxesTab canCreate={false} />, inventory);
    await screen.findByText(/every mailbox in the company/i);
    expect(screen.queryByText(/team addresses not set up yet/i)).not.toBeInTheDocument();
  });

  /* End to end through the hub: `can_administer` opens the tab, `can_create`
   * decides the button. An administrator without create sees the inventory and
   * is not offered a control that cannot work. */
  it("the hub gates the tab and the button on different rights", async () => {
    renderScreen(<CommsSetupPage />, {
      routes: {
        "/mail/me": { can_view: true, can_create: false, can_edit: true, can_administer: true, is_ceo: false },
        "/mail/mailboxes": [],
        "/mail/catalogue": [],
        "/mail/mailboxes/mine": [],
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Mailboxes" }));
    await screen.findByText(/every mailbox in the company/i);
    expect(screen.queryByText(CREATE)).not.toBeInTheDocument();
  });
});

/* ── The dead end ────────────────────────────────────────────────────────── */

describe("refusing a second personal mailbox", () => {
  const refuseSecondPersonal = {
    routes: {
      "/mail/connections": apiError(
        409,
        "You already have a personal mailbox (support@jbspraxis.com). Each person has one.",
        "PERSONAL_MAILBOX_EXISTS",
      ),
    },
  };

  async function fillAndSubmit() {
    await userEvent.click(await screen.findByRole("button", { name: /connect a mailbox/i }));
    await userEvent.type(await screen.findByLabelText(/email address/i), "invoicing@praxisls.com");
    await userEvent.type(screen.getByLabelText(/imap host/i), "mail.praxisls.com");
    await userEvent.type(screen.getByLabelText(/smtp host/i), "mail.praxisls.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /connect & test/i }));
  }

  it("offers the crossing to somebody who may create a shared mailbox", async () => {
    const onCreateShared = vi.fn();
    renderScreen(<ConnectionsTab onCreateShared={onCreateShared} />, refuseSecondPersonal);

    await fillAndSubmit();

    await screen.findByText(/setting up a team address/i);
    await userEvent.click(screen.getByRole("button", { name: /set up a shared mailbox/i }));

    // What was typed crosses over, so the form is not filled in twice.
    expect(onCreateShared).toHaveBeenCalledWith(
      expect.objectContaining({
        email_address: "invoicing@praxisls.com",
        imap_host: "mail.praxisls.com",
        smtp_host: "mail.praxisls.com",
      }),
    );
    // The password does NOT: it would outlive the form that collected it.
    expect(onCreateShared.mock.calls[0][0]).not.toHaveProperty("password");
  });

  /* Pointing somebody at a screen that will refuse them is worse than the dead
   * end it replaces, so without the right there is no offer. */
  it("does not offer it to somebody who may not create one", async () => {
    renderScreen(<ConnectionsTab />, refuseSecondPersonal);

    await fillAndSubmit();

    await screen.findAllByText(/you already have a personal mailbox/i);
    expect(screen.queryByText(/setting up a team address/i)).not.toBeInTheDocument();
  });

  /* Every other failure keeps the plain error. A bad password is not a reason
   * to suggest a different kind of mailbox. */
  it("stays out of the way of an ordinary connection failure", async () => {
    renderScreen(<ConnectionsTab onCreateShared={vi.fn()} />, {
      routes: {
        "/mail/connections": apiError(422, "Authentication failed", "SMTP_AUTH_FAILED"),
      },
    });

    await fillAndSubmit();

    await screen.findAllByText(/authentication failed/i);
    expect(screen.queryByText(/setting up a team address/i)).not.toBeInTheDocument();
  });
});
