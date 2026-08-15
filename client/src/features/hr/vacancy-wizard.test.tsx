/**
 * The drafting interview.
 *
 * WHAT THESE PIN
 *
 *   - The count is honest from the first card. The bar is sized for the whole
 *     interview the server declared (eight fixed + the follow-ups it intends to
 *     generate), because a progress bar that reaches the end and then grows is
 *     worse than no progress bar.
 *   - Only the role title blocks. Every other question offers Skip — a wizard
 *     that will not let you past question five gets an invented answer.
 *   - The follow-ups are generated FROM the answers, and a failure to generate
 *     them shortens the interview instead of ending it. The whole flow degrades
 *     to the fixed eight with no model at all.
 *   - Speaking ADDS to what was typed. Replacing is unrecoverable.
 *   - The salary lands under the two keys the drafting service reads by name.
 *     They are a contract between this file and `vacancy.draft.js`, and nothing
 *     else would notice them drifting until an advert quoted no money.
 *   - The escape hatch is reachable from any card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const intakeQuestions = vi.fn();
const intakeFollowUps = vi.fn();
const draftVacancy = vi.fn();

vi.mock("@/lib/hr-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return {
    ...actual,
    intakeQuestions: (...a: unknown[]) => intakeQuestions(...a),
    intakeFollowUps: (...a: unknown[]) => intakeFollowUps(...a),
    draftVacancy: (...a: unknown[]) => draftVacancy(...a),
  };
});

// The mic is the component's own tested unit (MediaRecorder, permissions,
// transcription). What matters HERE is what the wizard does with a transcript,
// so it is stubbed down to a button that hands one over.
vi.mock("@/components/voice-input", () => ({
  VoiceInput: ({ onText }: { onText: (t: string) => void }) => (
    <button type="button" onClick={() => onText("spoken words")}>
      Speak your answer
    </button>
  ),
}));

import { VacancyWizard } from "./vacancy-wizard";

/** The server's fixed set, in its shape. Eight asked, ten declared. */
const QUESTIONS = [
  { key: "title", type: "text", question: "What role are you hiring for?" },
  { key: "department", type: "text", question: "Which team or department does it sit in?" },
  { key: "headcount", type: "number", question: "How many people are you hiring?", min: 1 },
  { key: "work_pattern", type: "textarea", question: "How will they work?" },
  { key: "location", type: "textarea", question: "Where is the role based?" },
  { key: "salary", type: "salary", question: "What monthly salary range are you offering?" },
  { key: "must_haves", type: "textarea", question: "What are the must-haves?" },
  { key: "extras", type: "textarea", optional: true, question: "Anything else?" },
];

const START = {
  questions: QUESTIONS,
  total: 10,
  currency: "XAF",
  entity: { entity_id: "e1", name: "JBS Praxis SA" },
};

const FOLLOW_UPS = [
  { key: "followup_1", type: "textarea", optional: true, question: "How senior a stylist?" },
  { key: "followup_2", type: "textarea", optional: true, question: "Which tools do they use?" },
];

const DRAFT = { vacancy_id: "v9", title: "Senior Stylist", status: "DRAFT" };

/**
 * The same interview on a tenant running several companies: the server puts
 * "which company is hiring?" first and counts it, so the whole set is eleven.
 */
const ENTITY_QUESTION = {
  key: "entity_id",
  type: "entity",
  question: "Which company is hiring?",
  options: [
    { value: "e1", label: "JBS Praxis SA", currency: "XAF" },
    { value: "e2", label: "JBS Praxis Nigeria", currency: "NGN" },
  ],
};
const MULTI = {
  questions: [ENTITY_QUESTION, ...QUESTIONS],
  total: 11,
  currency: "XAF",
  entity: null,
};

/** Pick from the Radix select — click the trigger, then the option. */
async function pickCompany(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(await screen.findByRole("combobox", { name: "Company" }));
  await user.click(within(await screen.findByRole("listbox")).getByText(label));
}

