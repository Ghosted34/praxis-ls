import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TeamChatPage } from "./team-chat";

const fixture = vi.hoisted(() => ({
  channel: { group_id: "one", name: "Operations", kind: "DIRECT", unread: 0 },
  messages: [{ message_id: "m1", body: "Hello" }],
}));
vi.mock("@/app/auth/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/comms-socket", () => ({ useCommsChannel: () => ({ setTyping: vi.fn() }) }));
vi.mock("@/lib/smartcomm-api", () => ({
  listChannels: () => [fixture.channel], listColleagues: () => [],
  getChannel: () => fixture.channel, getThread: () => ({ messages: fixture.messages }),
  markRead: () => Promise.resolve(),
}));
vi.mock("@/lib/use-resource", () => ({
  useResource: (load: () => unknown) => ({ data: load(), loading: false, reload: vi.fn() }),
  errMsg: String,
}));
vi.mock("./inbox/composer/new-message", () => ({ NewMessageDialog: () => null }));
vi.mock("./chat/composer", () => ({ Composer: () => <div>Message composer</div> }));
vi.mock("./chat/forward-dialog", () => ({ ForwardDialog: () => null }));
vi.mock("./chat/message-bubble", () => ({ MessageBubble: ({ message }: { message: { body: string } }) => <div>{message.body}</div> }));
const chat = () => <MemoryRouter initialEntries={["/comms?channel=one"]}><TeamChatPage /></MemoryRouter>;

beforeEach(() => {
  localStorage.clear();
  fixture.messages = [{ message_id: "m1", body: "Hello" }];
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("chat containment and information panel", () => {
  it("defaults open and remembers a collapsed desktop pane on remount", () => {
    const view = render(chat());
    fireEvent.click(screen.getByRole("button", { name: "Hide info" }));
    expect(screen.getByRole("button", { name: "Show info" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("comms:info-open")).toBe("false");
    view.unmount();
    render(chat());
    expect(screen.getByRole("button", { name: "Show info" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a right-edge dialog without replacing the thread, closes with Escape", async () => {
    render(chat());
    const composer = screen.getByText("Message composer");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByRole("dialog", { name: "Conversation info" })).toHaveClass("right-0", "h-dvh");
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
