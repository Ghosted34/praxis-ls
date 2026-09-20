/**
 * The reaction rail on a touch device: it exists, and it is not visible.
 *
 * The complaint this answers is that "every message carries the emoji bar" on a
 * phone, which reads as a strip of controls on every row of a thread. Three
 * properties have to hold at once, and each is a separate test:
 *
 *   1. the rail is closed until the reader touches THAT message;
 *   2. a touch that travels is a scroll, not a request to reveal;
 *   3. a mouse changes nothing here at all — desktop keeps doing it with hover,
 *      which lives in CSS (`group-hover:opacity-100`) and is deliberately not
 *      replicated in JS, because a JS mouse path would fight the CSS one.
 *
 * jsdom has no hover and no `@media`, so these tests assert the STATE the gesture
 * produces (the `data-revealed` marker on the row) rather than a computed opacity
 * — the CSS half is a class list, and a test that parses a class list breaks when
 * somebody tidies it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MessageBubble } from "./message-bubble";
import type { CommMessage } from "@/lib/smartcomm-api";

vi.mock("@/lib/smartcomm-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/smartcomm-api")>()),
  linkImageObjectUrl: vi.fn().mockResolvedValue("blob:preview"),
}));

// The bubble toasts on star/pin/edit failures; this file is not testing that, and
// mounting the provider here would pull the toast stack into a gesture test.
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const message = (over: Partial<CommMessage> = {}): CommMessage =>
  ({
    message_id: "m1",
    body: "look https://maersk.com/vessel/1",
    sender_type: "USER",
    sender_id: "u1",
    sender_name: "Aminata",
    created_at: "2026-09-01T08:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    delivery_id: null,
    delivery_state: null,
    delivery_error: null,
    erp_card: null,
    source: "COMPOSED",
    link_urls: ["https://maersk.com/vessel/1"],
    reactions: [],
    attachments: [],
    reply_to: null,
    me: { read_at: null, starred: false, pinned: false, reaction: null, self: true },
    ...over,
  }) as CommMessage;

type BubbleProps = React.ComponentProps<typeof MessageBubble>;
const bubble = (over: Partial<BubbleProps> = {}) =>
  render(
    <MemoryRouter>
      <MessageBubble
        message={message()}
        mine={false}
        meId="u2"
        onReply={() => undefined}
        onForward={() => undefined}
        onChanged={() => undefined}
        {...over}
      />
    </MemoryRouter>,
  );

const row = () => document.querySelector<HTMLElement>("[data-message-bubble]")!;
/**
 * A PointerEvent, by hand. jsdom has no PointerEvent constructor, and the
 * `pointerType` the component keys off is not part of MouseEventInit — so it is
 * stamped on after construction. Worth the noise: the entire distinction between
 * "a finger" and "a cursor" lives in that one property, and a test that left it
 * undefined would be asserting the behaviour of an event no browser sends.
 */
function pointer(type: string, target: Element, { x = 40, y = 40, pointerType = "touch" }: { x?: number; y?: number; pointerType?: string } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(target, event);
}

const tapTheRow = (opts: { dx?: number; dy?: number; type?: string; on?: Element } = {}) => {
  const target = opts.on ?? row();
  pointer("pointerdown", target, { pointerType: opts.type });
  pointer("pointerup", target, { x: 40 + (opts.dx ?? 0), y: 40 + (opts.dy ?? 0), pointerType: opts.type });
};

beforeEach(() => {
  // The bubble's children (attachments, ERP card) reach for matchMedia through the
  // viewport hooks; every chat test in this folder stubs it for that reason.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("the rail is opened by a touch, and by nothing else", () => {
  it("starts closed", () => {
    bubble();
    // Rendered but closed: the rail keeps its space in the layout on purpose, so
    // revealing one message never reflows the thread under the reader's thumb.
    expect(row()).not.toHaveAttribute("data-revealed");
    expect(row()).toBeInTheDocument();
  });

  it("opens when the parent says this row is the revealed one", () => {
    bubble({ revealed: true });
    expect(row()).toHaveAttribute("data-revealed", "true");
  });

  it("a tap on the row asks for it", () => {
    const onToggleReveal = vi.fn();
    bubble({ onToggleReveal });
    tapTheRow();
    expect(onToggleReveal).toHaveBeenCalledTimes(1);
  });

  it("a flick past the message is not a tap", () => {
    const onToggleReveal = vi.fn();
    bubble({ onToggleReveal });
    tapTheRow({ dy: 220 });
    expect(onToggleReveal).not.toHaveBeenCalled();
  });

  it("a diagonal swipe of a few pixels still counts", () => {
    // The finger slides; a threshold measured only on Y would reject the tap that
    // opens the rail one row below where the reader aimed.
    const onToggleReveal = vi.fn();
    bubble({ onToggleReveal });
    tapTheRow({ dx: 7, dy: 8 });
    expect(onToggleReveal).toHaveBeenCalledTimes(1);
  });

  it("a mouse does not touch this at all", () => {
    const onToggleReveal = vi.fn();
    bubble({ onToggleReveal });
    tapTheRow({ type: "mouse" });
    expect(onToggleReveal).not.toHaveBeenCalled();
  });

  it("a tap that lands on the link inside the message belongs to the link", () => {
    const onToggleReveal = vi.fn();
    bubble({ onToggleReveal });
    const link = screen.getByRole("link", { name: "https://maersk.com/vessel/1" });
    tapTheRow({ on: link });
    expect(onToggleReveal).not.toHaveBeenCalled();
  });

  it("a tap on an already-visible reaction button is the reaction, not a toggle", () => {
    const onToggleReveal = vi.fn();
    bubble({ revealed: true, onToggleReveal });
    // The rail is open in this case, so its buttons are in the tree; a tap on one
    // is a reaction, and the rail must not close out from under the next tap.
    const react = screen.getAllByRole("button").find((b) => b.textContent && b.textContent.trim().length <= 4);
    expect(react).toBeDefined();
    tapTheRow({ on: react! });
    expect(onToggleReveal).not.toHaveBeenCalled();
  });

  it("a row with no toggle wired stays inert", () => {
    bubble();
    expect(() => tapTheRow()).not.toThrow();
    expect(row()).not.toHaveAttribute("data-revealed");
  });

  it("a cancelled touch never reveals", () => {
    // The gesture the browser steals: a long-press menu or an incoming call
    // fires `pointercancel`, and the pending tap must be dropped rather than
    // landing on the next `pointerup` that follows it.
    const onToggleReveal = vi.fn();
    bubble({ onToggleReveal });
    pointer("pointerdown", row());
    fireEvent(row(), new MouseEvent("pointercancel", { bubbles: true }));
    pointer("pointerup", row());
    expect(onToggleReveal).not.toHaveBeenCalled();
  });
});
