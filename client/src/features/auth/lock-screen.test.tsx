/**
 * The lock screen's guarantees, one test each: nothing behind it is readable,
 * nothing behind it is usable, nothing is lost, and only the right person gets
 * back in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Status = "authed" | "locked" | "anon";
const auth = {
  status: "locked" as Status,
  lockReason: "session_max_age" as string | null,
  unlockedElsewhere: 0,
  user: { user_id: "u1", email: "ama@acme.cm", display_name: "Ama Nkeng", avatar_url: null },
  abandonLock: vi.fn(),
  login: vi.fn(async () => ({ pending2fa: false })),
  verify2fa: vi.fn(),
  pinLogin: vi.fn(),
  passkeyLogin: vi.fn(),
};
vi.mock("@/app/auth/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/app/branding/branding-context", () => ({
  useBranding: () => ({ branding: { name: "Acme Freight", logoUrl: null } }),
}));

import { LockLayer } from "./lock-screen";

function Page() {
  return (
    <div>
      <div data-testid="app">
        <h1>Invoice INV-0042 — Dangote Cement — 48,500,000 XAF</h1>
        <button type="button">Approve payment</button>
      </div>
      <LockLayer />
    </div>
  );
}

beforeEach(() => {
  auth.status = "locked";
  auth.lockReason = "session_max_age";
  auth.unlockedElsewhere = 0;
  auth.abandonLock.mockClear();
  document.title = "Invoice INV-0042 · Acme Freight";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("LockLayer", () => {
  it("covers the app: every other element is blurred, inert and hidden from assistive tech", () => {
    render(<Page />);

    const lockRoot = document.getElementById("praxis-lock-root");
    expect(lockRoot).not.toBeNull();
    for (const el of Array.from(document.body.children)) {
      if (el === lockRoot) continue;
      expect(el.classList.contains("praxis-locked")).toBe(true);
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect((el as HTMLElement).inert).toBe(true);
    }
    // The lock itself is the one thing reachable.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Session locked")).toBeInTheDocument();
  });

  it("says why it locked, in words", () => {
    render(<Page />);
    expect(screen.getByText(/sessions lock after 2 hours/i)).toBeInTheDocument();
  });

  it("does not advertise the open record in the tab title", () => {
    render(<Page />);
    expect(document.title).toBe("Locked · Acme Freight");
  });

  it("seals a portal that opens WHILE locked (a late toast cannot surface over the blur)", async () => {
    render(<Page />);
    const toast = document.createElement("div");
    toast.textContent = "Payment of 48,500,000 XAF approved";
    document.body.appendChild(toast);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.classList.contains("praxis-locked")).toBe(true);
    expect(toast.inert).toBe(true);
  });

  it("keeps keys that start on the lock screen away from the app (Escape cannot close a dialog underneath)", () => {
    render(<Page />);
    const onDocKey = vi.fn();
    document.addEventListener("keydown", onDocKey);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onDocKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDocKey);
  });

  it("greets the person whose screen it is, and 'Not you?' hands over to a clean sign-in", async () => {
    const user = userEvent.setup();
    render(<Page />);
    expect(screen.getByRole("heading", { name: "Welcome back, Ama" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Not you\?/ }));
    expect(auth.abandonLock).toHaveBeenCalled();
  });

  it("restores the page exactly when it closes — the app underneath was never unmounted", () => {
    const { rerender } = render(<Page />);
    expect(screen.getByTestId("app").closest(".praxis-locked")).not.toBeNull();

    auth.status = "anon";
    rerender(<Page />);

    expect(document.getElementById("praxis-lock-root")).toBeNull();
    for (const el of Array.from(document.body.children)) {
      expect(el.classList.contains("praxis-locked")).toBe(false);
      expect(el.hasAttribute("aria-hidden")).toBe(false);
      expect((el as HTMLElement).inert).toBe(false);
    }
    expect(document.title).toBe("Invoice INV-0042 · Acme Freight");
    expect(screen.getByRole("button", { name: "Approve payment" })).toBeInTheDocument();
  });

  it("seals the page even when it does not know whose screen it is", () => {
    const saved = auth.user;
    (auth as { user: unknown }).user = null;
    render(<Page />);
    expect(screen.getByTestId("app").closest(".praxis-locked")).not.toBeNull();
    expect(screen.getByText("Session locked")).toBeInTheDocument();
    auth.user = saved;
  });

  it("renders nothing while signed in", () => {
    auth.status = "authed";
    render(<Page />);
    expect(document.getElementById("praxis-lock-root")).toBeNull();
    expect(screen.queryByText("Session locked")).not.toBeInTheDocument();
  });
});
