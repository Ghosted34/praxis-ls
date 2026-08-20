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
import { describe, it, expect, vi } from "vitest";
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
}: {
  threads: Thread[];
  bulkFailures?: { email_thread_id: string; error: string }[];
  onBulk?: (op: never, folder?: never) => void;
  onStar?: (t: Thread, on: boolean) => void;
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
  it("puts triage above the folders, because it is the decision that matters", () => {
    render(<RailHarness folders={[folder()]} />);
    const nav = screen.getByRole("navigation", { name: "Mail folders" });
    const text = nav.textContent || "";
    expect(text.indexOf("People")).toBeLessThan(text.indexOf("Inbox"));
  });

  it("shows the caller's unread counts on both streams", () => {
    render(<RailHarness folders={[folder()]} />);
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
