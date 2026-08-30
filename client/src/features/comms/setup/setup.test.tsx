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
  /**
   * This asserted "and no tab strip" until PR-5's surfaces landed.
   *
   * An ordinary user now has two tabs, because two of those surfaces are
   * genuinely theirs: `workflow.listFollowups` filters on `f.user_id = $1`, so
   * the follow-up list is their own pending boomerangs and nobody else's.
   * Secure links went the other way — `secure-link.list` has no `created_by`
   * filter and its labels name clients and invoices, so it is admin-only.
   *
   * What has NOT changed, and is what this test is really for: no admin surface
   * leaks to a non-admin.
   */
  test("an ordinary user sees their own mailbox and their own follow-ups, and nothing administrative", async () => {
    caps.mockResolvedValue({ can_view: true, can_create: false, can_edit: false, can_administer: false, is_ceo: false });
    render(<CommsSetupPage />);
    await waitFor(() => expect(screen.getAllByText("My mailbox").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Follow-ups").length).toBeGreaterThan(0);
    for (const adminOnly of ["Send points", "Mailboxes", "Response times", "Trust & archive", "Secure links", "Senders & channels"]) {
      expect(screen.queryByText(adminOnly)).not.toBeInTheDocument();
    }
  });

  test("an administrator gets the full strip", async () => {
    caps.mockResolvedValue({ can_view: true, can_create: true, can_edit: true, can_administer: true, is_ceo: false });
    render(<CommsSetupPage />);
    /*
     * Wait for the CAPABILITIES, not for the strip.
     *
     * This was `await findByRole("navigation")`, and that stopped being a wait
     * for anything when the Connections and Follow-ups tabs landed
     * (5517e857): a non-admin now has three tabs, so the strip renders before
     * `mailCapabilities()` answers. `findBy*` is `waitFor(getBy*)`, whose first
     * poll is ~50ms — so when the answer beats that poll the strip is already
     * full and this passes, and when it does not, `findByRole` resolves against
     * the PRE-admin render and every synchronous assertion below reads that
     * DOM. Locally the answer wins; on a runner carrying 1 888 tests across
     * parallel workers it does not, which is the intermittent red this file
     * produced in CI while passing on every desk.
     *
     * An admin-only label is the only thing whose presence proves the answer
     * arrived, so it is what the wait is on.
     */
    await screen.findByText("Mailboxes");
    const nav = screen.getByRole("navigation", {
      name: /email setup sections/i,
    });
    expect(nav).toBeInTheDocument();
    for (const label of [
      "My mailbox", "Follow-ups", "Mailboxes", "Secure links",
      "Response times", "Trust & archive", "Send points", "Senders & channels",
    ]) {
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
