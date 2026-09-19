/**
 * EntityPicker — the PR-09 picker contract, asserted at the component.
 *
 * The acceptance conditions this file pins (audit CE-03 / CE-35, Decision Q6):
 *
 *   1. SEARCH IS SERVER-SIDE. Typing reaches `/entities` with `q=` and
 *      `registration_status=ACTIVE` — not a tenant-wide list filtered in the
 *      browser — so an entity beyond the 200th is as findable as the first.
 *   2. NO PROHIBITED LIFECYCLE STATE IS OFFERED. A non-ACTIVE row that reaches
 *      the results is dropped client-side even though the server already
 *      filters, and it is not offered through the keyboard either.
 *   3. HISTORY IS VISIBLE. An existing link to a deactivated entity names
 *      itself on the trigger, is explained (not offered) in the open panel,
 *      and has a replacement path: pick an active entity right below it.
 *   4. THE THREE STATES. Loading, empty and error each render as themselves —
 *      the old pattern showed "No matches" for a failed fetch.
 *
 * Fixtures are served through a spy on `apiClient.tenant` rather than the
 * harness's path-prefix map, because these tests must read the QUERY STRING:
 * "did the search term and the lifecycle filter actually reach the server" is
 * the whole point of PR-09, and a fixture keyed on the bare path cannot see it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as React from "react";
import * as apiClient from "@/lib/api-client";
import { EntityPicker } from "@/components/entity-picker";

const ACTIVE = { registration_status: "ACTIVE", is_active: true };
const DEACTIVATED = { registration_status: "DEACTIVATED", is_active: false };

const ALPHA = { entity_id: "e-alpha", code: "ALPHA", legal_name: "Alpha Logistics SARL", ...ACTIVE };
const OMEGA = { entity_id: "e-omega", code: "OMEGA", legal_name: "Omega Freight 205 SAS", ...ACTIVE };
const GONE = { entity_id: "e-gone", code: "GONE", legal_name: "Gone Bureau SARL", ...DEACTIVATED };

const ALL = [ALPHA, OMEGA, GONE];
const BY_ID = Object.fromEntries(ALL.map((e) => [e.entity_id, e]));

/** Serve `/entities` searches and `/entities/:id` lookups, recording every path. */
function serveEntities() {
  const paths: string[] = [];
  const spy = vi.spyOn(apiClient, "tenant").mockImplementation((async (
    path: string,
  ) => {
    paths.push(path);
    const url = new URL(path, "https://tenant.test");
    if (/^\/entities\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split("/")[2];
      return BY_ID[id] ?? {};
    }
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const rows = ALL.filter(
      (e) =>
        !q ||
        e.legal_name.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q),
    );
    return rows;
  }) as typeof apiClient.tenant);
  return { paths, restore: () => spy.mockRestore() };
}

/**
 * A CONTROLLED picker, the way every real call site uses it: the chosen id
 * flows back in as `value`, which is what makes the closed trigger show the
 * picked entity's name. An uncontrolled render would fire `onChange` into a
 * mock and never re-render, and the trigger assertions below would be testing
 * the mock, not the picker.
 */
function PickerHarness({
  initialValue = null,
  onChange,
  ...props
}: Partial<Parameters<typeof EntityPicker>[0]> & {
  initialValue?: string | null;
  onChange?: (id: string | null) => void;
}) {
  const [value, setValue] = React.useState<string | null>(initialValue);
  return (
    <EntityPicker
      label="Parent entity"
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
      {...props}
    />
  );
}

function renderPicker(props: Partial<Parameters<typeof PickerHarness>[0]> = {}) {
  const onChange = vi.fn();
  renderScreen(<PickerHarness onChange={onChange} {...props} />);
  return onChange;
}

