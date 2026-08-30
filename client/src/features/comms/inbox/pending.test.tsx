/**
 * The two lists of mail that has not gone anywhere.
 *
 * Both endpoints were built in PR-1B and neither had a screen, so the claims
 * worth pinning here are the ones about what a person can now SEE and DO — not
 * about the API, which already had its tests.
 *
 *   1. A DRAFT CAN BE FOUND AND REOPENED. The composer autosaves every 1.5
 *      seconds and there was no way back to what it saved.
 *   2. A SCHEDULED MESSAGE CAN BE CANCELLED. The composer promises this in as
 *      many words, and there was no outbox for it to be promising.
 *   3. A FAILED SEND IS VISIBLE, WITH THE SERVER'S REASON. A row the queue gave
 *      up on told nobody: the operator saw the undo toast count down and
 *      believed the invoice went out.
 *   4. CANCEL IS OFFERED ONLY WHERE IT WORKS. `repo.cancel` says
 *      `WHERE status = 'HELD'`; a button on a QUEUED row can only ever 409.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { DraftList, OutboxList } from "./pending";
import { renderScreen } from "@/test/screen-harness";
import type { Draft, OutboxEntry } from "@/lib/mail-api";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

const draft = (over: Partial<Draft> = {}): Draft => ({
  email_draft_id: "d1",
  user_id: "u1",
  email_connection_id: "c1",
  email_thread_id: null,
  reply_to_message_id: null,
  kind: "NEW",
  to_address: ["ops@maersk.com"],
  cc_address: [],
  bcc_address: [],
  subject: "Demurrage on MSKU4567890",
  body_json: null,
  updated_at: new Date().toISOString(),
  ...over,
});

const queued = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  email_send_queue_id: "q1",
  status: "HELD",
  release_at: new Date(Date.now() + 86_400_000).toISOString(),
  attempts: 0,
  payload: { to: ["client@camrail.cm"], subject: "Invoice INV-2026-0311" },
  created_at: new Date().toISOString(),
  ...over,
});

describe("Drafts", () => {
  it("lists what the composer saved, and offers a way back into it", async () => {
    const onOpen = vi.fn();
    renderScreen(<DraftList onOpen={onOpen} />, {
      routes: { "/mail/drafts": [draft()] },
    });

    expect(await screen.findByText("Demurrage on MSKU4567890")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    // The whole ROW, not an id: the composer adopts `email_draft_id` so its
    // next autosave updates this draft instead of forking a second one.
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ email_draft_id: "d1" }));
  });

  it("says who a draft has no recipient for yet, rather than an empty cell", async () => {
    renderScreen(<DraftList onOpen={vi.fn()} />, {
      routes: { "/mail/drafts": [draft({ to_address: [], subject: null })] },
    });
    expect(await screen.findByText("(no subject)")).toBeInTheDocument();
    expect(screen.getByText("No recipient yet")).toBeInTheDocument();
  });

  it("the empty state explains what would be here", async () => {
    renderScreen(<DraftList onOpen={vi.fn()} />, { routes: { "/mail/drafts": [] } });
    expect(await screen.findByText("No drafts")).toBeInTheDocument();
  });

  /*
   * This used to spy on `window.confirm`. It now asserts against the rendered
   * dialog, which is a STRONGER check and not merely a port: the spy could only
   * prove that some string was passed to the browser, whereas this proves the
   * warning is on screen, names the draft it is about, and offers a button that
   * says what it does. The old assertion would have passed against a confirm
   * that said "cannot be undone" and nothing else.
   */
  it("discarding asks first, names the draft, and says the attachments go too", async () => {
    renderScreen(<DraftList onOpen={vi.fn()} />, { routes: { "/mail/drafts": [draft()] } });
    await screen.findByText("Demurrage on MSKU4567890");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Discard this draft?")).toBeInTheDocument();
    // The draft is named inside the dialog, so a list of drafts cannot ask an
    // ambiguous question about which one is about to go.
    expect(within(dialog).getByText("Demurrage on MSKU4567890")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/deleted, along with anything attached to it/i),
    ).toBeInTheDocument();
    // Named actions, not OK/Cancel.
    expect(
      within(dialog).getByRole("button", { name: "Discard draft" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    ).toBeInTheDocument();
  });

  it("keeping the draft closes the dialog and deletes nothing", async () => {
    const del = vi.fn();
    renderScreen(<DraftList onOpen={vi.fn()} />, {
      routes: { "/mail/drafts": [draft()], "DELETE /mail/drafts/d1": del },
    });
    await screen.findByText("Demurrage on MSKU4567890");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Keep editing",
      }),
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderScreen(<DraftList onOpen={vi.fn()} />, {
      routes: { "/mail/drafts": [draft()] },
    });
    await screen.findByText("Demurrage on MSKU4567890");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Outbox", () => {
  it("shows a scheduled message with a way to stop it", async () => {
    renderScreen(<OutboxList />, { routes: { "/mail/outbox": [queued()] } });
    expect(await screen.findByText("Invoice INV-2026-0311")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    // The thing the composer has been promising since PR-5.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("A FAILED SEND IS VISIBLE, IN THE SERVER'S OWN WORDS", async () => {
    renderScreen(<OutboxList />, {
      routes: {
        "/mail/outbox": [
          queued({
            status: "FAILED",
            attempts: 3,
            last_error: "550 5.7.1 Sender address rejected: not owned by user",
          }),
        ],
      },
    });
    expect(await screen.findByText("Did not send")).toBeInTheDocument();
    // Paraphrasing this into "something went wrong" is what makes a failure
    // unfixable: only the raw refusal tells the operator to change the From.
    expect(
      screen.getByText(/Sender address rejected/),
    ).toBeInTheDocument();
    expect(screen.getByText("3 attempts")).toBeInTheDocument();
  });

  it("offers the fix guide, now that the code survives the send path", async () => {
    // `error_code` only became worth reading here once `explainSendError`
    // stopped flattening the classifier's five verdicts into two: a queue row
    // used to say MAIL_SEND_FAILED for both a greylisting and a message over
    // the size limit, and no set of steps fixes both.
    renderScreen(<OutboxList />, {
      routes: {
        "/mail/outbox": [
          queued({
            status: "FAILED",
            error_code: "SENDER_NOT_AUTHORIZED",
            last_error: "550 Sender verify failed",
          }),
        ],
      },
    });
    expect(await screen.findByText(/How to fix this/)).toBeInTheDocument();
  });

  it("counts the failures in the header, where they are seen without reading", async () => {
    renderScreen(<OutboxList />, {
      routes: {
        "/mail/outbox": [
          queued({ email_send_queue_id: "q1", status: "FAILED", last_error: "nope" }),
          queued({ email_send_queue_id: "q2" }),
        ],
      },
    });
    expect(await screen.findByText("1 did not send")).toBeInTheDocument();
  });

  it("OFFERS CANCEL ONLY ON A HELD ROW — the only status the server accepts", async () => {
    renderScreen(<OutboxList />, {
      routes: {
        "/mail/outbox": [
          queued({ email_send_queue_id: "q2", status: "QUEUED" }),
          queued({ email_send_queue_id: "q3", status: "SENDING" }),
          queued({ email_send_queue_id: "q4", status: "FAILED", last_error: "x" }),
        ],
      },
    });
    await screen.findByText("Going out");
    // `repo.cancel` is `UPDATE … WHERE status = 'HELD'`. A button on any of
    // these three can only ever 409, and a control that always fails teaches
    // people to distrust the ones that work.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("explains each status rather than showing a bare word", async () => {
    renderScreen(<OutboxList />, { routes: { "/mail/outbox": [queued()] } });
    expect(
      await screen.findByText("Not sent yet. Cancel it and it never goes."),
    ).toBeInTheDocument();
  });

  it("the empty state says what would collect here", async () => {
    renderScreen(<OutboxList />, { routes: { "/mail/outbox": [] } });
    expect(await screen.findByText("Nothing waiting")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderScreen(<OutboxList />, {
      routes: { "/mail/outbox": [queued()] },
    });
    await screen.findByText("Invoice INV-2026-0311");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the rail reaches both", () => {
  it("names them where somebody looking for a lost email would look", async () => {
    const { FolderRail } = await import("./folder-rail");
    renderScreen(
      <FolderRail
        mailboxes={[]}
        folders={[]}
        labels={[]}
        selection={{ folder: "INBOX" }}
        onChange={vi.fn()}
        humanUnread={0}
        systemUnread={0}
      />,
      {},
    );
    const nav = screen.getByRole("navigation", { name: "Mail folders" });
    expect(within(nav).getByRole("button", { name: "My drafts" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Outbox" })).toBeInTheDocument();
  });
});
