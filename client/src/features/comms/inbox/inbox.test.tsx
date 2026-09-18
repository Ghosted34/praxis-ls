/**
 * PR-1A inbox — the three claims worth pinning.
 *
 *   1. A ROW IS A CONVERSATION, and its unread count and star are the CALLER's.
 *      Two people reading one shared mailbox must see different lists from the
 *      same rows; a test that only ever renders one user's view cannot show it,
 *      so these render both.
 *   2. THE CLASSIFIER'S REASON IS REACHABLE. A verdict a person cannot
 *      interrogate is one they will not trust, and "why is this in Notices?"
 *      has to be answerable from the screen.
 *   3. A PARTIAL BULK RESULT IS STATED. Archiving forty and silently dropping
 *      two is the failure the per-id result shape exists to prevent.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";
import { FolderRail, type RailSelection } from "./folder-rail";
import { renderScreen } from "@/test/screen-harness";
import type { Folder, Mailbox, Thread, ThreadDetail } from "@/lib/mail-api";

/**
 * The reading pane now carries the WORK RAIL (PR-3 → PR-5) — binding, the
 * record drawer, action cards, notes, triage. That is a deliberate change of
 * shape: the rail is part of the conversation view, not a sibling of it, and a
 * ThreadView that renders without it would be the version this programme spent
 * a whole QC pass removing.
 *
 * The cost lands here: the rail reaches the network through `useResource`
 * (TanStack Query) and deep-links through `react-router`, so the pane can no
 * longer be rendered bare. `renderScreen` supplies exactly the providers
 * `main.tsx` does, and `apiClientMock` answers the rail's calls — so these
 * tests still exercise the REAL component tree rather than a stubbed one.
 */
