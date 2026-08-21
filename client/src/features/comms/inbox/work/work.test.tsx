/**
 * THE WORK RAIL — the four rules that are only visible on screen.
 *
 * The server enforces every one of these, and each is already tested there. So
 * this file is not about whether the rule holds; it is about whether an
 * operator can SEE it hold. A guardrail the interface hides is a guardrail the
 * interface will eventually route around.
 *
 *   1. §7.3 — an unready action card offers the SAME BUTTON plus a reason,
 *             never a disabled one. The disabled button is the third way §7.3
 *             spends a chapter refusing, and it is what a UI does by default.
 *   2. §7.6 — nothing is filed silently, at any confidence, and the operator
 *             can correct the machine before filing.
 *   3. §8.3 — a fenced draft still arrives, with the unsupported values NAMED,
 *             and the sources it was grounded in are stated.
 *   4. §8.8 — the one hard block asks for a reason and says, before the person
 *             types, that it is permanent.
 *
 * Plus the one that is purely a client concern: `not_built` is not "empty".
 */
// No `import * as React` — `jsx: "react-jsx"` means JSX needs no import, and
// `noUnusedLocals` fails the build on one. This file had it, and it shipped:
// vitest transpiles without typechecking, so a green test run says nothing
// about whether `tsc -b` (which `npm run build` runs first) will pass.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import { ActionCards } from "./action-cards";
import { DocumentIntake } from "./intake";
import { DossierDrawer } from "./dossier-drawer";
import { DraftProvenance } from "./assist";
import { GuardrailBar } from "./guardrails";
import { SchedulePicker, schedulePayload, type ScheduleChoice } from "./schedule";
import type { ActionCard, AssistDraft, GuardrailResult } from "@/lib/mail-api";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

beforeEach(() => vi.clearAllMocks());

/* ── §7.3 · Action cards ──────────────────────────────────────────────────── */

const card = (over: Partial<ActionCard> = {}): ActionCard => ({
  card: "proforma",
  label_en: "Create proforma",
  label_fr: "Créer une proforma",
  ready: true,
  target: "/finance/proformas/new",
  prefill: { client_id: "c-1", incoterm: "FOB" },
  missing: [],
  read_only: true,
  ...over,
});

