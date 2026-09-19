/**
 * Listen-aloud and open-in-canvas → Markdown (audit G3).
 *
 * WHY THESE TWO SPECIFICALLY. G3 asks for regression cover on the three
 * affordances the review singled out as already good — listen-aloud, the canvas
 * download and table → xlsx — "so a refactor cannot silently break them". The
 * xlsx half already has `tests/unit/ai-export.test.js`, which is the one with a
 * server to test against. These two are browser-only and had none, and they are
 * the two that break QUIETLY: a voice that reads "asterisk asterisk Total" and
 * a download that saves the wrong extension both look fine in a screenshot, in
 * code review, and in every existing test.
 *
 * Both APIs are absent in jsdom, which is the point of stubbing them rather
 * than skipping: what is being asserted is the CALL the component makes, not
 * whether a browser can speak.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSpeech } from "@/components/ai/speech";
import { AiRightPane, EMPTY_PANE, type PaneState } from "./right-pane";

/* ───────────────────────────── listen aloud ───────────────────────────── */

class FakeUtterance {
  text: string;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function stubSpeech() {
  const spoken: FakeUtterance[] = [];
  const synth = {
    cancel: vi.fn(),
    speak: vi.fn((u: FakeUtterance) => spoken.push(u)),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return { synth, spoken };
}

/**
 * A one-button harness over the hook — the toolbar's contract, without it.
 *
 * Each test passes its OWN id. `speaking` is module-level on purpose (one
 * utterance app-wide, across two subtrees that both render answers), so it
 * survives a test's unmount; reusing one id would make each test start in the
 * state the previous one left, which is the module's design working, not a bug.
 */
function Speaker({ id, text }: { id: string; text: string }) {
  const { supported, speakingId, toggle } = useSpeech();
  if (!supported) return <p>unsupported</p>;
  return (
    <button type="button" onClick={() => toggle(id, text)}>
      {speakingId === id ? "Stop" : "Listen"}
    </button>
  );
}

describe("listen-aloud reads prose, not markup (G3)", () => {
  // UNMOUNT BEFORE UNSTUBBING. `useSpeech` cancels any utterance on the last
  // subscriber's unmount, so testing-library's automatic cleanup — which runs
  // in its own afterEach — would otherwise reach a `speechSynthesis` this hook
  // had already removed, and every test in this block would die in the commit
  // phase for a reason that has nothing to do with what it asserts.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("strips the markdown a voice would otherwise pronounce", async () => {
    const { spoken } = stubSpeech();
    const user = userEvent.setup();
    render(
      <Speaker
        id="t1"
        text="**Total revenue** is | 5,940,000 XAF | — see [SBX-2026-0001](/files/1)."
      />,
    );
    await user.click(screen.getByRole("button", { name: "Listen" }));

    const said = spoken[0].text;
    // The failure this guards is a voice saying "asterisk asterisk Total".
    expect(said).not.toMatch(/[*_`#>|]/);
    // A link reads as its label, not its URL.
    expect(said).toContain("SBX-2026-0001");
    expect(said).not.toContain("/files/1");
    // The figure survives intact — it is the thing being read out.
    expect(said).toContain("5,940,000 XAF");
  });

  it("does not read a code block aloud", async () => {
    const { spoken } = stubSpeech();
    const user = userEvent.setup();
    render(<Speaker id="code" text={"Here:\n```sql\nSELECT 1;\n```\nthat is all."} />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    expect(spoken[0].text).toContain("code omitted");
    expect(spoken[0].text).not.toContain("SELECT");
  });

  it("cancels the previous utterance before starting — never two at once", async () => {
    const { synth } = stubSpeech();
    const user = userEvent.setup();
    render(<Speaker id="cancel" text="first" />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("toggles off without speaking again", async () => {
    const { synth } = stubSpeech();
    const user = userEvent.setup();
    render(<Speaker id="toggle" text="hello" />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Listen" })).toBeTruthy();
  });

  it("renders nothing rather than a dead control where the API is absent", () => {
    // Firefox has no speech synthesis. A button that does nothing when pressed
    // is worse than an absent one: the user spends a try finding out.
    //
    // The key is DELETED rather than stubbed to undefined, because the real
    // check is `"speechSynthesis" in window` — stubbing it undefined leaves the
    // key present, reports supported, and then crashes on `.cancel`, which is
    // the opposite of what this asserts.
    const original = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
    try {
        render(<Speaker id="unsupported" text="hi" />);
      expect(screen.getByText("unsupported")).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(window, "speechSynthesis", original);
    }
  });
});

/* ────────────────────── open in canvas → Markdown ────────────────────── */

/** jsdom's Blob predates `.text()`; FileReader is what it does have. */
const readBlob = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });

const paneWith = (artifact: { title: string; text: string }): PaneState => ({
  ...EMPTY_PANE,
  tab: "canvas",
  output: { tables: [], artifact },
});

function mountPane(state: PaneState) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <AiRightPane state={state} onChange={() => {}} onClose={() => {}} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** The anchor the component built for this download. */
const lastAnchor = (): HTMLAnchorElement | null => {
  const spy = HTMLAnchorElement.prototype.click as unknown as {
    mock?: { contexts?: unknown[]; instances?: unknown[] };
  };
  const ctx = spy.mock?.contexts ?? spy.mock?.instances ?? [];
  const last = ctx[ctx.length - 1];
  return last instanceof HTMLAnchorElement ? last : null;
};

describe("open-in-canvas downloads real Markdown (G3)", () => {
  let clicked: HTMLAnchorElement | null = null;
  let revoked: string[] = [];
  let blobs: Blob[] = [];

  beforeEach(() => {
    clicked = null;
    revoked = [];
    blobs = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b: Blob | MediaSource) => {
      if (b instanceof Blob) blobs.push(b);
      return "blob:fake";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => {
      revoked.push(u);
    });
    // jsdom does not navigate on anchor.click(), so the element under test is
    // whichever anchor the component built. `mockImplementation` receives no
    // arguments here, so the anchor is read from the spy's call context via
    // `instances` rather than by aliasing `this`.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("saves a .md file named after the draft", async () => {
    const user = userEvent.setup();
    mountPane(paneWith({ title: "Reminder — SBX-2026-0001", text: "# Reminder\n\nPlease settle." }));
    await user.click(screen.getByRole("button", { name: /download/i }));

    clicked = lastAnchor();
    expect(clicked).not.toBeNull();
    // A draft saved as `draft.txt` is the silent regression here: it opens in
    // the wrong app and loses its formatting, and nothing throws.
    expect(clicked!.download).toMatch(/\.md$/);
    expect(clicked!.download).not.toBe(".md");
    expect(blobs[0].type).toContain("text/markdown");
  });

  it("writes the draft's own text, not the rendered HTML", async () => {
    const user = userEvent.setup();
    const text = "# Reminder\n\n| Invoice | Amount |\n| --- | --- |\n| SBX-1 | 100 |";
    mountPane(paneWith({ title: "Reminder", text }));
    await user.click(screen.getByRole("button", { name: /download/i }));
    // jsdom's Blob has no `.text()`, so read it the way a browser without it
    // would — the assertion is about the bytes, not the convenience method.
    await expect(readBlob(blobs[0])).resolves.toBe(text);
  });

  it("releases the object URL — a canvas is opened many times a session", async () => {
    const user = userEvent.setup();
    mountPane(paneWith({ title: "Memo", text: "body" }));
    await user.click(screen.getByRole("button", { name: /download/i }));
    expect(revoked).toContain("blob:fake");
  });

  it("falls back to a usable filename when the title has nothing to slug", async () => {
    const user = userEvent.setup();
    mountPane(paneWith({ title: "—", text: "body" }));
    await user.click(screen.getByRole("button", { name: /download/i }));
    expect(lastAnchor()!.download).toBe("draft.md");
  });
});
