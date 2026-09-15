/**
 * "Sending (SMTP) sign-in" on the mailbox forms.
 *
 * ── WHAT THE SCREEN HAS TO CARRY THAT THE API CANNOT ────────────────────────
 *
 * The server can refuse a half-typed separate sign-in, and does. What it cannot
 * do is any of the things that decide whether the operator ever reaches that
 * point:
 *
 *   · The choice has to be VISIBLE. The whole failure this feature ends is
 *     somebody being told their SMTP credentials were rejected while having no
 *     field to put SMTP credentials in. A control hidden behind a disclosure is
 *     only found by somebody who already knows it exists, which is exactly not
 *     that person.
 *   · The form has to REOPEN in the mode the mailbox is actually in. The SMTP
 *     password is never sent to the browser — presence only — so if the screen
 *     guessed the mode from the blank password field, every edit of a
 *     relay-backed mailbox would silently offer to drop its credential.
 *   · A blank password on an EDIT means "keep it". That is the opposite of what
 *     a blank required field usually means, so the form has to say so, and has
 *     to stay submittable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import { ConnectionsTab } from "./mailboxes";
import { MyMailboxTab } from "./my-mailbox";
import {
  smtpSignInFrom,
  smtpSignInBody,
  smtpSignInReady,
  BLANK_SMTP_SIGN_IN,
} from "@/lib/smtp-sign-in";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

beforeEach(() => vi.clearAllMocks());

/**
 * `getAllByText(...)[0]`, deliberately — the same reason setup-pr5 uses it.
 * `DataList` renders every row twice (a table for wide screens, cards for
 * narrow) and jsdom applies no stylesheet, so both halves are in the document.
 */
const firstByText = (t: string | RegExp) => screen.getAllByText(t)[0];

const CONN = {
  email_connection_id: "c-1",
  email_address: "ops@jbspraxis.com",
  provider: "imap_smtp" as const,
  status: "CONNECTED" as const,
  imap_host: "mail.jbspraxis.com",
  imap_port: 993,
  smtp_host: "mail.smtp2go.com",
  smtp_port: 465,
  auth_user: "ops@jbspraxis.com",
};

/** Open the admin edit drawer for one connection. */
async function openEditor(conn: Record<string, unknown>) {
  const user = userEvent.setup();
  renderScreen(<ConnectionsTab />, { routes: { "/mail/connections": [conn] } });
  await screen.findAllByText("ops@jbspraxis.com");
  await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  return user;
}

describe("the choice is on the admin mailbox form", () => {
  it("offers both modes, and defaults to the one almost every mailbox is in", async () => {
    await openEditor(CONN);
    expect(await screen.findByText("Sending (SMTP) sign-in")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Same as IMAP/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Use different credentials/ })).not.toBeChecked();
  });

  it("keeps the credential fields out of the way until they are chosen", async () => {
    // The default path costs one glance and nothing else — two extra inputs on
    // every mailbox form would be two more things to get wrong for the ~all of
    // them that share one login.
    await openEditor(CONN);
    await screen.findByText("Sending (SMTP) sign-in");
    expect(screen.queryByText("SMTP username")).not.toBeInTheDocument();
    expect(screen.queryByText("SMTP password")).not.toBeInTheDocument();
  });

  it("reveals the username and password when different credentials are chosen", async () => {
    const user = await openEditor(CONN);
    await screen.findByText("Sending (SMTP) sign-in");
    await user.click(screen.getByRole("radio", { name: /Use different credentials/ }));
    expect(await screen.findByText("SMTP username")).toBeInTheDocument();
    expect(screen.getByText("SMTP password")).toBeInTheDocument();
  });

  it("SMTP host and port stay editable in BOTH modes", async () => {
    // A tenant can legitimately point sending at another host while sharing one
    // password. Moving those fields under the radio would make that unreachable.
    const user = await openEditor(CONN);
    await screen.findByText("Sending (SMTP) sign-in");
    expect(firstByText("SMTP host")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Use different credentials/ }));
    expect(firstByText("SMTP host")).toBeInTheDocument();
    expect(firstByText("SMTP port")).toBeInTheDocument();
  });

  it("will not submit a separate sign-in that is missing half of itself", async () => {
    const user = await openEditor(CONN);
    await screen.findByText("Sending (SMTP) sign-in");
    await user.click(screen.getByRole("radio", { name: /Use different credentials/ }));
    expect(screen.getByRole("button", { name: /Save & test/ })).toBeDisabled();
  });
});

describe("reopening a mailbox that already sends through a relay", () => {
  const RELAY_CONN = { ...CONN, smtp_auth: "separate", has_smtp_credentials: true, smtp_user: "smtp2go-user" };

  it("comes back in separate mode with the username filled in", async () => {
    await openEditor(RELAY_CONN);
    expect(await screen.findByText("Sending (SMTP) sign-in")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Use different credentials/ })).toBeChecked();
    expect(screen.getByDisplayValue("smtp2go-user")).toBeInTheDocument();
  });

  it("says a blank SMTP password keeps the stored one, and stays submittable", async () => {
    // The password is never sent to the browser, so the field is necessarily
    // blank. Without the hint, "required" on an empty box reads as an error the
    // operator cannot clear.
    await openEditor(RELAY_CONN);
    expect(await screen.findByText("Leave blank to keep the current SMTP password."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save & test/ })).toBeEnabled();
  });

  it("a mailbox with only the presence boolean still reopens in the right mode", async () => {
    // `smtp_auth` and `has_smtp_credentials` are the same server-derived fact.
    // A response carrying just the boolean must not fall back to shared mode —
    // that would offer to delete a working credential.
    await openEditor({ ...CONN, has_smtp_credentials: true, smtp_user: "smtp2go-user" });
    await screen.findByText("Sending (SMTP) sign-in");
    expect(screen.getByRole("radio", { name: /Use different credentials/ })).toBeChecked();
  });

  it("switching back to Same as IMAP hides the fields and is submittable at once", async () => {
    // Nothing left to type: the mode alone tells the server to drop the secret.
    const user = await openEditor(RELAY_CONN);
    await screen.findByText("Sending (SMTP) sign-in");
    await user.click(screen.getByRole("radio", { name: /Same as IMAP/ }));
    expect(screen.queryByText("SMTP username")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save & test/ })).toBeEnabled();
  });
});

