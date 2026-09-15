import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * Settings › Website › Social — a refusal has to say WHICH link.
 *
 * ── THE INCIDENT THESE PIN (2026-09-11) ───────────────────────────────────
 *
 * Seven URL fields, one Save button, and a banner that read "Not saved — One
 * of the values is in the wrong format". It named no field, so the tenant
 * picked the one that looked most unusual (`https://wa.me/+237…`), retyped it
 * without the `+`, and got the same banner — because no value on the screen
 * was ever at fault. The 400 came from the audit write behind the save
 * (`shared/events/emit.js`, fixed with `tests/unit/audit-jsonb-params.test.js`).
 *
 * The backend defect is fixed in that file. What is pinned HERE is the part of
 * the incident that was this screen's own: a form that rejects seven values
 * collectively and points at none of them individually is unusable even when
 * the rejection is correct — the tenant is left diffing their own URLs against
 * a rule the message did not state.
 *
 * So: every refusal resolves to a field, that field says what is wrong under
 * itself, it TAKES FOCUS, and the banner names it by the display name the label
 * uses ("WhatsApp") and not the `whatsapp` key the API's `fields` bag is keyed
 * by. A refusal that genuinely is not about a field still gets the banner —
 * pinned below, because inventing a field for it would be the same defect
 * pointing the other way.
 */

type Body = Record<string, string>;

/** What the API returns from GET /site-settings/social. */
let existing: { platform: string; url: string }[] = [];
/** What the next PUT throws, if anything. */
let putRejection: unknown = null;
const puts: Body[] = [];

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    tenant: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/site-settings/social" && !opts?.method) return existing;
      if (path === "/site-settings/social" && opts?.method === "PUT") {
        puts.push(opts.body as Body);
        if (putRejection) throw putRejection;
        return Object.entries(opts.body as Body)
          .filter(([, url]) => url)
          .map(([platform, url]) => ({ platform, url }));
      }
      return [];
    }),
  };
});

import { ApiError } from "@/lib/api-client";
import { WebsiteSocialPage } from "./website-social";

beforeEach(() => {
  existing = [];
  putRejection = null;
  puts.length = 0;
});

const mount = () =>
  render(
    <MemoryRouter>
      <WebsiteSocialPage />
    </MemoryRouter>,
  );

const whatsapp = () => screen.getByPlaceholderText("https://wa.me/237XXXXXXXXX");
const linkedin = () =>
  screen.getByPlaceholderText("https://www.linkedin.com/company/your-company");
const save = () => screen.getByRole("button", { name: /Save links/i });

describe("a server refusal that names a field", () => {
  it("puts the message under that field and focuses it", async () => {
    existing = [
      { platform: "linkedin", url: "https://www.linkedin.com/company/smartls-ltd/" },
      { platform: "whatsapp", url: "https://wa.me/237696291800" },
    ];
    putRejection = new ApiError("VALIDATION_ERROR", "That is not a whatsapp link.", 422, {
      whatsapp: ["Must be an https link on that platform's own domain."],
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Save links/i }));

    // The detail lands in the WhatsApp row — the one the server was talking
    // about — rather than in a banner that could be about any of the seven.
    const message = await screen.findByText(
      /Must be an https link on that platform's own domain\./i,
    );
    expect(whatsapp()).toHaveAttribute("aria-invalid", "true");
    expect(whatsapp()).toHaveAttribute("aria-describedby", message.id);
    // And no other row is implicated.
    expect(linkedin()).not.toHaveAttribute("aria-invalid");

    // Focus goes to the field to fix, not left on the Save button. On a phone
    // the offending row is usually scrolled off behind the banner.
    await waitFor(() => expect(whatsapp()).toHaveFocus());
  });

  it("names the platform the way its own label does, not by its API key", async () => {
    existing = [{ platform: "whatsapp", url: "https://wa.me/237696291800" }];
    putRejection = new ApiError("VALIDATION_ERROR", "That is not a whatsapp link.", 422, {
      whatsapp: ["Must be an https link on that platform's own domain."],
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Save links/i }));

    const banner = await screen.findByText(/Check the links? for/i);
    expect(banner).toHaveTextContent("WhatsApp");
    expect(banner).not.toHaveTextContent("whatsapp:");
  });

  it("drops the stale verdict as soon as that field is retyped", async () => {
    existing = [{ platform: "whatsapp", url: "https://wa.me/237696291800" }];
    putRejection = new ApiError("VALIDATION_ERROR", "That is not a whatsapp link.", 422, {
      whatsapp: ["Must be an https link on that platform's own domain."],
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Save links/i }));
    await screen.findByText(/Must be an https link/i);

    // The server judged the OLD value. Leaving the message up while the tenant
    // edits would have them correcting a field the screen still calls bad.
    await userEvent.type(whatsapp(), "0");
    await waitFor(() =>
      expect(screen.queryByText(/Must be an https link/i)).not.toBeInTheDocument(),
    );
  });
});

describe("a refusal the server does not pin to a field", () => {
  it("stays in the banner rather than being blamed on a link", async () => {
    existing = [{ platform: "whatsapp", url: "https://wa.me/237696291800" }];
    putRejection = new ApiError(
      "INVALID_VALUE",
      "One of the values is in the wrong format",
      400,
    );
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Save links/i }));

    expect(
      await screen.findByText(/One of the values is in the wrong format/i),
    ).toBeInTheDocument();
    // Crucially it does not pick a field at random to decorate.
    expect(whatsapp()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Check the links? for/i)).not.toBeInTheDocument();
  });
});

describe("this screen's own verdict", () => {
  it("names the offending field and focuses it instead of sending the request", async () => {
    mount();
    const field = await screen.findByPlaceholderText("https://www.instagram.com/your-account");
    await userEvent.type(field, "https://evil.example/instagram.com");
    await userEvent.click(save());

    // A disabled Save is the one control that cannot explain itself, and
    // "which of these seven?" is the question this screen kept failing to
    // answer. The click is what delivers the answer.
    const banner = await screen.findByText(/Check the links? for/i);
    expect(banner).toHaveTextContent("Instagram");
    await waitFor(() => expect(field).toHaveFocus());
    expect(puts).toHaveLength(0);
  });

  it("lists every offending field, in the order the form reads", async () => {
    mount();
    await userEvent.type(
      await screen.findByPlaceholderText("https://www.instagram.com/your-account"),
      "https://evil.example/a",
    );
    await userEvent.type(whatsapp(), "https://evil.example/b");
    await userEvent.click(save());

    const banner = await screen.findByText(/Check the links? for/i);
    expect(banner).toHaveTextContent("Instagram, WhatsApp");
  });

  it("leaves a blank field alone — blank is how a link is removed", async () => {
    existing = [{ platform: "whatsapp", url: "https://wa.me/237696291800" }];
    mount();
    await userEvent.clear(await screen.findByDisplayValue("https://wa.me/237696291800"));
    await userEvent.click(save());

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].whatsapp).toBe("");
    expect(screen.queryByText(/Check the links? for/i)).not.toBeInTheDocument();
  });

  it("saves a valid set and says so", async () => {
    mount();
    await userEvent.type(await screen.findByPlaceholderText("https://wa.me/237XXXXXXXXX"), "https://wa.me/237696291800");
    await userEvent.click(save());

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(await screen.findByText(/picks this up on the next page load/i)).toBeInTheDocument();
  });
});
