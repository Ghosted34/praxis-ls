import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { TeamChatPage } from "./team-chat";

const fixture = vi.hoisted(() => ({
  channel: { group_id: "one", name: "Operations", kind: "DIRECT", unread: 0 },
  messages: [{ message_id: "m1", body: "Hello" }],
  /**
   * The preview map the server attaches to a thread response. `undefined` is a
   * state of its own: it is what an older server (or a switched-off feature)
   * sends, and the bubbles must then render plain links rather than cards.
   */
  // Typed because the fixture is shared with the mock above and `undefined` alone
  // would make every assignment below a type error.
  links: undefined as undefined | Record<string, { state: string; title?: string }>,
  /** PR-6 (F10): what the calls UI may offer this person. */
  caps: { calls: true, can_dial: true, recording: false, settings_admin: false },
}));
vi.mock("@/app/auth/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/comms-socket", () => ({
  useCommsChannel: () => ({ setTyping: vi.fn() }),
  getCommsSocket: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));
vi.mock("@/lib/smartcomm-api", () => ({
  listChannels: () => [fixture.channel], listColleagues: () => [],
  getChannel: () => fixture.channel, getThread: () => ({ messages: fixture.messages, links: fixture.links }),
  markRead: () => Promise.resolve(),
  fetchCallCapabilities: async () => fixture.caps,
  fetchCallProcessing: async () => ({ recording_enabled: false, transcription: [], summary: [], network: [] }),
}));
vi.mock("@/lib/use-resource", () => ({
  useResource: (load: () => unknown) => ({ data: load(), loading: false, reload: vi.fn() }),
  errMsg: String,
}));
vi.mock("./inbox/composer/new-message", () => ({ NewMessageDialog: () => null }));
vi.mock("./chat/composer", () => ({ Composer: () => <div>Message composer</div> }));
vi.mock("./chat/forward-dialog", () => ({ ForwardDialog: () => null }));
// The thread reads the tenant's hero image for its backdrop; with no provider in
// this harness, a null branding falls back to the default static wash.
vi.mock("@/app/branding/branding-context", () => ({ useBranding: () => ({ branding: null }) }));
// The appearance control (beside "New") toasts on wallpaper changes; there is no
// ToastProvider in this isolated render, so stub the hook.
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }),
}));
/**
 * The bubble as a contract, not a rendering.
 *
 * It keeps the shape the tests above lean on — the message body is the bubble's
 * only text, so `getByText("Hello").parentElement` is still the scroll pane — and
 * adds the two things the page is responsible for: which row is open, and the
 * preview map handed down. `onPointerDown` is wired to the toggle so the parent's
 * ownership is exercised through the same event the real gesture uses, with the
 * bubble still bubbling it up to the scroller.
 */
vi.mock("./chat/message-bubble", () => ({
  MessageBubble: ({ message, revealed, onToggleReveal, links }: any) => (
    <div
      data-message-bubble
      data-revealed={revealed ? "true" : undefined}
      data-links={links ? Object.keys(links).join(",") : ""}
      onPointerDown={onToggleReveal}
    >
      {message.body}
    </div>
  ),
}));
const chat = () => <MemoryRouter initialEntries={["/comms?channel=one"]}><TeamChatPage /></MemoryRouter>;

