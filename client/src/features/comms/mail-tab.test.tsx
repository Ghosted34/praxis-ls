/**
 * The Mailbox tab after the legacy deletion.
 *
 * /comms/mail used to carry its own mode switcher — Inbox / "Message log" /
 * Mailboxes — where "Message log" was a working shadow of the PR-1 inbox and
 * the compose entry opened the legacy modal. Both are gone: the tab renders
 * the PR-1 inbox directly, composing goes through NewMessageDialog, and
 * mailbox connection management moved to Comms → Setup (ConnectionsTab).
 * This test pins the shape of the tab so the shadow cannot creep back.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderScreen } from "@/test/screen-harness";
import type { Mailbox } from "@/lib/mail-api";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

// The inbox subscribes to the tenant socket for `mail:new`; a silent stub keeps
// the test free of socket.io without touching the component under test.
vi.mock("@/lib/comms-socket", () => ({
  getCommsSocket: () => ({ on: () => {}, off: () => {} }),
}));

import { CommsHub } from "./hub";

const mailbox: Mailbox = {
  email_connection_id: "c1",
  email_address: "ops@company.cm",
  provider: "imap_smtp",
  kind: "PERSONAL",
  status: "CONNECTED",
  is_default: true,
  health: { level: "OK", reason: "syncing" },
};

function renderMailTab() {
  return renderScreen(<CommsHub />, {
    path: "/comms/mail",
    pattern: "/comms/:section",
    routes: {
      "/mail/mailboxes/mine": [mailbox],
      "/mail/folders": { folders: [], streams: { HUMAN: 0, SYSTEM: 0 } },
      "/mail/labels": [],
      "/mail/threads": [],
    },
  });
}

describe("the Mailbox tab", () => {
  it("RENDERS THE PR-1 INBOX DIRECTLY", async () => {
    renderMailTab();
    // The inbox's own surface: the search box and the compose entry —
    // enabled, because the fixture mailbox is connected.
    expect(await screen.findByLabelText("Search mail")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /compose/i })).toBeEnabled(),
    );
  });

  it("SHOWS NO LEGACY MODE SWITCHER — no Message log, no Mailboxes mode", async () => {
    renderMailTab();
    await screen.findByLabelText("Search mail");
    expect(screen.queryByText("Message log")).not.toBeInTheDocument();
    // The old switcher's three buttons were Inbox / Message log / Mailboxes.
    // The hub's own nav (Chat / Mailbox / Setup) remains — that is the hub,
    // not the removed in-page mode strip.
    expect(screen.queryByRole("button", { name: "Mailboxes" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mailbox" })).toBeInTheDocument();
  });

  it("keeps the hub's three sections reachable", async () => {
    renderMailTab();
    await screen.findByLabelText("Search mail");
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Setup" })).toBeInTheDocument();
  });
});
