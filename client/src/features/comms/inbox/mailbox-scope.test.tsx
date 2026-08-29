/**
 * THE INBOX OPENS ON A MAILBOX, NOT ON NOTHING.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The rail is mailbox-scoped: `listFolders` fails closed without a connection
 * id, and folders, their unread counts and the two stream totals all belong to
 * ONE connection. But the page opened with `{ folder: "INBOX", stream:
 * "HUMAN" }` and no mailbox, called `/mail/folders` with no `connection_id`,
 * got an empty list back, and drew:
 *
 *     FOLDERS
 *     No folders yet — sync the mailbox to discover them.
 *
 * over a mailbox that had synced perfectly well and was showing five
 * conversations three inches to the right. The only control that could set a
 * mailbox was the picker in the rail, and that picker renders only for people
 * with two or more — so someone with a single mailbox, which is most people,
 * could never leave that state. The two halves of the bug each hid the other:
 * the empty rail looked like a sync problem, and the sync was fine.
 *
 * ── WHAT IS PINNED HERE ─────────────────────────────────────────────────────
 *
 *   1. The first render already names a mailbox — the person's primary one —
 *      and the folder call carries it.
 *   2. With several mailboxes it is the DEFAULT one, and the others stay
 *      reachable through the picker.
 *   3. The conversation list follows the same mailbox as the rail, so the
 *      counts beside the folders describe the rows next to them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import type { Folder, Mailbox } from "@/lib/mail-api";

/**
 * Every path the screen asked for. The fixture map matches on the path WITHOUT
 * its query string, so the fixtures alone cannot tell whether the request
 * carried a mailbox — which is the whole question here.
 *
 * `vi.hoisted` because `vi.mock` factories are lifted above the imports: a
 * plain `const` above would not exist yet when the factory runs.
 */
const { asked } = vi.hoisted(() => ({ asked: [] as string[] }));

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const mock = await apiClientMock();
  return {
    ...mock,
    tenant: (path: string, ...rest: unknown[]) => {
      asked.push(path);
      return (mock.tenant as (p: string, ...r: unknown[]) => unknown)(path, ...rest);
    },
  };
});

// The inbox subscribes to the tenant socket for `mail:new`; a silent stub keeps
// the test free of socket.io without touching the component under test.
vi.mock("@/lib/comms-socket", () => ({
  getCommsSocket: () => ({ on: () => {}, off: () => {} }),
}));

import { InboxPage } from "./index";

const mailbox = (over: Partial<Mailbox> = {}): Mailbox =>
  ({
    email_connection_id: "c1",
    email_address: "ops@company.cm",
    provider: "imap_smtp",
    kind: "PERSONAL",
    status: "CONNECTED",
    health: { level: "OK", reason: "Syncing normally" },
    ...over,
  }) as Mailbox;

const inboxFolder: Folder = {
  email_folder_id: "f1",
  email_connection_id: "c1",
  canonical: "INBOX",
  provider_path: "INBOX",
  display_name: "Inbox",
  is_syncable: true,
  total: 12,
  unread_count: 3,
};

function renderInbox(mailboxes: Mailbox[]) {
  return renderScreen(<InboxPage />, {
    routes: {
      "/mail/mailboxes/mine": mailboxes,
      "/mail/folders": { folders: [inboxFolder], streams: { HUMAN: 3, SYSTEM: 0 } },
      "/mail/labels": [],
      "/mail/threads": [],
    },
  });
}

/** The connection id on the last request to a given endpoint. */
const askedFor = (endpoint: string) => {
  const hit = [...asked].reverse().find((p) => p.startsWith(endpoint));
  return hit ? new URLSearchParams(hit.split("?")[1] || "").get("connection_id") : null;
};

beforeEach(() => {
  asked.length = 0;
});

describe("the inbox is always pointed at a mailbox", () => {
  it("asks for the folders of the person's own mailbox, without being told to", async () => {
    renderInbox([mailbox()]);
    await waitFor(() => expect(askedFor("/mail/folders")).toBe("c1"));
  });

  it("SHOWS THE FOLDERS. The empty rail was the bug, not the mailbox", async () => {
    renderInbox([mailbox()]);
    const nav = await screen.findByRole("navigation", { name: "Mail folders" });
    // Both halves, in one test, because the fixture map answers `/mail/folders`
    // whatever the query says — so "a folder is drawn" alone would pass on the
    // broken screen, which asked for no mailbox and was answered with nothing.
    // What the user saw was the empty state; what caused it was the missing id.
    await waitFor(() => expect(askedFor("/mail/folders")).toBe("c1"));
    expect(await within(nav).findByRole("button", { name: /Inbox/ })).toBeInTheDocument();
    expect(
      screen.queryByText("No folders yet — sync the mailbox to discover them."),
    ).not.toBeInTheDocument();
  });

  it("does not ask someone with one mailbox to choose it", async () => {
    renderInbox([mailbox()]);
    await screen.findByRole("navigation", { name: "Mail folders" });
    expect(screen.queryByLabelText("Mailbox")).not.toBeInTheDocument();
  });

  it("opens on the DEFAULT mailbox when there are several, and keeps the rest reachable", async () => {
    renderInbox([
      mailbox({ email_connection_id: "c1", email_address: "ops@company.cm", kind: "SHARED" }),
      mailbox({
        email_connection_id: "c2",
        email_address: "me@company.cm",
        kind: "SHARED",
        is_default: true,
      }),
    ]);
    await waitFor(() => expect(askedFor("/mail/folders")).toBe("c2"));
    const picker = await screen.findByLabelText("Mailbox");
    expect(picker).toHaveValue("c2");
    // Every option is a mailbox. The old "All my mailboxes" entry resolved to
    // an empty rail under a message about syncing — a choice with nothing
    // behind it.
    const options = within(picker as HTMLSelectElement).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["ops@company.cm", "me@company.cm"]);
  });

  it("says nothing about folders while it is still finding out which mailbox", async () => {
    // "No folders yet — sync the mailbox to discover them" is a claim about a
    // particular mailbox. Before the mailbox list lands there is no mailbox to
    // make it about, and flashing it for half a second on every load is the
    // same wrong sentence the bug showed permanently.
    renderScreen(<InboxPage />, { pending: true });
    expect(
      screen.queryByText("No folders yet — sync the mailbox to discover them."),
    ).not.toBeInTheDocument();
  });

  it("follows the person to the mailbox they pick", async () => {
    renderInbox([
      mailbox({ email_connection_id: "c1", email_address: "ops@company.cm", is_default: true }),
      mailbox({ email_connection_id: "c2", email_address: "billing@company.cm", kind: "SHARED" }),
    ]);
    const picker = await screen.findByLabelText("Mailbox");
    await userEvent.selectOptions(picker, "c2");
    await waitFor(() => expect(askedFor("/mail/folders")).toBe("c2"));
  });

  it("lists the conversations OF THAT MAILBOX — the rail's counts describe the rows beside them", async () => {
    renderInbox([mailbox()]);
    await waitFor(() => expect(askedFor("/mail/threads")).toBe("c1"));
  });
});