beforeEach(async () => {
  (await import("./call/call-capabilities")).resetCallCapabilities();
  fixture.caps = { calls: true, can_dial: true, recording: false, settings_admin: false };
  localStorage.clear();
  fixture.messages = [{ message_id: "m1", body: "Hello" }];
  fixture.links = undefined;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("the phone icon is offered only where it works (audit F10)", () => {
  it("shows when calls are on and this person may dial", async () => {
    render(chat());
    expect(await screen.findByRole("button", { name: "Start a voice call" })).toBeInTheDocument();
  });

  it("is absent when calls are off for the tenant or the person may not dial", async () => {
    fixture.caps = { calls: false, can_dial: false, recording: false, settings_admin: false };
    render(chat());
    await waitFor(() => expect(screen.getByText("Message composer")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Start a voice call" })).not.toBeInTheDocument();
  });
});

describe("chat containment and information panel", () => {
  it("toggles and remembers the desktop info pane from the ⋮ menu", async () => {
    // Desktop: the "Conversation info" item toggles the persistent side pane.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const user = userEvent.setup();
    const view = render(chat());
    expect(localStorage.getItem("comms:info-open")).toBeNull(); // default open
    await user.click(screen.getByRole("button", { name: "Conversation menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Conversation info" }));
    expect(localStorage.getItem("comms:info-open")).toBe("false");
    view.unmount();
    render(chat());
    expect(localStorage.getItem("comms:info-open")).toBe("false");
  });

  it("opens a right-edge dialog from the ⋮ menu on a phone, closes with Escape", async () => {
    // matchMedia defaults to matches:false (phone) from beforeEach, so the same
    // menu item opens the drawer rather than toggling the side pane.
    const user = userEvent.setup();
    render(chat());
    const composer = screen.getByText("Message composer");
    await user.click(screen.getByRole("button", { name: "Conversation menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Conversation info" }));
    expect(await screen.findByRole("dialog", { name: "Conversation info" })).toHaveClass("right-0", "h-dvh");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Message composer")).toBe(composer);
    expect(localStorage.getItem("comms:info-open")).toBeNull();
  });

  it("scrolls only the message pane, following new messages unless reading history", () => {
    const outerScroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const view = render(chat());
    const pane = screen.getByText("Hello").parentElement!;
    expect(pane).toHaveClass("min-h-0", "overflow-y-auto");
    Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } });
    fixture.messages = [...fixture.messages, { message_id: "m2", body: "New" }];
    view.rerender(chat());
    expect(pane.scrollTop).toBe(1000);
    pane.scrollTop = 100;
    fireEvent.scroll(pane);
    fixture.messages = [...fixture.messages, { message_id: "m3", body: "Later" }];
    view.rerender(chat());
    expect(pane.scrollTop).toBe(100);
    expect(outerScroll).not.toHaveBeenCalled();
    outerScroll.mockRestore();
  });
});

/**
 * Who owns the open reaction rail.
 *
 * The bubble decides what a tap MEANS (message-bubble.test); the page decides
 * which message is allowed to be open — one at a time, and no longer than it is
 * useful. These are parent-side properties, and they are invisible from inside a
 * single bubble: with each bubble keeping its own state, fifty rows can be open at
 * once, which is the original complaint wearing a new hat.
 */
describe("the revealed message, owned by the page", () => {
  const two = () => {
    fixture.messages = [
      { message_id: "m1", body: "Hello" },
      { message_id: "m2", body: "Second" },
    ];
  };
  const rows = () => Array.from(document.querySelectorAll("[data-message-bubble]"));
  const openRows = () => rows().filter((r) => r.getAttribute("data-revealed") === "true");

  it("opens the message that was touched, and only that one", () => {
    two();
    render(chat());
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows().map((r) => r.textContent)).toEqual(["Hello"]);
    fireEvent.pointerDown(screen.getByText("Second"));
    // Moving the open rail is the whole point of one-at-a-time: the first row must
    // close as the second opens, not linger.
    expect(openRows().map((r) => r.textContent)).toEqual(["Second"]);
  });

  it("closes the same message when it is touched again", () => {
    render(chat());
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(0);
  });

  it("a touch on the thread background closes it, but a touch on a row does not", () => {
    two();
    render(chat());
    const pane = screen.getByText("Hello").parentElement!;
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    // The load-bearing half: the pointer event from a bubble reaches this handler
    // too, because events bubble. An ancestor that cleared unconditionally would
    // cancel the child in the same tick and the rail would never appear — a bug
    // invisible to any test that only checks the background.
    fireEvent.pointerDown(screen.getByText("Hello"));
    fireEvent.pointerDown(pane);
    expect(openRows()).toHaveLength(0);
  });

  it("Escape closes it", () => {
    render(chat());
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(openRows()).toHaveLength(0);
  });

  it("hands the cached previews down, and hands nothing down when the server sent none", () => {
    fixture.links = { "https://maersk.com/vessel/1": { state: "OK", title: "Vessel tracking" } };
    render(chat());
    expect(rows()[0]).toHaveAttribute("data-links", "https://maersk.com/vessel/1");
  });

  it("an old server with no previews still renders the thread", () => {
    render(chat());
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(rows()[0]).toHaveAttribute("data-links", "");
  });

  it("switching threads closes it, because the open row is gone", () => {
    /**
     * Navigation, not a new router. `initialEntries` is read once at mount, so
     * re-rendering with a different one changes nothing and would leave this test
     * passing for the wrong reason; a real link keeps TeamChatPage mounted and
     * moves only the query, which is what picking another channel in the sidebar
     * actually does.
     */
    const GoToSecondThread = () => {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/comms?channel=two")}>
          other thread
        </button>
      );
    };
    render(
      <MemoryRouter initialEntries={["/comms?channel=one"]}>
        <GoToSecondThread />
        <TeamChatPage />
      </MemoryRouter>,
    );
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    fireEvent.click(screen.getByText("other thread"));
    // The other thread is mocked to carry the same message id, which is exactly
    // why this test matters: without the reset on `channelId`, that id would
    // still be "the open one" in a thread the reader never touched.
    expect(openRows()).toHaveLength(0);
  });
});
