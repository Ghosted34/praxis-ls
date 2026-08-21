/**
 * INTERNAL NOTES + MENTIONS (§7.4, §7.8) — the client half of the rule.
 *
 * The server enforces the containment rule (notes never leave the building)
 * and the three-channel fan-out; both are tested server-side. What only the
 * CLIENT can break:
 *
 *   · the operator must SEE who they have mentioned before they post — a
 *     mention is a message to a person, and the confirmation line is the only
 *     thing between a typo and an accidental message;
 *   · the internal-only boundary is STATED on screen, not implied by styling —
 *     the sentence is what stops a future "quote in reply" button;
 *   · `@name` renders distinctly so the author can see who they addressed.
 *
 * The audit's §9 named `mention-picker.test.tsx`; the picker exists as the
 * parse-plus-confirmation in `notes.tsx` rather than a separate component, so
 * this file covers that named gap where the UI actually lives.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import { ThreadNotes } from "./notes";
import * as client from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

const NOTES = [
  {
    email_thread_note_id: "n-1",
    body: "Please double-check the BL with @marie",
    author_name: "Jules",
    created_at: "2026-08-20T10:00:00Z",
  },
];

function render(notes: typeof NOTES = NOTES) {
  return renderScreen(<ThreadNotes threadId="t-1" />, {
    routes: { "/mail/threads/t-1/notes": notes },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("the boundary is stated, not implied", () => {
  it("renders the internal-only sentence", async () => {
    render();
    await screen.findByText(/Internal only/);
  });

  it("renders existing notes with the author, and @mentions distinctly", async () => {
    render();
    const body = await screen.findByText(/Please double-check the BL with/);
    expect(body.textContent).toContain("@marie");
    const mention = body.querySelector("span");
    expect(mention).not.toBeNull();
    expect(mention!.textContent).toBe("@marie");
    expect(mention!.className).toContain("text-primary-ink");
    expect(screen.getByText("Jules")).toBeTruthy();
  });
});

describe("the mention pre-flight — a mention is a message to a person", () => {
  it("lists who will be notified, and through which channels, BEFORE posting", async () => {
    render();
    const box = screen.getByLabelText("New internal note");
    await userEvent.type(box, "@marie @jean-paul");
    expect(
      await screen.findByText(/This will notify @marie, @jean-paul in the app, by email and in team chat/),
    ).toBeTruthy();
  });

  it("does not render the confirmation for a note with no mention", async () => {
    render();
    const box = screen.getByLabelText("New internal note");
    await userEvent.type(box, "just a plain note");
    await waitFor(() => {
      expect(screen.queryByText(/This will notify/)).toBeNull();
    });
  });

  it("de-duplicates repeated mentions — @marie twice is one person", async () => {
    render();
    const box = screen.getByLabelText("New internal note");
    await userEvent.type(box, "@marie and again @marie");
    const line = await screen.findByText(/This will notify @marie in the app/);
    expect(line.textContent).not.toMatch(/@marie.*@marie/);
  });

  it("posts through the API with the body, and clears the box", async () => {
    const tenant = vi.spyOn(client, "tenant");
    render();
    const box = screen.getByLabelText("New internal note");
    await userEvent.type(box, "@marie please confirm the rate");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => {
      expect(tenant).toHaveBeenCalledWith("/mail/threads/t-1/notes", {
        method: "POST",
        body: { body: "@marie please confirm the rate" },
      });
    });
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("cannot post an empty note", async () => {
    const tenant = vi.spyOn(client, "tenant");
    render();
    const button = screen.getByRole("button", { name: "Add note" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("New internal note"), "   ");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // The GET for the list is fine; what must never happen is a POST.
    expect(tenant).not.toHaveBeenCalledWith(
      "/mail/threads/t-1/notes",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