vi.mock("@/lib/api-client", async () => {
  // Imported INSIDE the factory: `vi.mock` is hoisted above the imports, so a
  // top-level binding is not initialised yet when it runs.
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

const thread = (over: Partial<Thread> = {}): Thread => ({
  email_thread_id: "t1",
  email_connection_id: "c1",
  thread_key: "<root>",
  subject: "Demurrage on MSKU1234567",
  participants: ["client@maersk.cm", "billing@co.cm"],
  message_count: 3,
  has_attachment: false,
  stream: "HUMAN",
  is_vip: false,
  entity_ref: null,
  last_message_at: new Date().toISOString(),
  mailbox_address: "billing@co.cm",
  unread_count: 2,
  is_starred: false,
  preview: "Please confirm the charges.",
  last_from: "client@maersk.cm",
  ...over,
});

function ListHarness({
  threads,
  bulkFailures = [],
  onBulk = vi.fn(),
  onStar = vi.fn(),
  folder,
  onEmptyFolder,
}: {
  threads: Thread[];
  bulkFailures?: { email_thread_id: string; error: string }[];
  onBulk?: (op: never, folder?: never) => void;
  onStar?: (t: Thread, on: boolean) => void;
  folder?: "INBOX" | "TRASH" | "SPAM";
  onEmptyFolder?: () => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  return (
    <ThreadList
      threads={threads}
      loading={false}
      activeId={null}
      selected={selected}
      onSelectedChange={setSelected}
      onOpen={vi.fn()}
      onStar={onStar}
      onBulk={onBulk as never}
      folder={folder}
      onEmptyFolder={onEmptyFolder}
      bulkBusy={false}
      bulkFailures={bulkFailures}
      onLoadMore={vi.fn()}
      hasMore={false}
      emptyHint="This folder is empty."
    />
  );
}

describe("the conversation list", () => {
  it("shows the counterparty, not our own mailbox address", () => {
    render(<ListHarness threads={[thread()]} />);
    // "billing@co.cm" is the mailbox being read; showing it in its own list is
    // noise the user cannot act on, so only the other party is named.
    expect(screen.getByText("client", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText(/billing/)).not.toBeInTheDocument();
  });

  it("falls back to the participant list when we are the only party", () => {
    render(
      <ListHarness
        threads={[thread({ participants: ["billing@co.cm"], last_from: "billing@co.cm" })]}
      />,
    );
    // An empty cell would read as a bug; the address is better than nothing.
    expect(screen.getByText("billing")).toBeInTheDocument();
  });

  it("THE SAME CONVERSATION READS DIFFERENTLY FOR TWO PEOPLE", () => {
    // Marie has read it; Paul has not. Same row, two users, two renderings.
    const { unmount } = render(
      <ListHarness threads={[thread({ unread_count: 0, is_starred: false })]} />,
    );
    const marie = screen.getByText("Demurrage on MSKU1234567");
    expect(marie.className).not.toMatch(/font-medium/);
    expect(screen.getByRole("button", { name: /^Star / })).toBeInTheDocument();
    unmount();

    render(<ListHarness threads={[thread({ unread_count: 2, is_starred: true })]} />);
    expect(screen.getByText("Demurrage on MSKU1234567").className).toMatch(/font-medium/);
    // Paul starred it, so his control offers to UNstar.
    expect(screen.getByRole("button", { name: /^Unstar / })).toBeInTheDocument();
  });

  it("the star is a real toggle button, not a clickable glyph", async () => {
    const onStar = vi.fn();
    render(<ListHarness threads={[thread()]} onStar={onStar} />);
    const star = screen.getByRole("button", { name: /^Star / });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(star);
    expect(onStar).toHaveBeenCalledWith(expect.objectContaining({ email_thread_id: "t1" }), true);
  });

  it("selecting is per row and rolls up to the header count", async () => {
    render(<ListHarness threads={[thread(), thread({ email_thread_id: "t2", subject: "Second" })]} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Select Demurrage/ }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Select all/ }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("A PARTIAL BULK RESULT IS ANNOUNCED, NOT SWALLOWED", () => {
    render(
      <ListHarness
        threads={[thread()]}
        bulkFailures={[{ email_thread_id: "t9", error: "conversation not found" }]}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/1 conversation could not be updated/);
    expect(status).toHaveTextContent(/conversation not found/);
  });

  it("an empty folder says what would fill it", () => {
    render(<ListHarness threads={[]} />);
    expect(screen.getByText("This folder is empty.")).toBeInTheDocument();
  });

  it("A ROW WITH A MALFORMED FIELD DOES NOT TAKE DOWN THE SCREEN", () => {
    // The production incident, as a test. `participants` arrived as the raw
    // Postgres literal instead of an array — node-postgres has no parser for
    // citext[] — and `(t.participants || []).filter` threw. Because the throw
    // was inside a row renderer, the error boundary took the entire Mailbox
    // screen: folder rail, list, reading pane, all of it, for one bad field.
    //
    // The server is fixed and a CI gate keeps it fixed. This asserts the second
    // line: the worst case is now one odd-looking row, not a screen nobody can
    // open.
    const malformed = { ...thread(), participants: "{client@maersk.cm,billing@co.cm}" as never };
    expect(() => render(<ListHarness threads={[malformed, thread({ email_thread_id: "t2", subject: "Healthy" })]} />))
      .not.toThrow();
    // And the healthy row beside it still renders.
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it.each([null, undefined, "", 42, {}])("survives participants = %p", (participants) => {
    expect(() => render(<ListHarness threads={[{ ...thread(), participants: participants as never }]} />))
      .not.toThrow();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ListHarness threads={[thread()]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

const detail = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({
  ...thread(),
  messages: [
    {
      email_message_id: "m1",
      email_thread_id: "t1",
      email_connection_id: "c1",
      direction: "IN",
      folder: "INBOX",
      from_address: "client@maersk.cm",
      to_address: ["billing@co.cm"],
      cc_address: [],
      subject: "Demurrage",
      body_text: "The first message.",
      body_preview: "The first message.",
      has_attachment: false,
      received_at: new Date("2026-08-01").toISOString(),
      is_read: true,
      is_starred: false,
    },
    {
      email_message_id: "m2",
      email_thread_id: "t1",
      email_connection_id: "c1",
      direction: "OUT",
      folder: "SENT",
      from_address: "billing@co.cm",
      to_address: ["client@maersk.cm"],
      cc_address: [],
      subject: "Re: Demurrage",
      body_text: "The latest reply.",
      body_preview: "The latest reply.",
      has_attachment: false,
      sent_via: "EXTERNAL",
      received_at: new Date("2026-08-02").toISOString(),
      is_read: true,
      is_starred: false,
    },
  ],
  ...over,
});

/**
 * ── DELETION (H-1), WHICH HAD NO CLIENT SURFACE AT ALL ──────────────────────
 *
 * `DELETE /mail/threads/:id` and `POST /mail/folders/empty` were built,
 * retention-aware, ledgered and told to the mail server — and neither had a
 * wrapper in `mail-api.ts`, which is also why `mail-client-api-wiring.test.js`
 * never flagged them: that gate walks the wrappers and asks who calls them, so
 * an endpoint with no wrapper is invisible to it. Trash accumulated for ever,
 * and `thread.service`'s own comment called the endpoint "the Empty Trash the
 * product did not have".
 */
describe("deleting for ever", () => {
  it("is offered in Trash, where moving to Trash is a no-op", async () => {
    const onBulk = vi.fn();
    render(<ListHarness threads={[thread()]} folder="TRASH" onBulk={onBulk} />);
    await userEvent.click(screen.getByLabelText("Select all conversations"));
    expect(screen.getByRole("button", { name: "Delete for ever" })).toBeInTheDocument();
    // …and the no-op is not.
    expect(screen.queryByRole("button", { name: "Trash" })).toBeNull();
  });

  it("IS NOT OFFERED IN THE INBOX, where Trash is the reversible verb", async () => {
    render(<ListHarness threads={[thread()]} folder="INBOX" />);
    await userEvent.click(screen.getByLabelText("Select all conversations"));
    expect(screen.queryByRole("button", { name: "Delete for ever" })).toBeNull();
    expect(screen.getByRole("button", { name: "Trash" })).toBeInTheDocument();
  });

  it("asks the server for the delete verb the validator has always accepted", async () => {
    const onBulk = vi.fn();
    render(<ListHarness threads={[thread()]} folder="SPAM" onBulk={onBulk} />);
    await userEvent.click(screen.getByLabelText("Select all conversations"));
    await userEvent.click(screen.getByRole("button", { name: "Delete for ever" }));
    expect(onBulk).toHaveBeenCalledWith("delete");
  });

  it("offers Empty the bin only in Trash, and only when there is something in it", () => {
    const onEmpty = vi.fn();
    const { rerender } = render(
      <ListHarness threads={[thread()]} folder="TRASH" onEmptyFolder={onEmpty} />,
    );
    expect(screen.getByRole("button", { name: "Empty the bin" })).toBeInTheDocument();

    rerender(<ListHarness threads={[]} folder="TRASH" onEmptyFolder={onEmpty} />);
    expect(screen.queryByRole("button", { name: "Empty the bin" })).toBeNull();

    rerender(<ListHarness threads={[thread()]} folder="INBOX" onEmptyFolder={onEmpty} />);
    expect(screen.queryByRole("button", { name: "Empty the bin" })).toBeNull();
  });
});

describe("the conversation view", () => {
  /** The rail's endpoints, answered with nothing — these tests are about the
   *  correspondence, and an empty rail is a valid rail. */
  const railFixtures = {
    routes: {
      "/mail/threads/t1/suggestions": [],
      "/mail/threads/t1/notes": [],
      "/mail/threads/t1/intake": [],
      "/mail/threads/t1/cards": { thread_id: "t1", cards: [] },
    },
  };
  const renderView = (ui: React.ReactElement) => renderScreen(ui, railFixtures);

  const props = {
    loading: false,
    labels: [],
    busy: false,
    onMove: vi.fn(),
    onStream: vi.fn(),
    onLabel: vi.fn(),
    onToggleRead: vi.fn(),
    onClose: vi.fn(),
  };

  it("offers permanent deletion only when the caller supplies it", () => {
    // The inbox passes `onDelete` only while reading Trash or Spam; everywhere
    // else "Move to… Trash" is the reversible verb and this must not appear.
    const { unmount } = renderView(<ThreadView thread={detail()} {...props} />);
    expect(screen.queryByRole("button", { name: "Delete for ever" })).toBeNull();
    unmount();

    renderView(<ThreadView thread={detail()} {...props} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete for ever" })).toBeInTheDocument();
  });

  it("opens the newest message and leaves the history collapsed", () => {
    renderView(<ThreadView thread={detail()} {...props} />);
    expect(screen.getByText("The latest reply.")).toBeInTheDocument();
    // The first message's body is not rendered — only its preview, inside the
    // collapsed header.
    //
    // Scoped to the message ARTICLE rather than the document: the work rail's
    // accordion sections are also collapsed buttons, and a bare
    // `getByRole("button", { expanded: false })` now matches several. Scoping
    // is the fix rather than a `getAllBy`[0] — this test is about the first
    // MESSAGE, and an index into a flat list would silently start asserting
    // about a rail section the day the order changes.
    const first = within(screen.getAllByRole("article")[0]).getByRole("button", {
      expanded: false,
    });
    expect(within(first).getByText("The first message.")).toBeInTheDocument();
  });

  it("SAYS WHERE A REPLY WAS ACTUALLY SENT FROM", () => {
    // PR-0's origin tag, surfaced. "Did anyone answer this?" should be
    // answerable from the thread rather than by asking in chat.
    renderView(<ThreadView thread={detail()} {...props} />);
    expect(screen.getByText("Sent from another device")).toBeInTheDocument();
  });

  it("does not label a message the product itself sent", () => {
    const d = detail();
    d.messages[1].sent_via = "PRAXIS";
    renderView(<ThreadView thread={d} {...props} />);
    expect(screen.queryByText("Sent from another device")).not.toBeInTheDocument();
  });

  it("GIVES THE CLASSIFIER'S REASON NEXT TO THE CONTROL THAT OVERRIDES IT", async () => {
    renderView(
      <ThreadView
        thread={detail({
          stream: "SYSTEM",
          stream_reason: "Carries Auto-Submitted, which RFC 3834 reserves for automated mail.",
        })}
        {...props}
      />,
    );
    expect(screen.getByText(/RFC 3834/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "This is a person" }));
    expect(props.onStream).toHaveBeenCalledWith("HUMAN");
  });

  it("offers the read toggle in the direction that matches the state", () => {
    const { unmount } = renderView(<ThreadView thread={detail({ unread_count: 2 })} {...props} />);
    expect(screen.getByRole("button", { name: "Mark read" })).toBeInTheDocument();
    unmount();
    renderView(<ThreadView thread={detail({ unread_count: 0 })} {...props} />);
    expect(screen.getByRole("button", { name: "Mark unread" })).toBeInTheDocument();
  });

  it("invites a choice rather than showing an empty pane", () => {
    renderView(<ThreadView thread={null} {...props} />);
    expect(screen.getByText(/Choose a conversation/)).toBeInTheDocument();
  });

  it("SURVIVES MALFORMED ADDRESS FIELDS on a message", () => {
    // Same incident, the reading pane's half of it: `to_address.join` and
    // `cc_address.length` on a string would throw the same way.
    const d = detail();
    d.messages[0].to_address = "{ops@co.cm}" as never;
    d.messages[1].cc_address = null as never;
    d.participants = "{a@b.cm}" as never;
    expect(() => renderView(<ThreadView thread={d} {...props} />)).not.toThrow();
    expect(screen.getByText("The latest reply.")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderView(<ThreadView thread={detail()} {...props} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  /* ── THE WORK RAIL IS COLLAPSIBLE (review §2 #22) ───────────────────────────
   *
   * The rail was a fixed 22rem column that nothing could shut. On a 1280px
   * laptop — what the operations desk actually runs — that is a third of the
   * pane permanently spent, and long quoted correspondence became a column of
   * six words. The fix has to hold four things at once, and each is a way the
   * obvious implementation goes wrong:
   *
   *   1. There is ALWAYS A WAY BACK. Hiding a panel with no affordance to
   *      restore it is how a feature gets lost; the binding chip lives in this
   *      rail and it is the most consequential control in the mailbox.
   *   2. COLLAPSED STILL SPEAKS. Unbound and overdue are what an operator scans
   *      for, so they survive the collapse as a badge. Hiding the panel must
   *      not hide the queue.
   *   3. IT IS A PREFERENCE, NOT PER-THREAD STATE. Reset it on thread change
   *      and someone reading forty threads re-collapses it forty times.
   *   4. THE PANEL OUTLIVES A BROKEN localStorage. Safari's private mode throws
   *      on `setItem`; a toggle that throws is worse than one that forgets.
   */
  describe("collapsing the work rail", () => {
    beforeEach(() => localStorage.clear());

    it("starts collapsed, so the reading pane gets the width by default", () => {
      renderView(<ThreadView thread={detail()} {...props} />);
      // The rail's own landmark is absent, not merely narrow.
      expect(document.getElementById("mail-work-rail")).toBeNull();
      expect(screen.getByRole("button", { expanded: false, name: /Work panel/ })).toBeInTheDocument();
    });

    it("OPENS AND SHUTS AGAIN — the way back is on screen in both states", async () => {
      renderView(<ThreadView thread={detail()} {...props} />);

      await userEvent.click(screen.getByRole("button", { name: /Work panel/ }));
      expect(document.getElementById("mail-work-rail")).not.toBeNull();

      // …and the open rail carries its own collapse control. A panel you can
      // only shut from outside itself is one people shut by reloading.
      await userEvent.click(screen.getByRole("button", { name: /Hide/ }));
      expect(document.getElementById("mail-work-rail")).toBeNull();
      expect(screen.getByRole("button", { name: /Work panel/ })).toBeInTheDocument();
    });

    it("REMEMBERS THE CHOICE ACROSS THREADS, because it is a preference", async () => {
      const { unmount } = renderView(<ThreadView thread={detail()} {...props} />);
      await userEvent.click(screen.getByRole("button", { name: /Work panel/ }));
      expect(localStorage.getItem("comms:work-rail-open")).toBe("true");
      unmount();

      // A different thread, freshly mounted — the rail is still open. This is
      // the assertion that fails if someone "tidies up" by resetting the state
      // in the thread-change effect next to `replying`.
      renderView(<ThreadView thread={detail({ email_thread_id: "t1", subject: "Another" })} {...props} />);
      expect(document.getElementById("mail-work-rail")).not.toBeNull();
    });

    it("says, while collapsed, that the thread is not bound to anything", () => {
      renderView(<ThreadView thread={detail({ entity_ref: null })} {...props} />);
      expect(screen.getByTitle("Not linked to a client or a file yet")).toBeInTheDocument();
    });

    it("lets an overdue reply outrank the unbound mark", () => {
      // Both conditions at once: a deadline beats a classification, because a
      // deadline is the one with a consequence attached to the clock.
      renderView(<ThreadView thread={detail({ entity_ref: null, sla_breached: true })} {...props} />);
      expect(screen.getByTitle("A first reply is overdue")).toBeInTheDocument();
      expect(screen.queryByTitle("Not linked to a client or a file yet")).toBeNull();
    });

    it("shows NO badge when the thread is bound and on time", () => {
      // A badge that is always there is not a signal.
      renderView(<ThreadView thread={detail({ entity_ref: "CLI-1", sla_breached: false })} {...props} />);
      expect(screen.queryByTitle(/overdue|Not linked/)).toBeNull();
    });

    it("still toggles when localStorage is unavailable", async () => {
      // Safari private mode, and any browser with site data blocked. The
      // preference is expendable; the panel is not.
      //
      // Scoped to THIS key rather than the whole Storage prototype: a blanket
      // throw also takes out `token-store`, and the test would then be proving
      // that an unauthenticated screen fails to render.
      const realGet = Storage.prototype.getItem;
      const realSet = Storage.prototype.setItem;
      const denied = (k: string) => k === "comms:work-rail-open";
      const setItem = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(function (this: Storage, k: string, v: string) {
          if (denied(k)) throw new Error("QuotaExceededError");
          return realSet.call(this, k, v);
        });
      const getItem = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(function (this: Storage, k: string) {
          if (denied(k)) throw new Error("SecurityError");
          return realGet.call(this, k);
        });
      try {
        renderView(<ThreadView thread={detail()} {...props} />);
        await userEvent.click(screen.getByRole("button", { name: /Work panel/ }));
        expect(document.getElementById("mail-work-rail")).not.toBeNull();
      } finally {
        setItem.mockRestore();
        getItem.mockRestore();
      }
    });

    it("has no accessibility violations in either state", async () => {
      const { container, unmount } = renderView(<ThreadView thread={detail()} {...props} />);
      expect(await axe(container)).toHaveNoViolations();
      // `aria-controls` points at an element that only exists when open, which
      // is exactly why the collapsed button carries `aria-expanded={false}`.
      await userEvent.click(screen.getByRole("button", { name: /Work panel/ }));
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    });
  });
});

const folder = (over: Partial<Folder> = {}): Folder => ({
  email_folder_id: "f1",
  email_connection_id: "c1",
  canonical: "INBOX",
  provider_path: "INBOX",
  display_name: "Inbox",
  is_syncable: true,
  total: 10,
  unread_count: 3,
  ...over,
});

const mailbox = (over: Partial<Mailbox> = {}): Mailbox =>
  ({
    email_connection_id: "c1",
    email_address: "billing@co.cm",
    provider: "imap_smtp",
    kind: "SHARED",
    status: "CONNECTED",
    health: { level: "OK", reason: "Syncing normally" },
    ...over,
  }) as Mailbox;

function RailHarness({
  folders,
  mailboxes = [mailbox()],
}: {
  folders: Folder[];
  mailboxes?: Mailbox[];
}) {
  const [sel, setSel] = React.useState<RailSelection>({ folder: "INBOX", stream: "HUMAN" });
  return (
    <FolderRail
      mailboxes={mailboxes}
      folders={folders}
      labels={[]}
      selection={sel}
      onChange={setSel}
      humanUnread={4}
      systemUnread={11}
    />
  );
}

describe("the folder rail", () => {
  // The rail remembers open sections in localStorage: clear it so each test
  // starts from the default — everything shut except the folders.
  beforeEach(() => window.localStorage.clear());

  it("puts triage above the folders, because it is the decision that matters", () => {
    render(<RailHarness folders={[folder()]} />);
    const nav = screen.getByRole("navigation", { name: "Mail folders" });
    const text = nav.textContent || "";
    expect(text.indexOf("Triage")).toBeLessThan(text.indexOf("Folders"));
  });

  it("starts with every section shut except the folders", () => {
    render(<RailHarness folders={[folder()]} />);
    expect(screen.getByRole("button", { name: "Triage" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Views" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Not sent yet" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Folders" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: /People/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Starred/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /My drafts/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Inbox/ })).toBeInTheDocument();
  });

  it("opens a shut section from its header", async () => {
    render(<RailHarness folders={[folder()]} />);
    expect(screen.queryByRole("button", { name: /Notices/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Triage" }));
    expect(screen.getByRole("button", { name: /Notices/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Triage" })).toHaveAttribute("aria-expanded", "true");
  });

  it("names the current selection on a shut section that holds it", () => {
    // The default selection is Triage's People, and Triage starts shut — the
    // header says where you are rather than leaving the rail with nothing
    // visibly active.
    render(<RailHarness folders={[folder()]} />);
    const nav = screen.getByRole("navigation", { name: "Mail folders" });
    expect(nav.textContent || "").toContain("People");
  });

  it("remembers open sections across visits", async () => {
    const { unmount } = render(<RailHarness folders={[folder()]} />);
    await userEvent.click(screen.getByRole("button", { name: "Triage" }));
    unmount();
    render(<RailHarness folders={[folder()]} />);
    expect(screen.getByRole("button", { name: "Triage" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /People/ })).toBeInTheDocument();
  });

  it("shows the caller's unread counts on both streams", async () => {
    render(<RailHarness folders={[folder()]} />);
    await userEvent.click(screen.getByRole("button", { name: "Triage" }));
    const people = screen.getByRole("button", { name: /People/ });
    expect(people).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: /Notices/ })).toHaveTextContent("11");
  });

  it("does not ask someone with one mailbox to choose it", () => {
    const { unmount } = render(<RailHarness folders={[folder()]} />);
    expect(screen.queryByLabelText("Mailbox")).not.toBeInTheDocument();
    unmount();
    render(
      <RailHarness
        folders={[folder()]}
        mailboxes={[mailbox(), mailbox({ email_connection_id: "c2", email_address: "ops@co.cm" })]}
      />,
    );
    expect(screen.getByLabelText("Mailbox")).toBeInTheDocument();
  });

  it("OFFERS ONLY MAILBOXES — there is no 'no mailbox' to choose", () => {
    // The picker used to open with "All my mailboxes", which is not a rail this
    // component can draw: folders, their counts and the stream totals all
    // belong to one connection, so the option resolved to an empty list under
    // "No folders yet — sync the mailbox to discover them."
    render(
      <RailHarness
        folders={[folder()]}
        mailboxes={[mailbox(), mailbox({ email_connection_id: "c2", email_address: "ops@co.cm" })]}
      />,
    );
    const picker = screen.getByLabelText("Mailbox") as HTMLSelectElement;
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
    expect(picker.value).toBeTruthy();
  });

  it("A MAILBOX WITH NO FOLDERS EXPLAINS ITSELF RATHER THAN LEAVING A GAP", () => {
    render(<RailHarness folders={[]} />);
    expect(screen.getByText(/sync the mailbox to discover them/i)).toBeInTheDocument();
  });

  it("surfaces a folder the server refused, rather than leaving the list quietly short", () => {
    render(
      <RailHarness
        folders={[folder(), folder({ email_folder_id: "f2", canonical: "SPAM", display_name: "Junk", last_error: "SELECT failed" })]}
      />,
    );
    expect(screen.getByText("Some folders did not sync")).toBeInTheDocument();
    expect(screen.getByText("Junk")).toBeInTheDocument();
  });

  it("marks the selected entry for assistive technology, not just visually", async () => {
    render(<RailHarness folders={[folder()]} />);
    await userEvent.click(screen.getByRole("button", { name: "Triage" }));
    expect(screen.getByRole("button", { name: /People/ })).toHaveAttribute("aria-current", "true");
    await userEvent.click(screen.getByRole("button", { name: /Notices/ }));
    expect(screen.getByRole("button", { name: /Notices/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /People/ })).not.toHaveAttribute("aria-current");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<RailHarness folders={[folder()]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