describe("an action card that is not ready still offers the action", () => {
  const notReady = card({
    ready: false,
    prefill: { client_id: "c-1" },
    missing: [
      { field: "incoterm", label: "Incoterm", why: "this thread does not say the incoterm" },
      { field: "delivery_place", label: "Place of delivery", why: "the dossier has no delivery place yet" },
    ],
  });

  it("THE BUTTON IS NOT DISABLED", async () => {
    renderScreen(<ActionCards threadId="t1" />, {
      routes: { "/mail/threads/t1/cards": { thread_id: "t1", cards: [notReady] } },
    });
    const button = await screen.findByRole("button", { name: "Create proforma" });
    // The whole of §7.3 in one assertion. A disabled button tells the operator
    // they cannot proceed and nothing about what would let them.
    expect(button).not.toBeDisabled();
  });

  it("it says how many things it needs, on the face of the card", async () => {
    renderScreen(<ActionCards threadId="t1" />, {
      routes: { "/mail/threads/t1/cards": { thread_id: "t1", cards: [notReady] } },
    });
    expect(await screen.findByText("Needs 2 things")).toBeInTheDocument();
  });

  it("each missing field carries ITS OWN reason, not a generated one", async () => {
    renderScreen(<ActionCards threadId="t1" />, {
      routes: { "/mail/threads/t1/cards": { thread_id: "t1", cards: [notReady] } },
    });
    await userEvent.click(await screen.findByRole("button", { name: /What is missing/ }));
    // Two different sentences, because they send the operator to two different
    // places. A string built from the field name would say neither.
    expect(screen.getByText(/this thread does not say the incoterm/)).toBeInTheDocument();
    expect(screen.getByText(/the dossier has no delivery place yet/)).toBeInTheDocument();
  });

  it("a ready card links into the owning module, prefilled", async () => {
    renderScreen(<ActionCards threadId="t1" />, {
      routes: { "/mail/threads/t1/cards": { thread_id: "t1", cards: [card()] } },
    });
    const link = await screen.findByRole("link", { name: /Create proforma/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("/finance/proformas/new"));
    expect(link).toHaveAttribute("href", expect.stringContaining("incoterm=FOB"));
  });

  it("it says, in words, that nothing is created from here", async () => {
    renderScreen(<ActionCards threadId="t1" />, {
      routes: { "/mail/threads/t1/cards": { thread_id: "t1", cards: [card()] } },
    });
    expect(await screen.findByText(/Nothing is created from here/)).toBeInTheDocument();
  });
});

/* ── §7.5 · not_built is not empty ────────────────────────────────────────── */

describe("a tab that is not built says so", () => {
  it("does not render an empty table, which would be a claim about the party", async () => {
    renderScreen(<DossierDrawer entityRef="supplier:s-1" />, {
      routes: {
        "/mail/context": {
          kind: "supplier",
          header: { name: "Bolloré Trading" },
          overview: {},
          tabs_available: ["commercial"],
        },
        "/mail/context/commercial": { not_built: true },
      },
    });
    expect(await screen.findByText(/not built for this kind of record yet/)).toBeInTheDocument();
    // The distinction the server bothers to make, preserved. "No quotations"
    // and "we did not look" are different facts.
    expect(screen.getByText(/not the same as it being empty/)).toBeInTheDocument();
  });
});

/* ── §7.6 · nothing is filed silently ─────────────────────────────────────── */

describe("a document suggestion is a suggestion", () => {
  const suggestion = {
    email_attachment_classification_id: "k-1",
    email_attachment_id: "a-1",
    filename: "BL-SLAS-2026-0042.pdf",
    suggested_doc_type_code: "BL",
    suggested_entity_ref: "dossier:d-1",
    confidence: 0.95,
    matched_on: "filename",
    status: "SUGGESTED" as const,
  };

  it("even at 95% it asks", async () => {
    renderScreen(<DocumentIntake threadId="t1" />, {
      routes: { "/mail/threads/t1/intake": [suggestion] },
    });
    expect(await screen.findByRole("button", { name: "File it" })).toBeInTheDocument();
    expect(screen.getByText("95% sure")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is filed until you say so/)).toBeInTheDocument();
  });

  it("the machine's guess is CORRECTABLE, or the confirm is decorative", async () => {
    renderScreen(<DocumentIntake threadId="t1" />, {
      routes: { "/mail/threads/t1/intake": [suggestion] },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Change it" }));
    expect(screen.getByLabelText("Document type")).toHaveValue("BL");
    expect(screen.getByLabelText("File it against")).toHaveValue("dossier:d-1");
  });

  it("an unbound attachment says nothing says whose it is, rather than guessing", async () => {
    renderScreen(<DocumentIntake threadId="t1" />, {
      routes: {
        "/mail/threads/t1/intake": [{ ...suggestion, suggested_entity_ref: null }],
      },
    });
    expect(await screen.findByText(/nothing says whose it is yet/)).toBeInTheDocument();
  });
});

/* ── §8.3 · the draft is checkable ────────────────────────────────────────── */

const draft = (over: Partial<AssistDraft> = {}): AssistDraft => ({
  draft_text: "Your invoice INV-2026-9999 is due.",
  language: "en",
  sources: [{ key: "invoice_status", label: "Invoices", module_key: "MOD-51", count: 2 }],
  withheld: [],
  fence: { ok: true, violations: [] },
  ...over,
});

describe("a draft arrives with its provenance", () => {
  it("names the modules it was grounded in", () => {
    renderScreen(<DraftProvenance draft={draft()} />);
    expect(screen.getByText("Invoices")).toBeInTheDocument();
  });

  it("NAMES what the record does not support, and does not hide the draft", () => {
    renderScreen(
      <DraftProvenance
        draft={draft({ fence: { ok: false, violations: ["INV-2026-9999"] }, needs_review: true })}
      />,
    );
    // A blank composer teaches people to stop using the feature. A marked one
    // teaches them what the assistant does not know.
    expect(screen.getByText(/INV-2026-9999/)).toBeInTheDocument();
    expect(screen.getByText(/Check these before you send/)).toBeInTheDocument();
  });

  it("says which sources were WITHHELD and why", () => {
    renderScreen(
      <DraftProvenance
        draft={draft({
          withheld: [{ key: "invoice_status", label: "Invoices", reason: "requires MOD-51 view" }],
        })}
      />,
    );
    // Silently thinner drafts for some users than others is the version of this
    // nobody can debug.
    expect(screen.getByText(/requires MOD-51 view/)).toBeInTheDocument();
  });

  it("says when a protected term had to be put back", () => {
    renderScreen(<DraftProvenance draft={draft({ protected_terms_restored: ["FOB"] })} />);
    expect(screen.getByText(/FOB/)).toBeInTheDocument();
  });
});

/* ── §8.8 · the block, and the permanence of the override ─────────────────── */

const blocked: GuardrailResult = {
  warnings: [{ code: "NO_SUBJECT", message: "This message has no subject." }],
  blocks: [{
    code: "FINANCIAL_TO_SUSPICIOUS",
    message: "A financial document to a domain that is not verified.",
  }],
};

describe("the pre-send bar", () => {
  it("shows the block and asks why", () => {
    renderScreen(
      <GuardrailBar result={blocked} overrideReason="" onOverrideChange={vi.fn()} />,
    );
    expect(screen.getByText(/This send is blocked/)).toBeInTheDocument();
    expect(screen.getByLabelText("Override reason")).toBeInTheDocument();
  });

  it("SAYS THE REASON IS PERMANENT BEFORE THE PERSON TYPES", () => {
    renderScreen(
      <GuardrailBar result={blocked} overrideReason="" onOverrideChange={vi.fn()} />,
    );
    // Someone writing a sentence that outlives them and the mailbox is entitled
    // to know that is what they are doing.
    expect(
      screen.getByText(/written to the permanent audit ledger with your name on it/),
    ).toBeInTheDocument();
  });

  it("nudges past 'ok' without blocking the field", async () => {
    const onChange = vi.fn();
    const { rerender } = renderScreen(
      <GuardrailBar result={blocked} overrideReason="ok" onOverrideChange={onChange} />,
    );
    expect(screen.getByText(/A sentence, please/)).toBeInTheDocument();
    rerender(
      <GuardrailBar
        result={blocked}
        overrideReason="Confirmed by phone with Thierry this morning."
        onOverrideChange={onChange}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/A sentence, please/)).not.toBeInTheDocument());
  });

  it("a warning never asks for a reason", () => {
    renderScreen(
      <GuardrailBar
        result={{ warnings: blocked.warnings, blocks: [] }}
        overrideReason=""
        onOverrideChange={vi.fn()}
      />,
    );
    // The line stays sharp on purpose. A guardrail that blocks a dozen things
    // is one people learn to click through.
    expect(screen.getByText(/This message has no subject/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Override reason")).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = renderScreen(
      <GuardrailBar result={{ warnings: [], blocks: [] }} overrideReason="" onOverrideChange={vi.fn()} />,
    );
    expect(within(container).queryByRole("status")).not.toBeInTheDocument();
  });
});

/* ── §9.3 · scheduling ────────────────────────────────────────────────────── */

describe("scheduled send offers two shapes and no third", () => {
  it("there is no 'best time to send'", async () => {
    renderScreen(<SchedulePicker value={{ kind: "NOW" }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send later" }));
    // Q32 removed the open-rate data that would be needed to know it. A button
    // here would be a hardcoded 10am wearing the word "optimal".
    expect(screen.queryByText(/best time/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Send at")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Their morning/ })).toBeInTheDocument();
  });

  it("it promises not to guess a timezone", async () => {
    renderScreen(<SchedulePicker value={{ kind: "NOW" }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send later" }));
    expect(screen.getByText(/we will not guess one/)).toBeInTheDocument();
  });

  it.each<[ScheduleChoice, Record<string, unknown>]>([
    [{ kind: "NOW" }, {}],
    [{ kind: "AT", iso: "2026-09-01T08:00:00.000Z" }, { send_at: "2026-09-01T08:00:00.000Z" }],
    [{ kind: "MORNING" }, { send_in_recipient_morning: true }],
  ])("the payload carries exactly one field, or neither", (choice, expected) => {
    // Scheduling and undo-send are the same mechanism; if both computed a
    // release time, a message scheduled for Tuesday would also be "undoable"
    // for twenty seconds and then not for six days.
    expect(schedulePayload(choice)).toEqual(expected);
  });
});
