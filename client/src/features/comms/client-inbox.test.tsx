/**
 * The Client inbox (Comms › Clients, client portal PR 3): every client's
 * portal conversations, waiting first; Waiting / Mine / All with their counts;
 * a conversation opens beside the list with the client's account manager and
 * the reply box; and a team alert's deep link lands on the conversation itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

const calls = vi.hoisted(() => [] as string[]);
const media = vi.hoisted(() => ({ desktop: true }));

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string) => {
      calls.push(path);
      return base.tenant(path);
    },
  };
});

vi.mock("@/lib/use-media-query", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-media-query")>("@/lib/use-media-query");
  return { ...actual, useIsDesktop: () => media.desktop };
});

import { ClientInboxPage } from "./client-inbox";

const SHIP = "d1111111-1111-4111-8111-111111111111";
const ITEMS = [
  {
    client_id: "c1", client_name: "Acme Trading", thread: SHIP, dossier_id: SHIP, dossier_ref: "PRX-1",
    unread: 2, waiting_since: "2026-09-28T09:58:00Z",
    last: { direction: "CLIENT", preview: "Is it out of port?", kind: "TEXT", at: "2026-09-28T10:00:00Z" },
    manager: { user_id: "u-awa", name: "Awa Ndiaye" }, mine: true,
  },
  {
    client_id: "c2", client_name: "Bois du Sud", thread: "general", dossier_id: null, dossier_ref: null,
    unread: 1, waiting_since: "2026-09-26T08:00:00Z",
    last: { direction: "CLIENT", preview: null, kind: "LOCATION", at: "2026-09-26T08:00:00Z" },
    manager: null, mine: false,
  },
];
const INBOX = { filter: "waiting", counts: { all: 5, waiting: 2, mine: 1 }, items: ITEMS };

const ROUTES = {
  "/portal/chat/inbox": INBOX,
  "/clients/c1/account-manager": { client_id: "c1", manager: { user_id: "u-awa", name: "Awa Ndiaye", job_title: null, email: null, employee_id: "e-awa", reachable: true } },
  "/clients/c2/account-manager": { client_id: "c2", manager: null },
  "/portal/chat/threads": [],
  "/portal/chat/messages": {
    thread: SHIP, dossier_ref: "PRX-1", has_more: false,
    messages: [{
      message_id: "m1", direction: "CLIENT", body: "Is it out of port?", created_at: "2026-09-28T10:00:00Z",
      author: { name: null, email: "buyer@acme.cm" }, seen: null, milestone: null, location: null, attachments: [],
    }],
  },
  "/portal/chat/read": {},
};

const inboxReads = () => calls.filter((p) => p.startsWith("/portal/chat/inbox"));

beforeEach(() => {
  calls.length = 0;
  media.desktop = true;
});

describe("the Client inbox", () => {
  it("lists what is waiting, with the counts behind each filter", async () => {
    renderScreen(<ClientInboxPage />, { routes: ROUTES });
    expect(await screen.findByText("Acme Trading")).toBeInTheDocument();
    expect(inboxReads()).toEqual(["/portal/chat/inbox?filter=waiting"]);

    // Whose line it was, then the line — or what was sent when it had no words.
    expect(screen.getByText("Client · Is it out of port?")).toBeInTheDocument();
    expect(screen.getByText("Client · Location")).toBeInTheDocument();
    expect(screen.getByText("PRX-1")).toBeInTheDocument();
    // Who looks after each client, and who nobody does.
    expect(screen.getByText("Awa Ndiaye")).toBeInTheDocument();
    expect(screen.getByText("No account manager")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Waiting/ })).toHaveTextContent("2");
    expect(screen.getByRole("radio", { name: /Mine/ })).toHaveTextContent("1");
    expect(screen.getByRole("radio", { name: /All/ })).toHaveTextContent("5");
  });

  it("asks the server again for Mine", async () => {
    const user = userEvent.setup();
    renderScreen(<ClientInboxPage />, { routes: ROUTES });
    await screen.findByText("Acme Trading");
    await user.click(screen.getByRole("radio", { name: /Mine/ }));
    expect(inboxReads()).toContain("/portal/chat/inbox?filter=mine");
  });

  it("opens a conversation beside the list, with its account manager and the reply box", async () => {
    const user = userEvent.setup();
    renderScreen(<ClientInboxPage />, { routes: ROUTES });
    await user.click(await screen.findByText("Acme Trading"));

    expect(await screen.findByRole("heading", { name: "Acme Trading" })).toBeInTheDocument();
    expect(await screen.findByText("Account manager")).toBeInTheDocument();
    // The thread is read: the client's own message is on screen, and reading it
    // is what their "seen" tick is.
    expect(await screen.findAllByText("Is it out of port?")).not.toHaveLength(0);
    expect(calls).toContain(`/portal/chat/messages?client_id=c1&thread=${SHIP}`);
    expect(calls).toContain("/portal/chat/read");
  });

  it("opens a conversation as a sheet over the list on a phone", async () => {
    media.desktop = false;
    const user = userEvent.setup();
    renderScreen(<ClientInboxPage />, { routes: ROUTES });
    await screen.findByText("Client · Is it out of port?");
    // The list is the page: no empty detail pane stacked under it.
    expect(screen.queryByText("No conversation open")).toBeNull();

    await user.click(screen.getAllByText("Acme Trading")[0]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Acme Trading")).toBeInTheDocument();
    expect(await within(sheet).findByText("Account manager")).toBeInTheDocument();
  });

  it("says when the list stops short of everything", async () => {
    renderScreen(<ClientInboxPage />, { routes: { ...ROUTES, "/portal/chat/inbox": { ...INBOX, truncated: true } } });
    expect(await screen.findByText(/Showing the most recent conversations/)).toBeInTheDocument();
  });

  it("says so when nothing is waiting", async () => {
    renderScreen(<ClientInboxPage />, {
      routes: { ...ROUTES, "/portal/chat/inbox": { filter: "waiting", counts: { all: 3, waiting: 0, mine: 0 }, items: [] } },
    });
    expect(await screen.findByText("Nothing waiting — every client has an answer")).toBeInTheDocument();
    expect(screen.getByText("No conversation open")).toBeInTheDocument();
  });

  it("opens the conversation an alert links to, whatever the filter", async () => {
    renderScreen(<ClientInboxPage />, { routes: ROUTES, path: `/comms/clients?client=c1&thread=${SHIP}` });
    expect(await screen.findByRole("heading", { name: "Acme Trading" })).toBeInTheDocument();
    // A link to one conversation shows every conversation, so it is in the list.
    expect(inboxReads()).toContain("/portal/chat/inbox?filter=all");
    const list = screen.getByText("Client · Is it out of port?").closest("button");
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getByText("Acme Trading")).toBeInTheDocument();
  });
});
