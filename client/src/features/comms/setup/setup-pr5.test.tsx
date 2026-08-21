/**
 * THE PR-5 ADMIN SURFACES — the promises each screen makes on the server's
 * behalf.
 *
 * Twenty-three endpoints shipped with a complete server side and no screen at
 * all, reachable only from a terminal. Building the screens is most of the fix;
 * these tests are for the handful of places where the SCREEN has to carry a
 * rule the API cannot enforce on its own.
 *
 *   · A secure-link token is shown once and never again. If the interface does
 *     not say so at the moment it is shown, the operator loses it and there is
 *     no error to explain why — just a function that cannot exist.
 *   · An OBSERVED domain is not a verified one. The whole anti-spoof control
 *     rests on that distinction, and a list that renders them alike destroys it.
 *   · A broken hash chain is usually concurrency, not tampering — but the
 *     consequence for evidence is identical, and a compliance officer needs
 *     that in a sentence rather than inferred from a colour.
 *   · A follow-up that vanishes on its own is the system working.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import { SecureLinksTab } from "./secure-links";
import { TrustTab } from "./trust";
import { FollowupsTab } from "./followups";
import { SlaTab } from "./sla";

/**
 * `findAllByText` / `getAllByText`, deliberately.
 *
 * `DataList` renders every row TWICE — a table for wide screens and a card list
 * for narrow ones, with the other hidden by CSS. jsdom applies no stylesheet, so
 * both are in the document and every singular query throws "found multiple
 * elements". Scoping to one of them would tie these tests to which half the
 * component happens to render first; asserting the text is present at all is
 * what they actually mean.
 */
const findText = (t: string | RegExp) => screen.findAllByText(t).then((els) => els[0]);
const hasText = (t: string | RegExp) => screen.getAllByText(t).length > 0;

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

beforeEach(() => vi.clearAllMocks());

const soon = new Date(Date.now() + 6 * 86400_000).toISOString();

/* ── Secure links ─────────────────────────────────────────────────────────── */

