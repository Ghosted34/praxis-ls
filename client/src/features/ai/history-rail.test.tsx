/**
 * The rail's conversation management (13920, audit J1–J5).
 *
 * WHAT THESE ARE POINTED AT. Before this, a thread could be opened and nothing
 * else — no pin, no rename, no archive, no delete — so a sensitive conversation
 * typed into the copilot stayed in the rail for good (J1). The controls that
 * fix that are a menu, a confirm and a prompt, and every one of them is the
 * kind of thing that looks right in a screenshot and is wrong in use:
 *
 *   - a menu nested inside the row's open button would deliver its clicks to
 *     whichever control the browser preferred;
 *   - a delete that quietly took the irreversible path, or quietly did not;
 *   - a `window.confirm`, which is banned (CLAUDE.md) and would have been the
 *     shortest way to write all of this.
 *
 * So the assertions are about what the user gets, not about what was called:
 * pressing Delete must reach a rendered dialog, and the purge flag must follow
 * the checkbox rather than the code path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/toast";
import { groupConversations } from "@/components/ai/thread";
import type { AiConversationMeta } from "@/lib/ai-api";
import { AiHistoryRail } from "./history-rail";

const USER = "u-1";

vi.mock("@/app/auth/auth-context", () => ({
  useAuth: () => ({ user: { user_id: USER } }),
}));

vi.mock("@/components/ai/context", () => ({
  useAiScopes: () => [
    { key: "all", label: "All areas", Icon: () => null },
    { key: "finance", label: "Finance", Icon: () => null },
  ],
}));

const conv = (o: Partial<AiConversationMeta> & { conversation_id: string }): AiConversationMeta => ({
  title: "Untitled",
  last_at: new Date().toISOString(),
  message_count: 2,
  pinned_at: null,
  archived_at: null,
  ...o,
});

const LIST = [
  conv({ conversation_id: "c1", title: "Douala customs file" }),
  conv({ conversation_id: "c2", title: "Payroll query", pinned_at: "2026-09-18T09:00:00Z" }),
];

function mount(over: Partial<React.ComponentProps<typeof AiHistoryRail>> = {}) {
  const props = {
    conversations: LIST,
    loading: false,
    activeId: "c1",
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onPatch: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onReload: vi.fn(),
    scope: "all",
    onScope: vi.fn(),
    busy: false,
    ...over,
  };
  render(
    <MemoryRouter>
      <ToastProvider>
        <AiHistoryRail {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return props;
}

/** Open one row's overflow menu and hand back its items. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: `Actions for ${title}` }));
  return screen.getByRole("menu");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.clearAllMocks());

describe("groupConversations — pinned above the buckets (J2)", () => {
  it("lifts pinned threads into their own leading group", () => {
    const groups = groupConversations(LIST);
    expect(groups[0].heading).toBe("Pinned");
    expect(groups[0].items.map((c) => c.conversation_id)).toEqual(["c2"]);
    // …and they are NOT also left in the time bucket they would have landed in.
    expect(groups.slice(1).flatMap((g) => g.items.map((c) => c.conversation_id))).toEqual(["c1"]);
  });

  it("orders several pins by when they were pinned, most recent first", () => {
    const groups = groupConversations([
      conv({ conversation_id: "a", pinned_at: "2026-09-01T00:00:00Z" }),
      conv({ conversation_id: "b", pinned_at: "2026-09-17T00:00:00Z" }),
    ]);
    expect(groups[0].items.map((c) => c.conversation_id)).toEqual(["b", "a"]);
  });

  it("shows no Pinned heading when nothing is pinned", () => {
    const groups = groupConversations([conv({ conversation_id: "a" })]);
    expect(groups.map((g) => g.heading)).not.toContain("Pinned");
  });
});

describe("the row overflow menu (J5)", () => {
  it("gives every row the four controls", async () => {
    const user = userEvent.setup();
    mount();
    const menu = await openMenu(user, "Douala customs file");
    for (const name of ["Pin to top", "Rename", "Archive", "Delete"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeTruthy();
    }
  });

  it("reads the pin item from the thread's current state", async () => {
    const user = userEvent.setup();
    mount();
    const menu = await openMenu(user, "Payroll query");
    expect(within(menu).getByRole("menuitem", { name: "Unpin" })).toBeTruthy();
  });

  it("sends the INTENDED state, not a toggle", async () => {
    const user = userEvent.setup();
    const props = mount();
    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Pin to top" }),
    );
    expect(props.onPatch).toHaveBeenCalledWith("c1", { pinned: true });
  });

  it("archives through the same patch", async () => {
    const user = userEvent.setup();
    const props = mount();
    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Archive" }),
    );
    expect(props.onPatch).toHaveBeenCalledWith("c1", { archived: true });
  });

  it("does not nest the menu trigger inside the row's open button", async () => {
    // The J5 shape: two sibling buttons, not a button inside a button — which
    // is invalid markup and makes the click target browser-dependent.
    mount();
    const trigger = screen.getByRole("button", { name: "Actions for Douala customs file" });
    expect(trigger.closest("button:not([aria-label^='Actions'])")).toBeNull();
  });
});

describe("rename goes through the branded prompt, never window.prompt (J3)", () => {
  it("renders a dialog with the current title prefilled, and patches on submit", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(window, "prompt");
    const props = mount();

    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Rename" }),
    );

    const field = await screen.findByLabelText(/title/i);
    expect((field as HTMLInputElement).value).toBe("Douala customs file");
    await user.clear(field);
    await user.type(field, "Customs — Douala 2026");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(props.onPatch).toHaveBeenCalledWith("c1", { title: "Customs — Douala 2026" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("patches nothing when the prompt is cancelled", async () => {
    const user = userEvent.setup();
    const props = mount();
    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Rename" }),
    );
    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(props.onPatch).not.toHaveBeenCalled();
  });
});

describe("delete is confirmed, and the irreversible half is opt-in (J1)", () => {
  it("never calls window.confirm", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(window, "confirm");
    mount();
    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Delete" }),
    );
    await screen.findByRole("dialog");
    expect(spy).not.toHaveBeenCalled();
  });

  it("removes nothing until the dialog is confirmed", async () => {
    const user = userEvent.setup();
    const props = mount();
    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Delete" }),
    );
    await screen.findByRole("dialog");
    expect(props.onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it("takes the SOFT path by default — the checkbox starts unticked", async () => {
    const user = userEvent.setup();
    const props = mount();
    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Delete" }),
    );
    await user.click(await screen.findByRole("button", { name: "Delete conversation" }));
    expect(props.onRemove).toHaveBeenCalledWith("c1", { purge: false });
  });

  it("purges only when the person ticks the box", async () => {
    const user = userEvent.setup();
    const props = mount();
    await user.click(
      within(await openMenu(user, "Douala customs file")).getByRole("menuitem", { name: "Delete" }),
    );
    await user.click(await screen.findByRole("checkbox", { name: /erase it permanently/i }));
    await user.click(screen.getByRole("button", { name: "Delete conversation" }));
    expect(props.onRemove).toHaveBeenCalledWith("c1", { purge: true });
  });
});

describe("the Spaces section collapses and is remembered per user (J4)", () => {
  it("starts open, and hides the scope list when collapsed", async () => {
    const user = userEvent.setup();
    mount();
    const toggle = screen.getByRole("button", { name: /spaces/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Finance" })).toBeTruthy();

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // `hidden` takes it out of the accessibility tree as well as off screen.
    expect(screen.queryByRole("button", { name: "Finance" })).toBeNull();
  });

  it("writes the preference under a key scoped to the user id", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: /spaces/i }));
    // A shared workstation is two people and one localStorage.
    expect(localStorage.getItem(`praxis.ai.rail.spaces:${USER}`)).toBe("closed");
  });

  it("restores a collapsed rail on the next mount", () => {
    localStorage.setItem(`praxis.ai.rail.spaces:${USER}`, "closed");
    mount();
    expect(
      screen.getByRole("button", { name: /spaces/i }).getAttribute("aria-expanded"),
    ).toBe("false");
  });
});

describe("archived threads are a separate, opt-in read", () => {
  it("keeps archived rows out of the time buckets", () => {
    mount({
      conversations: [...LIST, conv({ conversation_id: "c3", title: "Old tender", archived_at: "2026-09-01T00:00:00Z" })],
    });
    expect(screen.queryByText("Old tender")).toBeNull();
  });

  it("asks the server for them when the section is opened", async () => {
    const user = userEvent.setup();
    const props = mount();
    await user.click(screen.getByRole("button", { name: /archived/i }));
    expect(props.onReload).toHaveBeenCalledWith({ includeArchived: true });
  });

  it("offers Restore rather than Archive on an archived row", async () => {
    const user = userEvent.setup();
    const archived = conv({ conversation_id: "c3", title: "Old tender", archived_at: "2026-09-01T00:00:00Z" });
    const props = mount({ conversations: [...LIST, archived] });
    await user.click(screen.getByRole("button", { name: /archived/i }));
    await user.click(
      within(await openMenu(user, "Old tender")).getByRole("menuitem", { name: "Restore" }),
    );
    expect(props.onPatch).toHaveBeenCalledWith("c3", { archived: false });
  });
});
