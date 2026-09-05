/**
 * "How is this mailbox hosted?" — asked before the password form, everywhere.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Every connect surface but one offered a single route in: IMAP host, SMTP
 * host, username, password. For a company whose custom domain sits on Microsoft
 * 365 there IS no password that works — Exchange Online removed Basic auth from
 * IMAP/POP in 2022 and from SMTP AUTH in April 2026 — so "Connect my mailbox",
 * every catalogue slot (Operations, Customer Support, …) and "New shared
 * mailbox" all led to a form that could only end in an authentication failure.
 * Microsoft consent existed on the Connections tab alone, which is not where
 * anybody is sent to set up a team address.
 *
 * These pin the chooser in front of all three doors, that both answers are
 * reachable from each, and that the Microsoft answer is drawn honestly —
 * available when it will work, and naming WHICH prerequisite is missing when it
 * will not, rather than offering a button that answers 403.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import * as apiClient from "@/lib/api-client";
import { MailboxesTab } from "./mailboxes";
import { MyMailboxTab } from "./my-mailbox";
import { CommsSetupPage } from "./index";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

const methods = (microsoft: Record<string, unknown>) => ({
  imap_smtp: { available: true, enabled: true, configured: true, reason: null },
  microsoft_graph: microsoft,
  google_gmail: { available: false, enabled: false, configured: false, reason: "NOT_ENABLED" },
});
const MS_READY = { available: true, enabled: true, configured: true, reason: null };

const CATALOGUE = [
  {
    catalogue_key: "OPERATIONS",
    label_en: "Operations",
    suggested_local_part: "operations",
    department: "Ops",
    configured: false,
    is_enabled: true,
    feeds: [],
  },
];

const adminRoutes = (ms: Record<string, unknown> = MS_READY) => ({
  routes: {
    "/mail/mailboxes": [],
    "/mail/catalogue": CATALOGUE,
    "/mail/connect-methods": methods(ms),
  },
});

/* `window.location.href = …` is the consent hand-off. jsdom refuses to navigate,
 * so the assignment is captured instead — what matters is the URL the server
 * handed back being followed, not the browser actually leaving. */
let href: string | null;
const realLocation = window.location;
beforeEach(() => {
  vi.clearAllMocks();
  href = null;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, search: "", pathname: "/comms/setup", set href(v: string) { href = v; }, get href() { return href ?? ""; } },
  });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

const CHOOSER_MS = /Sign in with Microsoft/i;
const CHOOSER_SMTP = /Use a custom domain \(SMTP\)/i;

/* ── The three doors ──────────────────────────────────────────────────────── */

describe("the chooser stands in front of every connect surface", () => {
  it("a catalogue slot asks how before it asks for a password", async () => {
    const user = userEvent.setup();
    renderScreen(<MailboxesTab canCreate />, adminRoutes());

    await user.click(await screen.findByText("Operations"));

    // The question, not the form: no password field yet.
    expect(await screen.findByRole("button", { name: CHOOSER_MS })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHOOSER_SMTP })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
  });

  it("and the SMTP answer opens the form it used to open directly", async () => {
    const user = userEvent.setup();
    renderScreen(<MailboxesTab canCreate />, adminRoutes());

    await user.click(await screen.findByText("Operations"));
    await user.click(await screen.findByRole("button", { name: CHOOSER_SMTP }));

    expect(await screen.findByLabelText(/IMAP host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });

  it("New shared mailbox asks the same question", async () => {
    const user = userEvent.setup();
    renderScreen(<MailboxesTab canCreate />, adminRoutes());

    await user.click(await screen.findByRole("button", { name: /new shared mailbox/i }));

    expect(await screen.findByRole("button", { name: CHOOSER_MS })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHOOSER_SMTP })).toBeInTheDocument();
  });

  it("so does a person connecting their own mailbox", async () => {
    const user = userEvent.setup();
    renderScreen(<MyMailboxTab />, {
      routes: { "/mail/mailboxes/mine": [], "/mail/connect-methods": methods(MS_READY) },
    });

    await user.click(await screen.findByRole("button", { name: /Connect my mailbox/i }));

    expect(await screen.findByRole("button", { name: CHOOSER_MS })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHOOSER_SMTP })).toBeInTheDocument();
  });
});

