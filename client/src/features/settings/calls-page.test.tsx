/**
 * Settings → Calls: the relay-only privacy switch (calls audit C13) reads and
 * writes `comms.call_privacy`, the setting the call service turns into
 * iceTransportPolicy "relay". PR-6: the recording opt-in and both retentions
 * save ONE merged `comms.call_recording` value, the processors are named from
 * the server's answer, the person's own preferences save, and an admin's
 * erasure goes through a destructive confirm.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const settings: Record<string, unknown> = {};
const putSetting = vi.fn(async () => ({}));

vi.mock("@/lib/api-client", () => ({
  tenant: vi.fn(async (path: string) => {
    const key = path.split("/").pop() as string;
    return { value: settings[key] ?? null };
  }),
}));
vi.mock("@/lib/mail-api", () => ({ putSetting: (...a: unknown[]) => putSetting(...(a as [])) }));
const prefs = vi.hoisted(() => ({
  stored: { noiseSuppression: null, doNotDisturb: null, quietHours: null, hideLastSeen: null } as Record<string, unknown>,
  save: vi.fn(),
}));
vi.mock("@/lib/preferences", () => ({
  fetchCallPrefs: vi.fn(async () => ({ ...prefs.stored })),
  saveCallPrefs: vi.fn(async (p: Record<string, unknown>) => {
    prefs.save(p);
    return { ...prefs.stored, ...p };
  }),
}));
const api = vi.hoisted(() => ({
  caps: { calls: true, can_dial: true, recording: false, settings_admin: false },
  erase: vi.fn(async (_id: string) => ({ user_id: "u2", calls: 3, audio_parts: 5, audio_failed: 0, transcripts: 3, drafts: 1 })),
}));
vi.mock("@/lib/smartcomm-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/smartcomm-api")>()),
  fetchCallCapabilities: vi.fn(async () => api.caps),
  fetchCallProcessing: vi.fn(async () => ({
    recording_enabled: false,
    transcription: [
      { vendor: "groq", role: "first", name: "Groq", country: "United States" },
      { vendor: "gemini", role: "when_first_fails", name: "Google (Gemini)", country: "United States" },
    ],
    summary: [{ vendor: "deepseek", role: "last_resort", name: "DeepSeek", country: "China" }],
    network: [],
  })),
  eraseUserCallRecords: (id: string) => api.erase(id),
}));
vi.mock("@/components/ui/search-select", () => ({
  SearchSelect: ({ onSelect, label }: { onSelect: (r: Record<string, unknown>) => void; label: string }) => (
    <button type="button" onClick={() => onSelect({ user_id: "u2", full_name: "Moussa K." })}>{`pick ${label}`}</button>
  ),
}));

import { CallsPage } from "./calls-page";

const renderPage = () => render(<MemoryRouter><CallsPage /></MemoryRouter>);

describe("Settings → Calls: relay-only calls (C13)", () => {
  beforeEach(() => {
    putSetting.mockClear();
    prefs.save.mockClear();
    api.erase.mockClear();
    api.caps = { calls: true, can_dial: true, recording: false, settings_admin: true };
    for (const k of Object.keys(settings)) delete settings[k];
  });

  it("is off when the company has not chosen, and turning it on saves comms.call_privacy", async () => {
    renderPage();
    const box = await screen.findByRole("checkbox", { name: /send every call through the relay/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(putSetting).toHaveBeenCalledWith("comms", "call_privacy", { relay_only: true }));
  });

  it("shows the stored choice", async () => {
    settings.call_privacy = { relay_only: true };
    renderPage();
    expect(await screen.findByRole("checkbox", { name: /send every call through the relay/i })).toBeChecked();
  });
});

describe("Settings → Calls: recording and privacy (PR-6, G1–G4)", () => {
  beforeEach(() => {
    putSetting.mockClear();
    prefs.save.mockClear();
    api.erase.mockClear();
    api.caps = { calls: true, can_dial: true, recording: false, settings_admin: true };
    for (const k of Object.keys(settings)) delete settings[k];
  });

  it("recording is off unless the company opted in, and turning it on keeps the retention days", async () => {
    settings.call_recording = { retention_days: 14, transcript_retention_days: 90 };
    renderPage();
    const box = await screen.findByRole("checkbox", { name: /record and summarise calls/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() =>
      expect(putSetting).toHaveBeenCalledWith("comms", "call_recording", {
        enabled: true, retention_days: 14, transcript_retention_days: 90,
      }),
    );
  });

  it("saving the audio days alone no longer drops the opt-in", async () => {
    settings.call_recording = { enabled: true, retention_days: 30 };
    renderPage();
    const days = await screen.findByRole("spinbutton", { name: /keep recordings for/i });
    await userEvent.clear(days);
    await userEvent.type(days, "10");
    await userEvent.tab();
    await waitFor(() =>
      expect(putSetting).toHaveBeenCalledWith("comms", "call_recording", {
        enabled: true, retention_days: 10, transcript_retention_days: null,
      }),
    );
  });

  it("an empty transcript retention keeps transcripts with the conversation; a number is clamped", async () => {
    settings.call_recording = { enabled: false, retention_days: 30 };
    renderPage();
    const days = await screen.findByRole("spinbutton", { name: /keep transcripts for/i });
    expect(days).toHaveValue(null);
    await userEvent.type(days, "5");
    await userEvent.tab();
    await waitFor(() =>
      expect(putSetting).toHaveBeenCalledWith("comms", "call_recording", {
        enabled: false, retention_days: 30, transcript_retention_days: 30,
      }),
    );
  });

  it("names the outside companies from the server, not from the page", async () => {
    renderPage();
    expect(await screen.findByText("Google (Gemini)")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText(/recording is off, so no call audio leaves/i)).toBeInTheDocument();
  });

  it("saves the person's do-not-disturb, quiet hours and hide-last-seen", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: /do not disturb/i }));
    await waitFor(() => expect(prefs.save).toHaveBeenCalledWith({ doNotDisturb: true }));
    await userEvent.click(screen.getByRole("checkbox", { name: /quiet hours/i }));
    await waitFor(() => expect(prefs.save).toHaveBeenCalledWith({ quietHours: { from: "20:00", to: "07:00" } }));
    expect(await screen.findByLabelText(/from/i)).toHaveValue("20:00");
    await userEvent.click(screen.getByRole("checkbox", { name: /hide my last seen/i }));
    await waitFor(() => expect(prefs.save).toHaveBeenCalledWith({ hideLastSeen: true }));
  });

  it("tells someone without MOD-70 the company half is read-only, instead of the 403 (F10)", async () => {
    api.caps = { ...api.caps, settings_admin: false };
    renderPage();
    expect(await screen.findByText(/only a settings administrator can change them/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /record and summarise calls/i })).toBeDisabled();
    // Their own preferences stay theirs.
    expect(screen.getByRole("checkbox", { name: /do not disturb/i })).toBeEnabled();
  });

  it("offers erasure only to a settings admin", async () => {
    api.caps = { ...api.caps, settings_admin: false };
    renderPage();
    await screen.findByRole("checkbox", { name: /do not disturb/i });
    expect(screen.queryByRole("button", { name: /erase call records/i })).not.toBeInTheDocument();
  });

  it("erasure asks first, destructively, then reports what went", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /pick person/i }));
    await userEvent.click(screen.getByRole("button", { name: /erase call records/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/erase moussa k\.'s call records/i);
    expect(api.erase).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: /erase call records/i }));
    await waitFor(() => expect(api.erase).toHaveBeenCalledWith("u2"));
    expect(await screen.findByText(/erased 3 calls/i)).toBeInTheDocument();
  });
});
