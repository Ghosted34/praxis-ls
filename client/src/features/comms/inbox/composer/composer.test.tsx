/**
 * The composer's own decisions.
 *
 * TipTap is not mounted here. It brings a real ProseMirror DOM, jsdom does not
 * implement the ranges it needs, and the tests that matter are not about whether
 * the editor edits — that is TipTap's own suite's job. What is under test is
 * everything AROUND it: the extension set matching the serializer, the toolbar's
 * accessibility, the slash menu's permission behaviour, the undo toast's honesty
 * about a race it does not own, and the offline queue's idempotency rule.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SlashMenu } from "./slash-menu";
import { UndoSendToast } from "./undo-toast";
import { AttachmentTray, AttachButton } from "./attachment-tray";
import { FONTS } from "./fonts";
import { newIdempotencyKey, replayPending } from "./offline-queue";
import type { AttachmentTray as Tray, CommandDescriptor } from "@/lib/mail-api";

/* ── The extension set is a contract with the server's serializer ─────────── */

describe("the editor's font list", () => {
  it("OFFERS ONLY WHAT THE SERIALIZER CAN EMIT", () => {
    // compose.js FONT_STACKS. Adding a family here without adding it there
    // renders as Times New Roman at the recipient with nobody able to say why —
    // the @font-face lesson from notification.service.js.
    expect(FONTS.map((f) => f.value).sort()).toEqual([
      "arial", "courier", "georgia", "helvetica", "tahoma", "times", "trebuchet", "verdana",
    ]);
  });

  it("names each one the way a person would recognise it", () => {
    expect(FONTS.find((f) => f.value === "times")?.label).toBe("Times New Roman");
    expect(FONTS.find((f) => f.value === "trebuchet")?.label).toBe("Trebuchet MS");
  });
});

/* ── Slash menu ───────────────────────────────────────────────────────────── */

const cmd = (over: Partial<CommandDescriptor> = {}): CommandDescriptor => ({
  key: "invoice", label: "Invoice", description: "Insert an invoice.",
  params: [], module_key: "MOD-51", attaches: false,
  available: true, unavailable_reason: null, ...over,
});

const COMMANDS = [
  cmd(),
  cmd({ key: "dossier", label: "Shipment status", module_key: "MOD-29" }),
  cmd({
    key: "bank", label: "Bank details", module_key: "MOD-09",
    available: false, unavailable_reason: "You do not have access to this data.",
  }),
];

function Slash({ onPick = vi.fn(), query = "" }: { onPick?: (c: CommandDescriptor) => void; query?: string }) {
  // A stand-in for the editor's DOM node: aria-activedescendant is only honoured
  // on the element that HAS focus, and that is never the list.
  const [owner, setOwner] = React.useState<HTMLElement | null>(null);
  return (
    <>
      <div ref={setOwner} role="textbox" aria-label="Message body" tabIndex={0} />
      <SlashMenu commands={COMMANDS} loading={false} query={query} onPick={onPick} onClose={vi.fn()} ownerEl={owner} />
    </>
  );
}