/* ── The Microsoft answer ─────────────────────────────────────────────────── */

describe("choosing Microsoft", () => {
  /* A team address is a different RIGHT on the server (MOD-72 create, not
   * edit), so it is a different endpoint — and the slot has to travel with it,
   * because the callback is a bare redirect that can ask nobody anything. */
  it("sends a catalogue slot to the shared endpoint, carrying the slot", async () => {
    const user = userEvent.setup();
    const tenant = vi.spyOn(apiClient, "tenant");
    renderScreen(<MailboxesTab canCreate />, {
      routes: {
        ...adminRoutes().routes,
        "/mail/oauth/microsoft/start/shared": { url: "https://login.microsoftonline.com/consent" },
      },
    });

    await user.click(await screen.findByText("Operations"));
    await user.click(await screen.findByRole("button", { name: CHOOSER_MS }));

    const start = tenant.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/mail/oauth/microsoft/start/shared"));
    expect(start).toBeTruthy();
    // The slot cannot be asked for after the redirect: the callback is a bare
    // browser GET with no session and no body.
    expect(start).toContain("catalogue_key=OPERATIONS");
    expect(start).toContain("department=Ops");
    expect(href).toBe("https://login.microsoftonline.com/consent");
  });

  it("sends a personal connect to the personal endpoint", async () => {
    const user = userEvent.setup();
    const tenant = vi.spyOn(apiClient, "tenant");
    renderScreen(<MyMailboxTab />, {
      routes: {
        "/mail/mailboxes/mine": [],
        "/mail/connect-methods": methods(MS_READY),
        "/mail/oauth/microsoft/start": { url: "https://login.microsoftonline.com/personal" },
      },
    });

    await user.click(await screen.findByRole("button", { name: /Connect my mailbox/i }));
    await user.click(await screen.findByRole("button", { name: CHOOSER_MS }));

    const called = tenant.mock.calls.map((c) => String(c[0]));
    expect(called.some((u) => u.includes("/mail/oauth/microsoft/start")
      && !u.includes("/shared"))).toBe(true);
    expect(href).toBe("https://login.microsoftonline.com/personal");
  });
});

/* ── Drawn honestly ───────────────────────────────────────────────────────── */

describe("when Microsoft cannot be used", () => {
  /* Two prerequisites, fixed by different people in different places: an
   * administrator flips the tenant flag, whoever runs the server registers the
   * Entra app. One undifferentiated "unavailable" sends an administrator
   * hunting for a switch that is already on. */
  it("names the tenant flag when that is what is off", async () => {
    const user = userEvent.setup();
    renderScreen(<MailboxesTab canCreate />, adminRoutes({
      available: false, enabled: false, configured: true, reason: "NOT_ENABLED",
    }));

    await user.click(await screen.findByRole("button", { name: /new shared mailbox/i }));

    expect(await screen.findByText(/not switched on for this company/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHOOSER_MS })).toBeDisabled();
  });

  it("names the missing app registration when that is what is missing", async () => {
    const user = userEvent.setup();
    renderScreen(<MailboxesTab canCreate />, adminRoutes({
      available: false, enabled: true, configured: false, reason: "NOT_CONFIGURED",
    }));

    await user.click(await screen.findByRole("button", { name: /new shared mailbox/i }));

    expect(await screen.findByText(/Entra app registration/i)).toBeInTheDocument();
  });

  /* The password route is never withheld: it is the one that needs no
   * deploy-wide credential, and whether a given ADDRESS can use it is answered
   * per address by the server, by name. */
  it("still offers the password route", async () => {
    const user = userEvent.setup();
    renderScreen(<MailboxesTab canCreate />, adminRoutes({
      available: false, enabled: false, configured: false, reason: "NOT_ENABLED",
    }));

    await user.click(await screen.findByRole("button", { name: /new shared mailbox/i }));
    const smtp = await screen.findByRole("button", { name: CHOOSER_SMTP });
    expect(smtp).toBeEnabled();
  });
});