async function open(
  user: ReturnType<typeof userEvent.setup>,
  label = "Parent entity",
) {
  await user.click(screen.getByRole("combobox", { name: label }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EntityPicker · server-side search (PR-09)", () => {
  it("queries the server with the ACTIVE lifecycle filter, not a tenant-wide list", async () => {
    const user = userEvent.setup();
    const server = serveEntities();
    renderPicker();

    await open(user);
    // The initial fetch: ACTIVE-only, bounded — never `?limit=200`.
    await waitFor(() =>
      expect(
        server.paths.some((p) => p === "/entities?registration_status=ACTIVE&limit=20"),
      ).toBe(true),
    );
    expect(
      server.paths.some((p) => p.includes("limit=200")),
    ).toBe(false);

    // Typing searches the SERVER: the term rides the query string.
    await user.type(screen.getByRole("combobox", { name: "Search entity" }), "omega");
    await screen.findByRole("option", { name: /Omega Freight 205 SAS/ });
    await waitFor(() =>
      expect(
        server.paths.some(
          (p) =>
            p ===
            "/entities?registration_status=ACTIVE&limit=20&q=omega",
        ),
      ).toBe(true),
    );
    server.restore();
  });

  it("finds and selects an entity past the 200-row ceiling the old pickers had", async () => {
    const user = userEvent.setup();
    serveEntities();
    const onChange = renderPicker();

    await open(user);
    // "Omega Freight 205 SAS" is the 205th entity on a tenant like the one in
    // the audit: unreachable through every browser-filtered picker.
    await user.type(
      screen.getByRole("combobox", { name: "Search entity" }),
      "Omega Freight 205",
    );
    await user.click(
      await screen.findByRole("option", { name: /Omega Freight 205 SAS/ }),
    );

    expect(onChange).toHaveBeenCalledWith("e-omega");
    // The closed trigger shows what was picked, without a refetch for the label.
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Parent entity" }),
      ).toHaveTextContent("OMEGA — Omega Freight 205 SAS"),
    );
  });

  it("offers the empty choice, which clears the link", async () => {
    const user = userEvent.setup();
    serveEntities();
    const onChange = renderPicker({ initialValue: "e-alpha" });

    await open(user);
    await user.click(await screen.findByRole("option", { name: "— none —" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("never offers an excluded id — the entity itself and its descendants in a parent picker", async () => {
    const user = userEvent.setup();
    serveEntities();
    renderPicker({ excludeIds: ["e-alpha"] });

    await open(user);
    await screen.findByRole("option", { name: /Omega Freight 205 SAS/ });
    expect(
      screen.queryByRole("option", { name: /Alpha Logistics SARL/ }),
    ).not.toBeInTheDocument();
  });
});

describe("EntityPicker · the lifecycle rule (Decision Q6)", () => {
  it("drops a non-ACTIVE row from the offered choices even if the server returns it", async () => {
    const user = userEvent.setup();
    serveEntities();
    renderPicker();

    await open(user);
    await screen.findByRole("option", { name: /Alpha Logistics SARL/ });
    // GONE is in the fixture's result set (the spy does not filter by
    // lifecycle — that is the point) and must not become a choice.
    expect(
      screen.queryByRole("option", { name: /Gone Bureau SARL/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps an existing inactive link visible as history, with a replacement path", async () => {
    const user = userEvent.setup();
    serveEntities();
    const onChange = renderPicker({ initialValue: "e-gone" });

    // The closed trigger names the linked entity AND its state — the operator
    // sees the history before opening anything. (The label arrives when the
    // by-id lookup resolves, so it is waited for, not assumed.)
    const trigger = await screen.findByRole("combobox", {
      name: "Parent entity",
    });
    await waitFor(() =>
      expect(trigger).toHaveTextContent("GONE — Gone Bureau SARL"),
    );
    expect(trigger).toHaveTextContent(/Deactivated — history/i);

    await open(user);
    // The open panel explains the link rather than offering it as a choice…
    const note = await screen.findByText(/Currently linked:/i);
    expect(within(note).getByText(/Gone Bureau SARL/)).toBeTruthy();
    expect(screen.getByText(/kept as history/i)).toBeTruthy();
    expect(screen.getByText(/pick one below to replace it/i)).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /Gone Bureau SARL/ }),
    ).not.toBeInTheDocument();

    // …and the active entities right below it are the replacement path.
    const replacement = await screen.findByRole("option", {
      name: /Alpha Logistics SARL/,
    });
    await user.click(replacement);
    expect(onChange).toHaveBeenCalledWith("e-alpha");
  });
});

describe("EntityPicker · loading, empty and error states", () => {
  it("renders its own loading state while the first search is in flight", async () => {
    const user = userEvent.setup();
    // A holder rather than a bare `let`: the assignment happens inside the
    // mocked promise, which control-flow analysis cannot see, so a plain
    // variable would narrow to `null` at the call site below.
    const release = { fire: null as (() => void) | null };
    vi.spyOn(apiClient, "tenant").mockImplementation((async () => {
      await new Promise<void>((resolve) => {
        release.fire = resolve;
      });
      return [ALPHA];
    }) as typeof apiClient.tenant);
    renderPicker();

    await open(user);
    expect(await screen.findByText("Searching entities…")).toBeTruthy();

    release.fire?.();
    await screen.findByRole("option", { name: /Alpha Logistics SARL/ });
  });

  it("says no ACTIVE entity matches, rather than a bare nothing", async () => {
    const user = userEvent.setup();
    serveEntities();
    renderPicker();

    await open(user);
    await user.type(
      screen.getByRole("combobox", { name: "Search entity" }),
      "nothing-called-this",
    );
    expect(
      await screen.findByText(/No active entity matches/i),
    ).toBeTruthy();
  });

  it("shows the failure and a Retry, instead of passing it off as 'no matches'", async () => {
    const user = userEvent.setup();
    let failFirst = true;
    vi.spyOn(apiClient, "tenant").mockImplementation((async (
      path: string,
    ) => {
      if (failFirst && path.startsWith("/entities?")) {
        failFirst = false;
        throw new apiClient.ApiError("NETWORK", "Connection lost", 503);
      }
      return [ALPHA];
    }) as typeof apiClient.tenant);
    renderPicker();

    await open(user);
    expect(await screen.findByText("Couldn't load entities.")).toBeTruthy();
    expect(screen.getByText("Connection lost")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("option", { name: /Alpha Logistics SARL/ });
    expect(failFirst).toBe(false);
  });
});

describe("EntityPicker · accessibility", () => {
  it("implements the combobox pattern: arrow keys move, Enter commits", async () => {
    const user = userEvent.setup();
    serveEntities();
    const onChange = renderPicker();

    const trigger = screen.getByRole("combobox", { name: "Parent entity" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await open(user);
    const input = screen.getByRole("combobox", { name: "Search entity" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    // choices[0] is the "— none —" entry; one ArrowDown lands on Alpha.
    await user.type(input, "{ArrowDown}");
    await user.type(input, "{Enter}");

    expect(onChange).toHaveBeenCalledWith("e-alpha");
  });

  it("stays axe-clean with results and a history note open", async () => {
    const user = userEvent.setup();
    serveEntities();
    const { container } = renderScreen(
      <EntityPicker label="Parent entity" value="e-gone" onChange={vi.fn()} />,
    );

    await open(user);
    // Wait until the panel is fully populated — options AND the history note —
    // so the scan covers every state the picker renders.
    await screen.findByRole("option", { name: /Alpha Logistics SARL/ });
    await screen.findByText(/Currently linked:/i);

    expect(await axe(container)).toHaveNoViolations();
  });
});