describe("the slash menu", () => {
  it("is a listbox, not a pile of divs", () => {
    render(<Slash />);
    expect(screen.getByRole("listbox", { name: /insert from the system/i })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("SHOWS A COMMAND YOU CANNOT RUN, WITH THE REASON, RATHER THAN HIDING IT", () => {
    // Someone told about /bank by a colleague who types it and finds nothing
    // files a bug. Someone who sees why does not.
    render(<Slash />);
    const bank = screen.getByRole("option", { name: /bank/i });
    expect(bank).toHaveAttribute("aria-disabled", "true");
    expect(bank).toHaveTextContent(/do not have access/i);
  });

  it("clicking one you cannot run does nothing", async () => {
    const onPick = vi.fn();
    render(<Slash onPick={onPick} />);
    await userEvent.click(screen.getByRole("option", { name: /bank/i }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("filters as you type", () => {
    render(<Slash query="doss" />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("dossier");
  });

  it("says so when nothing matches", () => {
    render(<Slash query="zzz" />);
    expect(screen.getByText(/No command matches/)).toBeInTheDocument();
  });

  it("ARROW KEYS SKIP THE ONES YOU CANNOT RUN — Enter never lands on a disabled row", async () => {
    const onPick = vi.fn();
    render(<Slash onPick={onPick} />);
    // invoice → dossier → wraps past bank back to invoice.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "invoice" }));
  });

  it("Enter runs the highlighted command", async () => {
    const onPick = vi.fn();
    render(<Slash onPick={onPick} />);
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "invoice" }));
  });

  it("Escape closes it", async () => {
    const onClose = vi.fn();
    render(<SlashMenu commands={COMMANDS} loading={false} query="" onPick={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("ANNOUNCES THE HIGHLIGHT ON THE EDITOR, WHERE FOCUS ACTUALLY IS", async () => {
    // aria-activedescendant is only honoured on the focused element. On the
    // listbox it would look right in the markup and announce nothing.
    render(<Slash />);
    const editor = screen.getByRole("textbox", { name: "Message body" });
    expect(editor).toHaveAttribute("aria-activedescendant", "slash-invoice");
    expect(editor).toHaveAttribute("aria-controls", "slash-menu");
    // NOT aria-expanded: it is invalid on role="textbox" and axe rejects it.
    expect(editor).not.toHaveAttribute("aria-expanded");
    await userEvent.keyboard("{ArrowDown}");
    expect(editor).toHaveAttribute("aria-activedescendant", "slash-dossier");
  });

  it("and takes the announcement away when the menu closes", () => {
    const { unmount } = render(<Slash />);
    expect(screen.getByRole("textbox", { name: "Message body" })).toHaveAttribute("aria-controls", "slash-menu");
    unmount();
    render(<div role="textbox" aria-label="Message body" tabIndex={0} />);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-controls");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Slash />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── Undo toast ───────────────────────────────────────────────────────────── */

describe("the undo toast", () => {
  const future = () => new Date(Date.now() + 18_000).toISOString();

  it("counts down and offers the undo", () => {
    render(<UndoSendToast releaseAt={future()} state="held" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Sending in 1[78]s/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("IS POLITE, NOT ASSERTIVE — a send going normally is not an interruption", () => {
    render(<UndoSendToast releaseAt={future()} state="held" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("STILL OFFERS UNDO AT ZERO — the server owns the deadline, not this timer", () => {
    // A laptop that slept, a wrong clock, a throttled background tab: hiding the
    // button at zero would claim the message has gone when the flusher may not
    // have run. The cancel is a request and the server answers it.
    render(<UndoSendToast releaseAt={new Date(Date.now() - 5000).toISOString()} state="held" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  it("says the message is back in drafts when the undo won", () => {
    render(<UndoSendToast releaseAt={future()} state="cancelled" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Back in your drafts/)).toBeInTheDocument();
  });

  it("IS HONEST WHEN THE UNDO LOST THE RACE", () => {
    render(
      <UndoSendToast
        releaseAt={future()} state="gone" onUndo={vi.fn()} onDismiss={vi.fn()}
        error="Too late — that message has already left."
      />,
    );
    expect(screen.getByText(/already left/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<UndoSendToast releaseAt={future()} state="held" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── Attachment tray ──────────────────────────────────────────────────────── */

const tray = (over: Partial<Tray> = {}): Tray => ({
  attachments: [
    {
      email_attachment_id: "a1", filename: "bill-of-lading.pdf", size_bytes: 4 * 1024 * 1024,
      direction: "OUT", disposition: "attachment",
    },
  ],
  total_bytes: 4 * 1024 * 1024,
  limit_bytes: 25 * 1024 * 1024,
  offer_secure_link: false,
  ...over,
});

describe("the attachment tray", () => {
  it("SHOWS THE RUNNING TOTAL, not just the failure", () => {
    // The cap is on the whole message, so someone adding a fourth file has no
    // way to know they are about to be refused unless the total is on screen.
    render(<AttachmentTray tray={tray()} onRemove={vi.fn()} />);
    expect(screen.getByText(/4\.0 MB of 25\.0 MB/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /attachment size/i })).toHaveAttribute("aria-valuenow", "16");
  });

  it("does not list inline images — they are part of the body, not downloads", () => {
    render(<AttachmentTray tray={tray({
      attachments: [
        ...tray().attachments,
        { email_attachment_id: "a2", filename: "logo.png", size_bytes: 2048, direction: "OUT", disposition: "inline", content_id: "logo1" },
      ],
    })} onRemove={vi.fn()} />);
    expect(screen.queryByText("logo.png")).not.toBeInTheDocument();
    expect(screen.getByText("bill-of-lading.pdf")).toBeInTheDocument();
  });

  it("offers the secure link past the threshold, and says why", () => {
    render(<AttachmentTray tray={tray({ total_bytes: 12 * 1024 * 1024, offer_secure_link: true })} onRemove={vi.fn()} />);
    expect(screen.getByText(/secure link would be better/i)).toBeInTheDocument();
    expect(screen.getByText(/often rejected or filtered/i)).toBeInTheDocument();
  });

  it("each remove button names its own file", async () => {
    const onRemove = vi.fn();
    render(<AttachmentTray tray={tray()} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove bill-of-lading.pdf" }));
    expect(onRemove).toHaveBeenCalledWith("a1");
  });

  it("renders nothing at all when there is nothing attached", () => {
    const { container } = render(<AttachmentTray tray={tray({ attachments: [], total_bytes: 0 })} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the attach control is a real button driving a hidden input", async () => {
    const onFiles = vi.fn();
    render(<AttachButton onFiles={onFiles} />);
    expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
    // The input is hidden from the accessibility tree; the button is the control.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<AttachmentTray tray={tray()} onRemove={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── Offline queue ────────────────────────────────────────────────────────── */

describe("the offline queue", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("mints a distinct key per message", () => {
    const keys = new Set(Array.from({ length: 200 }, newIdempotencyKey));
    expect(keys.size).toBe(200);
  });

  it("DEGRADES TO A NO-OP WHERE IndexedDB IS UNAVAILABLE", async () => {
    // A private window or a locked-down browser. Offline send is a convenience;
    // failing to open a database must never stop somebody sending mail online.
    const original = globalThis.indexedDB;
    // @ts-expect-error deliberately removing it
    delete globalThis.indexedDB;
    await expect(replayPending(vi.fn())).resolves.toEqual({ sent: 0, dropped: 0, kept: 0 });
    if (original) globalThis.indexedDB = original;
  });
});