describe("secure links", () => {
  const link = {
    secure_link_id: "s-1",
    label: "Invoice INV-2026-0311",
    target_kind: "VAULT_DOC" as const,
    expires_at: soon,
    view_count: 3,
  };

  it("shows a link's life and never its address", async () => {
    renderScreen(<SecureLinksTab />, { routes: { "/mail/secure-links": [link] } });
    expect(await findText("Invoice INV-2026-0311")).toBeInTheDocument();
    expect(hasText("Live")).toBe(true);
    expect(hasText("3 times")).toBe(true);
    // There is no token on the row, because there is no token in the database.
    expect(screen.queryByText(/\/s\//)).not.toBeInTheDocument();
  });

  it("a revoked link cannot be revoked twice", async () => {
    renderScreen(<SecureLinksTab />, {
      routes: { "/mail/secure-links": [{ ...link, revoked_at: new Date().toISOString() }] },
    });
    expect(await findText("Revoked")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Revoke" })).toHaveLength(0);
  });

  it("an expired link reads as expired, not as live", async () => {
    renderScreen(<SecureLinksTab />, {
      routes: { "/mail/secure-links": [{ ...link, expires_at: "2020-01-01T00:00:00Z" }] },
    });
    expect(await findText("Expired")).toBeInTheDocument();
  });

  it("the empty state points at where links usually come from", async () => {
    renderScreen(<SecureLinksTab />, { routes: { "/mail/secure-links": [] } });
    expect(await screen.findByText(/composer offers one when your attachments get large/)).toBeInTheDocument();
  });
});

/* ── Trust ────────────────────────────────────────────────────────────────── */

describe("trust and archive", () => {
  const base = {
    "/mail/verified-domains": [],
    "/mail/bounces": [],
  };

  it("SAYS SO when nothing is confirmed, because the send block then stops nothing", async () => {
    renderScreen(<TrustTab />, { routes: base });
    expect(await screen.findByText(/Nothing is confirmed yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/will not stop an invoice going to a lookalike address/),
    ).toBeInTheDocument();
  });

  it("an OBSERVED domain is rendered as seen, not as confirmed", async () => {
    renderScreen(<TrustTab />, {
      routes: {
        ...base,
        "/mail/verified-domains": [
          { party_verified_domain_id: "d-1", party_kind: "CLIENT", party_id: "c-1", party_name: "Camrail", domain: "camrail.cm", source: "OBSERVED", message_count: 12 },
        ],
      },
    });
    // An impostor who emails you twice is observed twice. The list must never
    // let that read as trust.
    expect(await findText("Seen 12×")).toBeInTheDocument();
    expect(screen.queryAllByText("Confirmed")).toHaveLength(0);
    // And it offers no "withdraw", because there is nothing to withdraw.
    expect(screen.queryAllByRole("button", { name: "Withdraw" })).toHaveLength(0);
  });

  it("a confirmed domain can be withdrawn", async () => {
    renderScreen(<TrustTab />, {
      routes: {
        ...base,
        "/mail/verified-domains": [
          { party_verified_domain_id: "d-2", party_kind: "CLIENT", party_id: "c-1", domain: "camrail.cm", source: "ADMIN_VERIFIED" },
        ],
      },
    });
    expect(await findText("Confirmed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Withdraw" }).length).toBeGreaterThan(0);
  });

  it("confirming warns that this is the list the block trusts", async () => {
    renderScreen(<TrustTab />, { routes: base });
    await userEvent.click(await screen.findByRole("button", { name: "Confirm a domain" }));
    expect(screen.getByText(/Only confirm what you have checked/)).toBeInTheDocument();
    expect(screen.getByText(/A lookalike confirmed here\s+stops being flagged/)).toBeInTheDocument();
  });

  it("a broken archive chain is explained, not just coloured", async () => {
    renderScreen(<TrustTab />, {
      routes: { ...base, "/mail/archive/verify": { ok: false, checked: 812, broken_at: "email_message:m-9" } },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Verify the archive" }));
    expect(await screen.findByText(/The chain breaks/)).toBeInTheDocument();
    // Both halves: not necessarily malicious, and not usable as evidence.
    expect(screen.getByText(/most often two messages archived at the same moment/)).toBeInTheDocument();
    expect(screen.getByText(/cannot\s+be relied on as evidence/)).toBeInTheDocument();
  });

  it("an intact chain says how much it checked", async () => {
    renderScreen(<TrustTab />, {
      routes: { ...base, "/mail/archive/verify": { ok: true, checked: 812 } },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Verify the archive" }));
    expect(await screen.findByText(/812 messages checked/)).toBeInTheDocument();
  });
});

/* ── Follow-ups ───────────────────────────────────────────────────────────── */

describe("follow-ups", () => {
  const f = (over = {}) => ({
    email_followup_id: "f-1",
    email_thread_id: "t-1",
    due_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
    trigger: "NO_REPLY",
    status: "PENDING",
    note: "Chase the BL",
    ...over,
  });

  it("says a follow-up cancelling itself is the system working", async () => {
    renderScreen(<FollowupsTab />, { routes: { "/mail/followups": [f()] } });
    expect(
      await screen.findByText(/cancels itself when the other side replies/),
    ).toBeInTheDocument();
  });

  it("an overdue follow-up is called overdue", async () => {
    renderScreen(<FollowupsTab />, {
      routes: { "/mail/followups": [f({ due_at: "2020-01-01T00:00:00Z" })] },
    });
    expect(await findText("Overdue")).toBeInTheDocument();
  });

  it("the condition is rendered as a sentence, not as an enum", async () => {
    renderScreen(<FollowupsTab />, { routes: { "/mail/followups": [f()] } });
    expect(await findText("if they have not replied")).toBeInTheDocument();
    expect(screen.queryAllByText("NO_REPLY")).toHaveLength(0);
  });

  it("cancelling is distinguished from deleting the conversation", async () => {
    renderScreen(<FollowupsTab />, { routes: { "/mail/followups": [f()] } });
    expect(
      await screen.findByText(/the conversation itself stays where it is/),
    ).toBeInTheDocument();
  });
});

/* ── SLA ──────────────────────────────────────────────────────────────────── */

describe("response times", () => {
  const cal = { "/mail/business-hours": { business_hours: {}, holidays: [] } };

  it("no policy is a valid answer, not a nag", async () => {
    renderScreen(<SlaTab />, { routes: { "/mail/sla-policies": [], ...cal } });
    expect(
      await screen.findByText(/that is a fine way to run a mailbox/),
    ).toBeInTheDocument();
  });

  it("minutes are rendered the way a person says them", async () => {
    renderScreen(<SlaTab />, {
      routes: {
        "/mail/sla-policies": [
          { mail_sla_policy_id: "p-1", name: "Client enquiries", first_response_minutes: 240, resolution_minutes: 1440, is_active: true },
        ],
        ...cal,
      },
    });
    expect(await findText("4 hours")).toBeInTheDocument();
    expect(hasText("24 hours")).toBe(true);
  });

  it("editing warns that open conversations are re-based", async () => {
    renderScreen(<SlaTab />, { routes: { "/mail/sla-policies": [], ...cal } });
    await userEvent.click(await screen.findByRole("button", { name: "New target" }));
    // `afterPolicyChange` clears the computed due dates. Correct, and
    // surprising — so it is said rather than discovered from a breach alert.
    expect(screen.getByText(/applies to conversations already open/i)).toBeInTheDocument();
  });

  it("the calendar sits next to the policy, because it is half of it", async () => {
    renderScreen(<SlaTab />, { routes: { "/mail/sla-policies": [], ...cal } });
    // The calendar is a second, independent fetch — awaited on one of ITS OWN
    // elements rather than on the page header, which renders before either
    // request has answered.
    expect(await screen.findByLabelText("Monday opens")).toBeInTheDocument();
    expect(hasText("Working hours")).toBe(true);
    expect(hasText("Public holidays")).toBe(true);
  });

  it("no holidays is stated as a consequence, not left blank", async () => {
    renderScreen(<SlaTab />, { routes: { "/mail/sla-policies": [], ...cal } });
    expect(
      await screen.findByText(/count public holidays as\s+working days/),
    ).toBeInTheDocument();
  });
});