function view() {
  const onDrafted = vi.fn();
  const onBlankForm = vi.fn();
  const r = renderScreen(
    <VacancyWizard onClose={vi.fn()} onDrafted={onDrafted} onBlankForm={onBlankForm} />,
    {},
  );
  return { ...r, onDrafted, onBlankForm };
}

const forward = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^(Next|Skip)$/ }));

/** Answer the eight fixed questions, then land wherever Next leads. */
async function answerFixedSet(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Your answer"), "Senior Stylist");
  await forward(user); // title → department
  await user.type(screen.getByLabelText("Your answer"), "Salon");
  await forward(user); // → headcount
  await user.type(screen.getByLabelText("Your answer"), "3");
  await forward(user); // → work pattern
  await user.type(screen.getByLabelText("Your answer"), "On-site, five days");
  await forward(user); // → location
  await user.type(screen.getByLabelText("Your answer"), "Douala");
  await forward(user); // → salary
  await user.type(screen.getByLabelText(/^From/), "150000");
  await user.type(screen.getByLabelText(/^To/), "250000");
  await forward(user); // → must-haves
  await user.type(screen.getByLabelText("Your answer"), "Three years on a salon floor");
  await forward(user); // → extras
  await forward(user); // leaves the fixed set: follow-ups are fetched here
}

beforeEach(() => {
  vi.clearAllMocks();
  intakeQuestions.mockResolvedValue(START);
  intakeFollowUps.mockResolvedValue({ questions: FOLLOW_UPS });
  draftVacancy.mockResolvedValue(DRAFT);
});