describe("the personal connect wizard", () => {
  /**
   * Walk the wizard to step 2, where the server settings live.
   *
   * "Connect my mailbox" now opens the hosting chooser first — Microsoft
   * sign-in or the company's own server — because for a mailbox on Microsoft
   * 365 no password can work and this wizard could only ever fail. The relay
   * sign-in this file is about lives behind the SMTP answer, so the walk picks
   * it explicitly rather than assuming the form opens straight away.
   */
  async function openWizardStepTwo() {
    const user = userEvent.setup();
    renderScreen(<MyMailboxTab />, {
      routes: {
        "/mail/mailboxes/mine": [],
        "/mail/connect-methods": {
          imap_smtp: { available: true, enabled: true, configured: true, reason: null },
          microsoft_graph: { available: true, enabled: true, configured: true, reason: null },
          google_gmail: { available: false, enabled: false, configured: false, reason: "NOT_ENABLED" },
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: /Connect my mailbox/i }));
    await user.click(await screen.findByRole("button", { name: /Use a custom domain \(SMTP\)/i }));
    await user.type(screen.getByPlaceholderText("you@yourcompany.cm"), "ops@jbspraxis.com");
    await user.click(screen.getByRole("button", { name: /I will type the settings/i }));
    return user;
  }

  it("offers the choice on the server-settings step, before the test can refuse them", async () => {
    // A person who needs a relay needs it BEFORE step 3 tells them their
    // password was rejected — which is the failure that started all of this.
    await openWizardStepTwo();
    expect(await screen.findByText("Sending (SMTP) sign-in")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Same as IMAP/ })).toBeChecked();
  });

  it("reveals the relay credentials and blocks the step until both are given", async () => {
    const user = await openWizardStepTwo();
    await screen.findByText("Sending (SMTP) sign-in");
    await user.click(screen.getByRole("radio", { name: /Use different credentials/ }));
    expect(await screen.findByText("SMTP username")).toBeInTheDocument();
    // On a CREATE there is no stored password to keep, so a blank one is a real
    // gap rather than a convention.
    expect(screen.getByRole("button", { name: /Connect and test/ })).toBeDisabled();
  });
});

/**
 * The payload rules, checked directly.
 *
 * These three functions decide what actually reaches the API, and each of them
 * encodes a rule whose failure is silent rather than loud: sending nothing when
 * the mode was meant to clear a secret, sending a blank password that reads as
 * "clear it", or a create that looks complete and is not.
 */
describe("what the form sends", () => {
  it("shared mode sends the mode and nothing else", () => {
    // Sending a blank username alongside it would describe the same clearing
    // twice, and give the server two chances to disagree with itself.
    expect(smtpSignInBody(BLANK_SMTP_SIGN_IN)).toEqual({ smtp_auth: "same" });
  });

  it("separate mode omits an untouched password so the stored one survives", () => {
    expect(smtpSignInBody({ smtp_auth: "separate", smtp_user: "u", smtp_password: "" }))
      .toEqual({ smtp_auth: "separate", smtp_user: "u" });
  });

  it("separate mode sends a password when one was typed", () => {
    expect(smtpSignInBody({ smtp_auth: "separate", smtp_user: "u", smtp_password: "k" }))
      .toEqual({ smtp_auth: "separate", smtp_user: "u", smtp_password: "k" });
  });

  it("readiness follows whether a password is already stored", () => {
    const half = { smtp_auth: "separate" as const, smtp_user: "u", smtp_password: "" };
    expect(smtpSignInReady(half, false)).toBe(false); // create — nothing to keep
    expect(smtpSignInReady(half, true)).toBe(true); // edit — the stored one stands
    expect(smtpSignInReady({ ...half, smtp_user: "" }, true)).toBe(false); // no username, ever
    expect(smtpSignInReady(BLANK_SMTP_SIGN_IN)).toBe(true); // shared mode needs nothing
  });

  it("the mode is read from the server's derivation, never guessed locally", () => {
    expect(smtpSignInFrom({ smtp_auth: "separate", smtp_user: "u" }).smtp_auth).toBe("separate");
    expect(smtpSignInFrom({ has_smtp_credentials: true }).smtp_auth).toBe("separate");
    // A username with no secret behind it is NOT separate mode — the same rule
    // the provider applies, so the form cannot show a mode the server denies.
    expect(smtpSignInFrom({ smtp_user: "u" }).smtp_auth).toBe("same");
    expect(smtpSignInFrom(undefined).smtp_auth).toBe("same");
  });

  it("never carries a password back out of an existing mailbox", () => {
    expect(smtpSignInFrom({ smtp_auth: "separate", smtp_user: "u" }).smtp_password).toBe("");
  });
});
