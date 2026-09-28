/**
 * The client chat's reply box (client portal PR 3) — the Smart Comms team
 * chat's pattern: a `+` with the tools rather than text links under the box,
 * Enter to send, a microphone while there is nothing to send, and a location
 * that is shown and named before it goes.
 *
 * The recorder itself needs a microphone, so it is stood in for by a button
 * that "records" a clip; everything after the recording is the real panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

type Call = { path: string; method?: string; body?: unknown };
const calls = vi.hoisted(() => [] as Call[]);
const uploads = vi.hoisted(() => [] as { path: string; name: string; type: string; fields?: Record<string, unknown> }[]);
const access = vi.hoisted(() => ({ smartComms: true }));

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      return base.tenant(path);
    },
    uploadFile: async (path: string, file: File, opts?: { fields?: Record<string, unknown> }) => {
      uploads.push({ path, name: file.name, type: file.type, fields: opts?.fields });
      return {};
    },
  };
});
vi.mock("@/lib/route-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/route-access")>("@/lib/route-access");
  return { ...actual, useCanUseModule: (key: string) => (key === "MOD-64" ? access.smartComms : true) };
});
vi.mock("@/features/comms/chat/voice-recorder", () => ({
  VoiceRecorder: ({ onRecorded, disabled }: { onRecorded: (r: unknown) => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onRecorded({ blob: new Blob(["ogg"], { type: "audio/webm" }), durationMs: 4200.4, waveform: [], mimeType: "audio/webm;codecs=opus" })}
    >
      Record a voice note
    </button>
  ),
}));

import { ClientChatPanel } from "./client-chat-panel";

const ROUTES = {
  "/portal/chat/threads": [],
  "/portal/chat/messages": { thread: "general", dossier_ref: null, has_more: false, messages: [] },
  "/smartcomm/quick-replies": [{ quick_reply_id: "q1", label: "Docs received", body: "Thank you, we have your documents." }],
};

const posts = () => calls.filter((c) => c.method === "POST" && c.path === "/portal/chat/messages");
const mount = () => renderScreen(<ClientChatPanel clientId="c1" />, { routes: ROUTES });

beforeEach(() => {
  calls.length = 0;
  uploads.length = 0;
  access.smartComms = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the client chat's reply box", () => {
  it("keeps its tools behind a + rather than text links under the box", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("textbox");
    expect(screen.queryByText("Attach a photo or PDF")).toBeNull();
    expect(screen.queryByText("Paste a file")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add to the reply" }));
    for (const tool of ["Photo or document", "Share a location", "Emoji", "Quick replies"]) {
      expect(await screen.findByRole("button", { name: tool })).toBeInTheDocument();
    }
  });

  it("offers quick replies only to people who hold Smart Comms", async () => {
    access.smartComms = false;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    expect(await screen.findByRole("button", { name: "Share a location" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick replies" })).toBeNull();
  });

  it("puts a quick reply in the box", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    await user.click(await screen.findByRole("button", { name: "Quick replies" }));
    await user.click(await screen.findByText("Docs received"));
    expect(screen.getByRole("textbox")).toHaveValue("Thank you, we have your documents.");
  });

  it("shows a microphone while there is nothing to send, and Send once there is", async () => {
    const user = userEvent.setup();
    mount();
    const box = await screen.findByRole("textbox");
    expect(screen.getByRole("button", { name: "Record a voice note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();

    await user.type(box, "Hello");
    expect(screen.getByRole("button", { name: /Send/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record a voice note" })).toBeNull();
  });

  it("sends with Enter, and Shift+Enter starts a new line", async () => {
    const user = userEvent.setup();
    mount();
    const box = await screen.findByRole("textbox");
    await user.type(box, "Line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("Line one\nline two");
    expect(posts()).toEqual([]);

    await user.type(box, "{Enter}");
    expect(posts()).toEqual([
      { path: "/portal/chat/messages", method: "POST", body: { client_id: "c1", thread: "general", body: "Line one\nline two" } },
    ]);
    expect(box).toHaveValue("");
    // The cursor stays in the box for the next line.
    expect(box).toHaveFocus();
  });

  it("sends a voice note as soon as it is recorded", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Record a voice note" }));
    expect(uploads).toEqual([
      { path: "/tenant/portal/chat/messages", name: "voice-note.webm", type: "audio/webm;codecs=opus", fields: { client_id: "c1", thread: "general", duration_ms: 4200 } },
    ]);
  });

  it("shares a location, shown and named before it goes", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 4.0435, longitude: 9.6966, accuracy: 12 } }),
      },
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    await user.click(await screen.findByRole("button", { name: "Share a location" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("4.04350, 9.69660")).toBeInTheDocument();
    expect(within(dialog).getByText("± 12 m")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Name of the place/), "Warehouse B, gate 3");
    await user.click(within(dialog).getByRole("button", { name: /Send location/ }));

    expect(posts()).toEqual([
      {
        path: "/portal/chat/messages",
        method: "POST",
        body: { client_id: "c1", thread: "general", lat: 4.0435, lng: 9.6966, location_label: "Warehouse B, gate 3" },
      },
    ]);
  });

  it("says so when the browser will not tell where you are", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }) },
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    await user.click(await screen.findByRole("button", { name: "Share a location" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Location is blocked for this site");
    expect(within(dialog).getByRole("button", { name: /Send location/ })).toBeDisabled();
  });
});
