/**
 * Comms → Setup (PR-0).
 *
 * The thing most worth pinning is the tab gating: a non-administrator must see
 * exactly one section and no tab strip, because a strip with one item is noise
 * and a tab that always 403s teaches people to distrust the ones that work.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import * as React from "react";

const caps = vi.fn();
const mine = vi.fn(async () => []);

vi.mock("@/lib/mail-api", () => ({
  mailCapabilities: () => caps(),
  myMailboxes: () => mine(),
  sendAllowance: async () => null,
  allMailboxes: async () => [],
  listCatalogue: async () => [],
  listSendPoints: async () => [],
  listSenders: async () => [],
  autodiscover: async () => ({}),
  cpanelPreset: async () => ({}),
  connectImap: async () => ({}),
}));
vi.mock("../setup", () => ({ SetupPage: () => <div>senders and channels</div> }));
// Stubbed: this file is about which tabs are OFFERED, not what they render. The
// real page fetches on mount, which would only add act() noise to a gating test.
vi.mock("./my-mailbox", () => ({ MyMailboxTab: () => <h2>My mailbox</h2> }));
vi.mock("./mailboxes", () => ({ MailboxesTab: () => <div>mailbox inventory</div> }));
vi.mock("./send-points", () => ({ SendPointsTab: () => <div>routing table</div> }));

import { CommsSetupPage } from "./index";

// useResource is backed by react-query in the app; here it only has to resolve.
vi.mock("@/lib/use-resource", () => ({
  useResource: (fn: () => Promise<unknown>) => {
    const [data, setData] = React.useState<unknown>(null);
    const [loading, setLoading] = React.useState(true);
    React.useEffect(() => {
      let live = true;
      fn().then((d) => { if (live) { setData(d); setLoading(false); } }).catch(() => setLoading(false));
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return { data, loading, error: null, reload: () => {} };
  },
  errMsg: (e: unknown) => String(e),
}));

beforeEach(() => {
  caps.mockReset();
  mine.mockReset().mockResolvedValue([]);
});

describe("tab gating", () => {
  test("an ordinary user sees only their own mailbox, and no tab strip", async () => {
    caps.mockResolvedValue({ can_view: true, can_create: false, can_edit: false, can_administer: false, is_ceo: false });
    render(<CommsSetupPage />);
    await waitFor(() => expect(screen.getByText("My mailbox")).toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: /email setup sections/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Send points")).not.toBeInTheDocument();
    expect(screen.queryByText("Mailboxes")).not.toBeInTheDocument();
  });

  test("an administrator gets the full strip", async () => {
    caps.mockResolvedValue({ can_view: true, can_create: true, can_edit: true, can_administer: true, is_ceo: false });
    render(<CommsSetupPage />);
    const nav = await screen.findByRole("navigation", { name: /email setup sections/i });
    expect(nav).toBeInTheDocument();
    for (const label of ["My mailbox", "Mailboxes", "Send points", "Senders & channels"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  test("while capabilities are unknown, nothing admin-only is offered", () => {
    // Over-offering for a frame and then retracting is worse than a tab
    // appearing a moment later.
    caps.mockReturnValue(new Promise(() => {}));
    render(<CommsSetupPage />);
    expect(screen.queryByText("Send points")).not.toBeInTheDocument();
  });
});
