/**
 * The drafting wizard.
 *
 * What is pinned here is the safety half, not the prompt: that nothing reaches
 * the boxes without being shown first, that declining leaves everything alone,
 * and that a rewrite is labelled as one. The tab's last defect was an unattended
 * write landing on authored copy — an assistant is the easiest place for that to
 * come back, wearing the author's own permission.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/toast";

const draftServiceTypeWebCopy = vi.fn();

vi.mock("@/lib/operations-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/operations-api")>("@/lib/operations-api");
  return {
    ...actual,
    draftServiceTypeWebCopy: (...a: unknown[]) => draftServiceTypeWebCopy(...a),
  };
});

import { ServiceTypeWebAiDialog } from "./service-type-web-ai-dialog";

const ST_ID = "11111111-1111-4111-8111-111111111111";

const CURRENT = {
  long_description_en: "The stored English body.",
  short_description_en: "Stored short EN.",
};

function view(props: Partial<React.ComponentProps<typeof ServiceTypeWebAiDialog>> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <ServiceTypeWebAiDialog
        open
        onClose={onClose}
        serviceTypeId={ST_ID}
        hasExistingCopy
        current={CURRENT}
        onApply={onApply}
        {...props}
      />
    </ToastProvider>,
  );
  return { onApply, onClose };
}

beforeEach(() => draftServiceTypeWebCopy.mockReset());

/** Walk the wizard to the last step and press Draft it. */
async function runWizard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Next$/ }));
  await user.click(screen.getByRole("button", { name: /^Next$/ }));
  await user.click(screen.getByRole("button", { name: /Draft it/ }));
}

