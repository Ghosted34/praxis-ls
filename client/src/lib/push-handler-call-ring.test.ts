/**
 * The ring in the service worker (calls audit A7, A8, A14; PR-4 steps 5–7).
 * The real worker script runs in a sandbox with a fake `self`: its actual
 * behaviour, not a text match.
 *
 *   - a ring shows a sticky, vibrating notification with Answer/Decline, or
 *     is handed to a visible page instead (no duplicate over the in-app ring);
 *   - a cancel REPLACES the ring in place with a quiet line (a push that shows
 *     nothing breaks the user-visible rule; Safari revokes for it);
 *   - Answer/Decline act in an open window without reloading it, or open the
 *     app with the intent; an expired ring opens the conversation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vm from "node:vm";

const source = readFileSync(join(__dirname, "../../public/push-handler.js"), "utf8");

const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

type Note = { title: string; options: Record<string, unknown> & { data?: Record<string, unknown>; tag?: string }; closed: boolean };
type Client = {
  visibilityState: string;
  focused: boolean;
  messages: unknown[];
  focusCalls: number;
  navigated: string[];
  postMessage: (m: unknown) => void;
  focus: () => Promise<Client>;
  navigate: (u: string) => Promise<Client>;
};

function client(visible: boolean): Client {
  const c: Client = {
    visibilityState: visible ? "visible" : "hidden",
    focused: visible,
    messages: [],
    focusCalls: 0,
    navigated: [],
    postMessage: (m) => c.messages.push(m),
    focus: async () => {
      c.focusCalls += 1;
      return c;
    },
    navigate: async (u) => {
      c.navigated.push(u);
      return c;
    },
  };
  return c;
}

function worker({ language = "en-GB", userAgent = CHROME, clients = [] as Client[] } = {}) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const notes: Note[] = [];
  const opened: string[] = [];
  const self = {
    navigator: { language, userAgent },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
    registration: {
      showNotification: async (title: string, options: Note["options"]) => {
        // Same tag replaces, as the platform does.
        for (const n of notes) if (options.tag && n.options.tag === options.tag) n.closed = true;
        notes.push({ title, options, closed: false });
      },
      getNotifications: async (filter: { tag?: string } = {}) =>
        notes
          .filter((n) => !n.closed && (!filter.tag || n.options.tag === filter.tag))
          .map((n) => ({ ...n, data: n.options.data, tag: n.options.tag, close: () => { n.closed = true; } })),
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
  vm.runInNewContext(source, { self, console, Promise, Intl, Date, URL, URLSearchParams, indexedDB: undefined });

  async function push(payload: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    listeners.push({
      data: { json: () => payload, text: () => JSON.stringify(payload) },
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
  }
  async function click(note: Note, action = "") {
    let done: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({
      action,
      notification: { data: note.options.data, close: () => { note.closed = true; } },
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
  }
  return { push, click, notes, opened, clients, shown: () => notes.filter((n) => !n.closed) };
}

const CALL = "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44";
const GROUP = "5d0c1f7e-1b1d-4a39-8f0e-2b6c3d9e4f10";

function ring(over: Record<string, unknown> = {}) {
  return {
    title: "Bruno Kamga",
    body: "Incoming call",
    url: `/comms?ring=${CALL}`,
    tag: `call:${CALL}`,
    renotify: true,
    requireInteraction: true,
    vibrate: [600, 250, 600, 250, 600],
    actions: [{ action: "accept", title: "Accept" }, { action: "decline", title: "Decline" }],
    data: {
      kind: "call_ring",
      call_id: CALL,
      group_id: GROUP,
      caller_name: "Bruno Kamga",
      expires_at: new Date(Date.now() + 45_000).toISOString(),
      ...over,
    },
  };
}

function cancel(outcome: string) {
  return {
    title: "Call ended",
    body: "",
    url: `/comms?channel=${GROUP}`,
    tag: `call:${CALL}`,
    data: { kind: "call_cancel", call_id: CALL, group_id: GROUP, outcome, caller_name: "Bruno Kamga" },
  };
}

describe("a ring push (A14, step 5)", () => {
  it("with no app on screen: a sticky, vibrating notification with Answer and Decline", async () => {
    const w = worker({ language: "fr-FR" });
    await w.push(ring());
    const [n] = w.shown();
    expect(n.title).toBe("Bruno Kamga");
    expect(n.options).toMatchObject({
      body: "Appel entrant",
      tag: `call:${CALL}`,
      requireInteraction: true,
      renotify: true,
      vibrate: [600, 250, 600, 250, 600],
    });
    expect((n.options.actions as Array<{ action: string; title: string }>).map((a) => `${a.action}:${a.title}`))
      .toEqual(["accept:Répondre", "decline:Refuser"]);
    expect(n.options.data).toMatchObject({ kind: "call_ring", call_id: CALL });
  });

  it("with the app on screen: handed to the page, and no notification on top of the in-app ring", async () => {
    const page = client(true);
    const w = worker({ clients: [page] });
    await w.push(ring());
    expect(w.shown()).toEqual([]);
    expect(page.messages).toEqual([{ type: "praxis:call-ring", data: expect.objectContaining({ call_id: CALL }) }]);
  });

  it("on an iPhone app it still shows the notification: Safari revokes pushes that show nothing", async () => {
    const page = client(true);
    const w = worker({ userAgent: IPHONE_APP, clients: [page] });
    await w.push(ring());
    expect(w.shown()).toHaveLength(1);
    expect(page.messages).toHaveLength(1);
  });

  it("a hidden tab is told too, and the notification shows", async () => {
    const page = client(false);
    const w = worker({ clients: [page] });
    await w.push(ring());
    expect(w.shown()).toHaveLength(1);
    expect(page.messages).toHaveLength(1);
  });

  it("a ring that arrives after its window says missed, not Answer", async () => {
    const w = worker();
    await w.push(ring({ expires_at: new Date(Date.now() - 1_000).toISOString() }));
    const [n] = w.shown();
    expect(n.title).toBe("Missed call — Bruno Kamga");
    expect(n.options.requireInteraction).toBe(false);
    expect(n.options.actions).toBeUndefined();
  });

  it("any push closes a ring notification whose window has passed (A7)", async () => {
    const w = worker();
    await w.push(ring({ expires_at: new Date(Date.now() + 5).toISOString() }));
    expect(w.shown()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 10));
    await w.push({ title: "Invoice approved", body: "INV-12", url: "/finance" });
    expect(w.shown().map((n) => n.title)).toEqual(["Invoice approved"]);
  });
});

describe("a cancel push (A7, step 6)", () => {
  it("answered elsewhere replaces the ring in place with a quiet, non-sticky line", async () => {
    const w = worker();
    await w.push(ring());
    await w.push(cancel("answered"));
    const shown = w.shown();
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Answered on another device");
    expect(shown[0].options).toMatchObject({ tag: `call:${CALL}`, requireInteraction: false, silent: true });
    expect(shown[0].options.actions).toBeUndefined();
    expect(shown[0].options.data).toMatchObject({ url: `/comms?channel=${GROUP}`, kind: "call_cancel" });
  });

  it("missed names the caller, in the device's language", async () => {
    const w = worker({ language: "fr" });
    await w.push(ring());
    await w.push(cancel("missed"));
    expect(w.shown()[0].title).toBe("Appel manqué — Bruno Kamga");
  });

  it("declined and ended read as ended", async () => {
    const w = worker();
    await w.push(cancel("declined"));
    expect(w.shown()[0].title).toBe("Call ended");
  });

  it("with the app on screen: the ring is closed and the page is told; nothing new is shown", async () => {
    const page = client(false);
    const w = worker({ clients: [page] });
    await w.push(ring());
    page.visibilityState = "visible";
    page.focused = true;
    await w.push(cancel("answered"));
    expect(w.shown()).toEqual([]);
    expect(page.messages.at(-1)).toEqual({ type: "praxis:call-cancel", data: expect.objectContaining({ outcome: "answered" }) });
  });

  it("a ring push that arrives AFTER its cancel (the two sends raced) does not bring the ring back", async () => {
    const w = worker();
    await w.push(cancel("missed"));
    await w.push(ring());
    const shown = w.shown();
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Missed call — Bruno Kamga");
    expect(shown[0].options.requireInteraction).toBe(false);
  });

  it("on an iPhone app with the app on screen it still shows a line (it answered here, so it says so)", async () => {
    const page = client(true);
    const w = worker({ userAgent: IPHONE_APP, clients: [page] });
    await w.push(cancel("answered"));
    expect(w.shown().map((n) => n.title)).toEqual(["Call answered"]);
  });
});

describe("Answer and Decline on the notification (A8, step 7)", () => {
  it("with a window open: focus it and hand over the intent — no reload, so no call is dropped", async () => {
    const page = client(false);
    const w = worker({ clients: [page] });
    await w.push(ring());
    await w.click(w.shown()[0], "accept");
    expect(page.focusCalls).toBe(1);
    expect(page.navigated).toEqual([]);
    expect(page.messages.at(-1)).toEqual({ type: "praxis:call-action", call_id: CALL, act: "accept" });
    expect(w.opened).toEqual([]);
  });

  it("Decline with no window opens the app with the intent", async () => {
    const w = worker();
    await w.push(ring());
    await w.click(w.shown()[0], "decline");
    expect(w.opened).toEqual([`/comms?ring=${CALL}&act=decline`]);
  });

  it("a tap on the body opens the ring without an action", async () => {
    const w = worker();
    await w.push(ring());
    await w.click(w.shown()[0]);
    expect(w.opened).toEqual([`/comms?ring=${CALL}`]);
  });

  it("an expired ring, tapped, opens the call's conversation instead", async () => {
    const w = worker();
    await w.push(ring());
    const [n] = w.shown();
    (n.options.data as Record<string, unknown>).expires_at = new Date(Date.now() - 1_000).toISOString();
    await w.click(n, "accept");
    expect(w.opened).toEqual([`/comms?channel=${GROUP}`]);
  });

  it("an expired ring with a window open: the page navigates itself, no reload", async () => {
    const page = client(false);
    const w = worker({ clients: [page] });
    await w.push(ring({ expires_at: new Date(Date.now() - 1_000).toISOString() }));
    await w.click(w.shown()[0]);
    expect(page.navigated).toEqual([]);
    expect(page.messages.at(-1)).toEqual({ type: "praxis:navigate", url: `/comms?channel=${GROUP}` });
  });
});

describe("a test ring (A15)", () => {
  it("always shows (the point is to see it) and tells an open page it arrived", async () => {
    const page = client(true);
    const w = worker({ language: "fr", clients: [page] });
    await w.push({ title: "Test ring", body: "", url: "/settings/calls", tag: "call:test", data: { kind: "call_test" } });
    const [n] = w.shown();
    expect(n.title).toBe("Sonnerie de test");
    expect(n.options).toMatchObject({ tag: "call:test", vibrate: [600, 250, 600, 250, 600] });
    expect(page.messages).toEqual([{ type: "praxis:call-test" }]);
  });
});
