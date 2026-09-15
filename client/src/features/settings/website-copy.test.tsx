import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * Settings › Website › Wording.
 *
 * ── WHAT THESE PIN, AND WHY EACH ONE WOULD HAVE SHIPPED ───────────────────
 *
 *   1. THE DEFAULT IS A PLACEHOLDER, NEVER A VALUE. Pre-filling the shipped
 *      sentence is the obvious implementation and it silently freezes every
 *      tenant's wording at the deploy they first opened this screen on — an
 *      override is stored verbatim, so a tenant who never touched a field would
 *      still be opted out of every later improvement to it. The field must be
 *      empty with the sentence behind it in grey.
 *
 *   2. WHAT IS SAVED IS ONLY WHAT WAS TYPED. Falling back to the default when
 *      building the payload turns "I edited one heading" into 465 overrides,
 *      which is the same defect wearing a different hat and much harder to
 *      undo.
 *
 *   3. FRENCH IS REQUIRED. `bi()` makes FR the half every renderer falls back
 *      to, so English-only is a 422. Discovering that after typing forty rows
 *      is the experience this screen exists to avoid.
 *
 *   4. SAVED IS NOT LIVE. The overlay read is published-only. A tenant who
 *      saves, visits their site and sees no change, with nothing explaining
 *      why, is the trap the draft notice is here to close.
 */

const CATALOGUE = {
  sections: [
    { key: "portfolioPage", label: "Our work (case notes)", pages: ["Our work"] },
    { key: "footer", label: "Footer", pages: ["Home", "Contact"] },
  ],
  entries: [
    {
      key: "site.portfolioPage.titleMain",
      section: "portfolioPage",
      label: "Title main",
      default_en: "Success",
      default_fr: "Nos",
    },
    {
      key: "site.portfolioPage.sub",
      section: "portfolioPage",
      label: "Sub",
      default_en: "Operations we have run, in our own words.",
      default_fr: "Des opérations que nous avons menées, dans nos mots.",
    },
    {
      key: "site.footer.legal",
      section: "footer",
      label: "Legal",
      default_en: "All rights reserved.",
      default_fr: "Tous droits réservés.",
    },
  ],
};

/** Pages the tenant has. Empty by default — the ordinary first visit, where the
 *  copy row does not exist yet and the first save has to create it. */
let pages: unknown[] = [];
let pageTab: unknown = null;
const calls: { path: string; opts?: { method?: string; body?: unknown } }[] = [];

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    tenant: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, opts });
      if (path === "/site/copy/catalogue") return CATALOGUE;
      if (path === "/site/pages" && !opts?.method) return pages;
      if (path === "/site/pages" && opts?.method === "POST") {
        const body = opts.body as { key: string };
        const row = { page_id: "p-copy", key: body.key, is_published: false };
        pages = [row];
        return row;
      }
      if (path.startsWith("/site/pages/") && !opts?.method) return pageTab;
      if (path.startsWith("/site/pages/") && path.endsWith("/blocks")) {
        return { block_id: "b-1", type: "copy_overrides", content: opts?.body };
      }
      if (path.startsWith("/site/blocks/")) {
        return { block_id: "b-1", type: "copy_overrides", content: (opts?.body as { content: unknown })?.content };
      }
      return [];
    }),
  };
});

import { WebsiteCopyPage } from "./website-copy";

beforeEach(() => {
  pages = [];
  pageTab = null;
  calls.length = 0;
});

const mount = () =>
  render(
    <MemoryRouter>
      <WebsiteCopyPage />
    </MemoryRouter>,
  );

/** The last body sent to a block write, whichever endpoint took it. */
const savedItems = () => {
  const write = [...calls]
    .reverse()
    .find((c) => c.opts?.method && (c.path.endsWith("/blocks") || c.path.startsWith("/site/blocks/")));
  const body = write?.opts?.body as { content?: { items?: unknown[] }; items?: unknown[] };
  return (body?.content?.items ?? body?.items ?? []) as { key: string; value: { fr: string; en: string | null } }[];
};

