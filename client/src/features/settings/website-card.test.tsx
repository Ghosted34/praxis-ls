import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { NavAccess } from "@/lib/nav-access";
import {
  ShellContext,
  type ShellContextValue,
} from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";
import { __resetSiteMeta } from "@/lib/site-content-api";

/**
 * The one Settings card gated on a PACKAGE rather than on a grant.
 *
 * Every other card in the hub is filtered by `canOpenRoute` — "may this user
 * open that URL" — and that question has nothing to say about the website,
 * because `site_content` is deliberately NOT feature-gated server-side: an
 * editor has to be able to prepare a site before the package is bought. So the
 * decision is made in the UI, and it has three answers rather than two.
 *
 * THE THIRD ANSWER IS THE ONE WORTH TESTING. `null` means the read has not come
 * back — or came back 403, or failed — and it must show the card, not hide it.
 * `route-access.ts` states the rule for the unresolved permissions read and it
 * is the same rule here: over-offering for one frame is recoverable, a card
 * that vanishes after the grid has painted is not. A test that only checked
 * "off hides it" would pass on an implementation that hid it while loading.
 */

vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<
    typeof import("@/app/auth/auth-context")
  >("@/app/auth/auth-context");
  return {
    ...actual,
    useAuth: () => ({
      user: { user_id: "u-1", ai_enabled: false },
      status: "authed" as const,
    }),
  };
});

/** What `/site/meta` answers, per test. `null` throws — the 403 a user without
 *  MOD-29 view gets, and the network failure, are the same case here. */
let metaAnswer: { website_enabled: boolean } | null = { website_enabled: true };

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>(
      "@/lib/api-client",
    );
  return {
    ...actual,
    tenant: vi.fn(async (path: string) => {
      if (path === "/site/meta") {
        if (!metaAnswer) throw new actual.ApiError("ERROR", "no", 403);
        return metaAnswer;
      }
      return [];
    }),
  };
});

import { SettingsHub } from "./settings-hub";

/** MOD-70 opens the hub's other cards; MOD-29 is the one this card needs. */
const ADMIN = ["MOD-70", "MOD-29"];

function shell(modules: string[]): ShellContextValue {
  const access: NavAccess = {
    modules,
    groups: [],
    byGroup: {},
    isCeo: false,
    version: "v",
  };
  return {
    access,
    ready: true,
    resolved: true,
    prefs: EMPTY_SHELL_PREFS,
    setPrefs: () => {},
    grantNotice: null,
    dismissGrantNotice: () => {},
  };
}

function mount(ui: React.ReactElement, value: ShellContextValue) {
  return render(
    <MemoryRouter>
      <ShellContext.Provider value={value}>{ui}</ShellContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // The loader caches in module scope so the hub does not ask once per visit —
  // which means one test's answer would otherwise be every later test's answer.
  __resetSiteMeta();
  metaAnswer = { website_enabled: true };
});
afterEach(() => vi.clearAllMocks());

describe("the Website Pages card", () => {
  it("is offered when the website package is on", async () => {
    mount(<SettingsHub />, shell(ADMIN));
    expect(await screen.findByText("Website Pages")).toBeInTheDocument();
  });

  it("is not offered when the package is off", async () => {
    metaAnswer = { website_enabled: false };
    mount(<SettingsHub />, shell(ADMIN));
    await waitFor(() =>
      expect(screen.queryByText("Website Pages")).toBeNull(),
    );
    // The rest of the grid is untouched — this filters one card, not a section.
    expect(screen.getByText("Login Screen")).toBeInTheDocument();
  });

  it("is offered while the answer is unknown, and stays offered if it never comes", async () => {
    metaAnswer = null; // 403, or a failed read
    mount(<SettingsHub />, shell(ADMIN));
    // Present on the first paint, before anything could have resolved…
    expect(screen.getByText("Website Pages")).toBeInTheDocument();
    // …and still present once the failure has been handled.
    await waitFor(() =>
      expect(screen.getByText("Website Pages")).toBeInTheDocument(),
    );
  });

  it("stays hidden from a user without the module, whatever the package says", async () => {
    // The package answer must not become a way around the grant. MOD-70 alone
    // opens the hub; MOD-29 is what opens this screen.
    mount(<SettingsHub />, shell(["MOD-70"]));
    await waitFor(() =>
      expect(screen.queryByText("Website Pages")).toBeNull(),
    );
  });
});