describe("ServiceTypeWebAiDialog", () => {
  it("sends the licence and the tone axes the wizard collected", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      prose_preserved: true,
      proposal: { long_description_en: "## A heading\n\nThe stored English body." },
    });
    view();

    await runWizard(user);

    await waitFor(() => expect(draftServiceTypeWebCopy).toHaveBeenCalled());
    const [id, body] = draftServiceTypeWebCopy.mock.calls[0];
    expect(id).toBe(ST_ID);
    expect(body.source).toBe("existing");
    expect(body.licence).toBe("structure");
    expect(body.tone).toEqual({
      operational: "strong",
      commercial: "light",
      seo: "strong",
      corridor: "light",
      plain: "strong",
    });
  });

  it("drafting from scratch skips the licence question and sends none", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { long_description_en: "Brand new." },
    });
    view();

    // "Licence" is meaningless with no prose to protect — step 1 goes to step 3.
    await user.click(screen.getByRole("button", { name: /Draft from scratch/ }));
    await user.click(screen.getByRole("button", { name: /^Next$/ }));
    expect(screen.queryByText(/Structure only/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Draft it/ }));

    await waitFor(() => expect(draftServiceTypeWebCopy).toHaveBeenCalled());
    expect(draftServiceTypeWebCopy.mock.calls[0][1].licence).toBeUndefined();
  });

  it("shows what is there beside what is proposed, and applies nothing on its own", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      prose_preserved: true,
      proposal: { long_description_en: "## A heading\n\nThe stored English body." },
    });
    const { onApply } = view();

    await runWizard(user);
    await screen.findByText(/Review the draft/);

    // Both sides are on screen before anything is accepted — and on the
    // structure path the author's sentence appears in BOTH columns, which is
    // the preservation guarantee made visible to the person deciding.
    expect(screen.getAllByText(/The stored English body\./)).toHaveLength(2);
    expect(screen.getByText(/## A heading/)).toBeTruthy();
    // And nothing has been handed to the tab yet.
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies only the fields left accepted", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      prose_preserved: true,
      proposal: {
        long_description_en: "## A heading\n\nThe stored English body.",
        short_description_en: "A proposed teaser.",
      },
    });
    const { onApply } = view();

    await runWizard(user);
    await screen.findByText(/Review the draft/);

    // Decline the short description; keep the body.
    const rows = screen.getAllByRole("checkbox");
    expect(rows).toHaveLength(2);
    await user.click(rows[0]);

    await user.click(screen.getByRole("button", { name: /Apply 1 field/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const patch = onApply.mock.calls[0][0];
    expect(Object.keys(patch)).toEqual(["long_description_en"]);
  });

  it("discarding the review applies nothing at all", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { long_description_en: "Something." },
    });
    const { onApply, onClose } = view();

    await runWizard(user);
    await screen.findByText(/Review the draft/);
    await user.click(screen.getByRole("button", { name: /^Discard$/ }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("says plainly whether the wording survived", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      prose_preserved: false,
      proposal: { long_description_en: "Entirely new words." },
    });
    view();

    await runWizard(user);
    await screen.findByText(/Review the draft/);
    // A rewrite must never be presentable as a tidy-up.
    expect(screen.getByText(/The assistant rewrote this copy/)).toBeTruthy();
    expect(screen.queryByText(/Your sentences were not touched/)).toBeNull();
  });

  it("surfaces a refusal instead of pretending it drafted something", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: true,
      reason: "The AI budget for this month is spent.",
    });
    const { onApply } = view();

    await runWizard(user);
    await waitFor(() =>
      expect(screen.getByText(/The AI budget for this month is spent\./)).toBeTruthy(),
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it("offers only 'from scratch' when there is no copy to work from", () => {
    view({ hasExistingCopy: false, current: {} });
    expect(screen.getByRole("button", { name: /Use what is in the boxes/ })).toBeDisabled();
  });

  /**
   * The review row shows ~320 characters. On a long description that is the
   * first paragraph of twenty, and a trailing "…" the reader cannot open hides
   * exactly the part worth judging.
   */
  it("offers the full text of a truncated field, and applies what was edited", async () => {
    const user = userEvent.setup();
    const LONG = "Sentence. ".repeat(60);
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { long_description_en: LONG },
    });
    const { onApply } = view();

    await runWizard(user);
    await screen.findByText(/Review the draft/);

    // Truncated, so the action says so.
    await user.click(screen.getByRole("button", { name: /Read full & edit/ }));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe(LONG);

    fireEvent.change(box, { target: { value: "My corrected body." } });
    await user.click(screen.getByRole("button", { name: /Keep this/ }));
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(onApply.mock.calls[0][0].long_description_en).toBe("My corrected body.");
  });

  it("a short field says Edit rather than Read full", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { meta_title_en: "Short title" },
    });
    view();
    await runWizard(user);
    await screen.findByText(/Review the draft/);
    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeTruthy();
  });

  it("refuses to keep an edit that is past the column's limit", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { meta_title_en: "Short title" },
    });
    view();
    await runWizard(user);
    await screen.findByText(/Review the draft/);
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));

    // meta_title is capped at 70 — better to say so here than at Save.
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "x".repeat(80) },
    });
    expect(screen.getByRole("button", { name: /Keep this/ })).toBeDisabled();
    expect(screen.getByText(/Too long for this field/)).toBeTruthy();
  });

  /**
   * A backdrop click discarded a whole generated draft and sent the author back
   * through the wizard from the beginning. The proposal lives only in component
   * state; there is nothing to restore it from.
   */
  it("does not throw the draft away on a backdrop click or Escape", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { short_description_en: "A teaser." },
    });
    const { onClose } = view();

    await runWizard(user);
    await screen.findByText(/Review the draft/);

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Review the draft/)).toBeTruthy();
  });

  it("proposes a bilingual FAQ and applies it separately from the copy", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { short_description_en: "A teaser." },
      faq: [
        {
          question_en: "What is included?",
          question_fr: "Que comprend le service ?",
          answer_en: "Everything.",
          answer_fr: "Tout.",
          sort_order: 0,
        },
      ],
    });
    const { onApply } = view();

    await runWizard(user);
    await screen.findByText(/Review the draft/);
    expect(screen.getByText(/What is included\?/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Apply/ }));
    const [patch, faq] = onApply.mock.calls[0];
    // The FAQ is its own table behind its own Save — never folded into the patch.
    expect(patch.short_description_en).toBe("A teaser.");
    expect(faq).toHaveLength(1);
    expect(faq[0].question_fr).toBe("Que comprend le service ?");
  });

  it("says why there is no FAQ when only one language came back", async () => {
    const user = userEvent.setup();
    draftServiceTypeWebCopy.mockResolvedValue({
      manual_required: false,
      proposal: { short_description_en: "A teaser." },
      faq: [],
      faq_unavailable: "single_language",
    });
    view();
    await runWizard(user);
    await screen.findByText(/Review the draft/);
    expect(screen.getByText(/No FAQ this time/)).toBeTruthy();
  });
});