/* ── What Microsoft consent actually connects ─────────────────────────────── */

describe("the shared-mailbox copy says what consent connects", () => {
  /* Consent connects THE MAILBOX THAT SIGNS IN. Left unsaid, an administrator
   * signs in as themselves and `operations@` fills with their own mail. */
  it("tells the administrator to sign in as the team address", async () => {
    const user = userEvent.setup();
    renderScreen(<MailboxesTab canCreate />, adminRoutes());

    await user.click(await screen.findByText("Operations"));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Sign in AS the team address/i)).toBeInTheDocument();
    // And that an unlicensed M365 shared mailbox is a different mechanism.
    expect(within(dialog).getByText(/shared mailbox/i)).toBeInTheDocument();
  });
});

/* ── Coming back from consent ─────────────────────────────────────────────── */

/**
 * The round trip used to end nowhere.
 *
 * The callback redirected to `/comms/mail`, which renders the inbox; the only
 * code that reads `?mail_connected=` lived on a Setup tab that page does not
 * mount. So a person consented at Microsoft, came back, and was shown an inbox
 * with a stray query string — no success message, no error message, no sign
 * that anything had happened. It lands on `/comms/setup` now, and `mail_tab` —
 * which the server derives from the signed OAuth state, not from anything the
 * browser sent — says which tab asked.
 */
describe("the outcome of a consent round trip", () => {
  const setupRoutes = {
    routes: {
      "/mail/me": { can_view: true, can_create: true, can_edit: true, can_administer: true, is_ceo: false },
      "/mail/mailboxes": [],
      "/mail/catalogue": CATALOGUE,
      "/mail/mailboxes/mine": [],
      "/mail/connect-methods": methods(MS_READY),
    },
  };

  const landOn = (search: string) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, pathname: "/comms/setup", search, set href(v: string) { href = v; }, get href() { return href ?? ""; } },
    });
  };

  it("says the mailbox connected, and names it", async () => {
    landOn("?mail_connected=microsoft&email=operations%40smartls.cm&mail_tab=mailboxes");
    renderScreen(<CommsSetupPage />, setupRoutes);

    expect(await screen.findByText(/operations@smartls\.cm/i)).toBeInTheDocument();
  });

  /* A team address is set up from Mailboxes; landing an administrator on their
   * own My mailbox screen with a message about `operations@` is the confusion
   * this closes. */
  it("returns to the tab the flow started from", async () => {
    landOn("?mail_connected=microsoft&email=operations%40smartls.cm&mail_tab=mailboxes");
    renderScreen(<CommsSetupPage />, setupRoutes);

    expect(await screen.findByText(/every mailbox in the company/i)).toBeInTheDocument();
  });

  /* A failure has to be said too — otherwise the person sees an unchanged
   * screen and cannot tell whether it worked. */
  it("says so when consent did not connect anything", async () => {
    landOn("?mail_error=PROVIDER_NOT_ENABLED&provider=microsoft&mail_tab=mine");
    renderScreen(<CommsSetupPage />, setupRoutes);

    expect(await screen.findByText(/did not connect the mailbox/i)).toBeInTheDocument();
  });

  it("says nothing at all on an ordinary visit", async () => {
    landOn("");
    renderScreen(<CommsSetupPage />, setupRoutes);

    await screen.findByText(/your own professional address/i);
    expect(screen.queryByText(/did not connect the mailbox/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Connected to/i)).not.toBeInTheDocument();
  });
});