describe("the vacancy drafting interview", () => {
  it("is sized for the whole interview from the first card", async () => {
    view();
    expect(await screen.findByText("Question 1 of 10")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: /progress/i });
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
  });

  it("says which entity is hiring, and quotes the salary in its currency", async () => {
    const user = userEvent.setup();
    view();
    expect(await screen.findByText(/JBS Praxis SA/)).toBeInTheDocument();
    await user.type(await screen.findByLabelText("Your answer"), "Senior Stylist");
    for (let i = 0; i < 5; i++) await forward(user);
    expect(screen.getByLabelText("From (XAF/month)")).toBeInTheDocument();
  });

  it("blocks on the role and nothing else", async () => {
    const user = userEvent.setup();
    view();
    // Nothing typed: the only way on is disabled — there is no advert without a role.
    expect(await screen.findByRole("button", { name: "Skip" })).toBeDisabled();
    await user.type(screen.getByLabelText("Your answer"), "Senior Stylist");
    await user.click(screen.getByRole("button", { name: "Next" }));
    // Every question after it can be passed over.
    expect(await screen.findByRole("button", { name: "Skip" })).toBeEnabled();
  });

  it("adds a spoken answer to what was already typed", async () => {
    const user = userEvent.setup();
    view();
    await user.type(await screen.findByLabelText("Your answer"), "Senior Stylist");
    await forward(user);
    await user.type(screen.getByLabelText("Your answer"), "Salon");
    await forward(user);
    await user.type(screen.getByLabelText("Your answer"), "3");
    await forward(user); // the first textarea question
    const box = screen.getByLabelText("Your answer");
    await user.type(box, "Half typed");
    await user.click(screen.getByRole("button", { name: "Speak your answer" }));
    expect(box).toHaveValue("Half typed spoken words");
  });

  it("generates the follow-ups from the answers so far", async () => {
    const user = userEvent.setup();
    view();
    await answerFixedSet(user);

    expect(intakeFollowUps).toHaveBeenCalledWith({
      entity_id: "e1",
      answers: expect.objectContaining({
        title: "Senior Stylist",
        headcount: 3,
        salary_min: 150000,
        salary_max: 250000,
      }),
    });
    expect(await screen.findByText("How senior a stylist?")).toBeInTheDocument();
    expect(screen.getByText("Question 9 of 10")).toBeInTheDocument();
  });

  it("shortens the interview when no follow-ups come back, rather than stalling", async () => {
    const user = userEvent.setup();
    intakeFollowUps.mockRejectedValue(new Error("no model"));
    view();
    await answerFixedSet(user);

    // The last fixed card is now the last card: the draft button takes over and
    // the count tells the truth about the shorter interview.
    expect(
      await screen.findByRole("button", { name: /Draft the whole vacancy with AI/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Question 8 of 8")).toBeInTheDocument();
  });

  it("drafts from every answer and hands back the saved draft", async () => {
    const user = userEvent.setup();
    const { onDrafted } = view();
    // `answerFixedSet` ends inside the first follow-up: the generated questions
    // arrive with the cursor already on them.
    await answerFixedSet(user);
    await forward(user); // → follow-up 2, the last card
    await user.click(
      await screen.findByRole("button", { name: /Draft the whole vacancy with AI/ }),
    );

    expect(draftVacancy).toHaveBeenCalledWith({
      entity_id: "e1",
      answers: expect.objectContaining({
        title: "Senior Stylist",
        department: "Salon",
        headcount: 3,
        work_pattern: "On-site, five days",
        location: "Douala",
        // The two keys `vacancy.draft.js` reads by name.
        salary_min: 150000,
        salary_max: 250000,
        must_haves: "Three years on a salon floor",
      }),
    });
    expect(onDrafted).toHaveBeenCalledWith(DRAFT);
  });

  it("has no accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = view();
    await screen.findByText("Question 1 of 10");
    expect(await axe(container)).toHaveNoViolations();
    // Again on a voice question: the mic and the box it fills are the one
    // control pair here that `Field` could not name on its own.
    await user.type(screen.getByLabelText("Your answer"), "Senior Stylist");
    for (let i = 0; i < 3; i++) await forward(user);
    expect(await axe(container)).toHaveNoViolations();
  });

  describe("when the tenant runs several companies", () => {
    beforeEach(() => intakeQuestions.mockResolvedValue(MULTI));

    it("asks which one first, and counts the question", async () => {
      view();
      expect(await screen.findByText("Which company is hiring?")).toBeInTheDocument();
      expect(screen.getByText("Question 1 of 11")).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: /progress/i })).toHaveAttribute(
        "aria-valuemax",
        "11",
      );
    });

    it("will not move on until one is chosen", async () => {
      const user = userEvent.setup();
      view();
      expect(await screen.findByRole("button", { name: "Skip" })).toBeDisabled();
      await pickCompany(user, "JBS Praxis Nigeria");
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("labels the salary in the chosen company's currency, not the fallback", async () => {
      const user = userEvent.setup();
      view();
      await pickCompany(user, "JBS Praxis Nigeria");
      await forward(user); // → title
      await user.type(screen.getByLabelText("Your answer"), "Senior Stylist");
      for (let i = 0; i < 5; i++) await forward(user); // → salary

      // XAF is what the server sent as the pre-answer fallback. The pick wins.
      expect(screen.getByLabelText("From (NGN/month)")).toBeInTheDocument();
      expect(screen.queryByLabelText("From (XAF/month)")).not.toBeInTheDocument();
      expect(screen.getByText(/JBS Praxis Nigeria/)).toBeInTheDocument();
    });

    it("sends the chosen company with the follow-ups and the draft", async () => {
      const user = userEvent.setup();
      view();
      await pickCompany(user, "JBS Praxis Nigeria");
      await forward(user);
      await answerFixedSet(user);
      await forward(user); // → the last follow-up
      await user.click(
        await screen.findByRole("button", { name: /Draft the whole vacancy with AI/ }),
      );

      expect(intakeFollowUps).toHaveBeenCalledWith(
        expect.objectContaining({ entity_id: "e2" }),
      );
      expect(draftVacancy).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_id: "e2",
          answers: expect.objectContaining({ entity_id: "e2", title: "Senior Stylist" }),
        }),
      );
    });
  });

  it("offers the blank form from the first card", async () => {
    const user = userEvent.setup();
    const { onBlankForm } = view();
    await user.click(
      await screen.findByRole("button", {
        name: /Skip the questions — start from a blank form/,
      }),
    );
    expect(onBlankForm).toHaveBeenCalled();
  });
});