describe("the wording screen", () => {
  it("shows the shipped sentence as a placeholder, not as a value", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    const french = await screen.findByPlaceholderText(
      "Des opérations que nous avons menées, dans nos mots.",
    );
    // The sentence is visible to the tenant AND the field is empty, which is
    // what makes "leave it blank to keep ours" a true statement.
    expect(french).toHaveValue("");
    expect(
      screen.getByPlaceholderText("Operations we have run, in our own words."),
    ).toHaveValue("");
  });

  it("saves only the rows the tenant actually wrote", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    const french = await screen.findByPlaceholderText(
      "Des opérations que nous avons menées, dans nos mots.",
    );
    await userEvent.type(french, "Des dossiers que nous avons pilotés.");
    await userEvent.click(screen.getByRole("button", { name: /Save wording/i }));

    await waitFor(() => expect(savedItems()).toHaveLength(1));
    expect(savedItems()[0]).toEqual({
      key: "site.portfolioPage.sub",
      value: { fr: "Des dossiers que nous avons pilotés.", en: null },
    });
  });

  it("creates the copy page on the first save and never before", async () => {
    mount();
    await screen.findByRole("button", { name: /Our work/i });
    // Opening the screen must not leave a row behind.
    expect(calls.some((c) => c.opts?.method === "POST")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /Our work/i }));
    await userEvent.type(
      await screen.findByPlaceholderText("Nos"),
      "Nos références",
    );
    await userEvent.click(screen.getByRole("button", { name: /Save wording/i }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.path === "/site/pages" && c.opts?.method === "POST"),
      ).toBeTruthy(),
    );
    const created = calls.find(
      (c) => c.path === "/site/pages" && c.opts?.method === "POST",
    );
    expect((created?.opts?.body as { key: string }).key).toBe("site-copy");
  });

  it("refuses to save an English-only override", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    await userEvent.type(
      await screen.findByPlaceholderText("Operations we have run, in our own words."),
      "Work we have run.",
    );

    expect(screen.getByRole("button", { name: /Save wording/i })).toBeDisabled();
    expect(
      screen.getByText(/Add the French too/i),
    ).toBeInTheDocument();
  });

  it("says the wording is not live while the page is a draft", async () => {
    pages = [{ page_id: "p-copy", key: "site-copy", is_published: false }];
    pageTab = {
      page: pages[0],
      blocks: [
        {
          block_id: "b-1",
          type: "copy_overrides",
          content: {
            items: [
              { key: "site.footer.legal", value: { fr: "Tous droits.", en: null } },
            ],
          },
        },
      ],
    };
    mount();

    expect(await screen.findByText(/Not live yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish wording/i })).toBeInTheDocument();
  });

  it("loads an existing override into its field", async () => {
    pages = [{ page_id: "p-copy", key: "site-copy", is_published: true }];
    pageTab = {
      page: pages[0],
      blocks: [
        {
          block_id: "b-1",
          type: "copy_overrides",
          content: {
            items: [
              {
                key: "site.portfolioPage.titleMain",
                value: { fr: "Nos références", en: "Reference" },
              },
            ],
          },
        },
      ],
    };
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    expect(await screen.findByDisplayValue("Nos références")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Reference")).toBeInTheDocument();
  });

  it("finds a row by the sentence a tenant can actually see", async () => {
    mount();
    await screen.findByRole("button", { name: /Our work/i });

    await userEvent.type(
      screen.getByLabelText(/Search the wording/i),
      "Operations we have run",
    );

    // The matching section opens itself, and the section that does not match is
    // gone entirely rather than sitting there empty.
    expect(
      await screen.findByPlaceholderText("Operations we have run, in our own words."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Footer/i })).not.toBeInTheDocument();
  });
});
