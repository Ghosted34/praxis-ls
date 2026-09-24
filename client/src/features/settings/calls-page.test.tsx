/**
 * Settings → Calls: the relay-only privacy switch (calls audit C13) reads and
 * writes `comms.call_privacy`, the setting the call service turns into
 * iceTransportPolicy "relay".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/lib/preferences", () => ({
  fetchCallPrefs: vi.fn(async () => ({ noiseSuppression: null })),
  saveCallPrefs: vi.fn(async (p: unknown) => p),
}));

import { CallsPage } from "./calls-page";

const renderPage = () => render(<MemoryRouter><CallsPage /></MemoryRouter>);

describe("Settings → Calls: relay-only calls (C13)", () => {
  beforeEach(() => {
    putSetting.mockClear();
    for (const k of Object.keys(settings)) delete settings[k];
  });

  it("is off when the company has not chosen, and turning it on saves comms.call_privacy", async () => {
    renderPage();
    const box = await screen.findByRole("checkbox", { name: /relay-only calls/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(putSetting).toHaveBeenCalledWith("comms", "call_privacy", { relay_only: true }));
  });

  it("shows the stored choice", async () => {
    settings.call_privacy = { relay_only: true };
    renderPage();
    expect(await screen.findByRole("checkbox", { name: /relay-only calls/i })).toBeChecked();
  });
});
