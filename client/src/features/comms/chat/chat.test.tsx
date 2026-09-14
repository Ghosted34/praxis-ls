/**
 * Smart Comms chat — the rendering decisions worth pinning.
 *
 * Not "does a bubble render text". The things that are invisible when right and
 * expensive when wrong: a restricted record card that leaks a figure, a
 * transcript state shown as the wrong sentence, a waveform downsample that
 * samples instead of averaging, and the forward path copying bytes it must not
 * copy.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ErpCardView } from "./erp-card";
import { VoiceNote } from "./voice-note";
import { downsample, clock } from "./audio-utils";
import { forwardableAttachments } from "./forward-attachments";
import { searchEmoji, withSkinTone, EMOJI_COUNT, CATEGORY_ORDER, EMOJI } from "@/lib/emoji-data";
import type { CommAttachment, CommMessage, ErpCard } from "@/lib/smartcomm-api";

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const FULL: ErpCard = {
  kind: "INVOICE", id: "inv-1", ref: "INV-2026-0041", title: "INV-2026-0041",
  subtitle: "Somaf SARL", status: "POSTED_LOCKED", amount: 1250000, currency: "XAF",
  date: "2026-08-26", url: "/finance/invoices/inv-1", redacted: false,
};

describe("ErpCardView — the restricted state is a render, not an error", () => {
  it("shows the figures to a permitted reader", () => {
    inRouter(<ErpCardView card={FULL} />);
    expect(screen.getByText("INV-2026-0041")).toBeInTheDocument();
    expect(screen.getByText("Somaf SARL")).toBeInTheDocument();
    expect(screen.getByText(/1[,\s]?250[,\s]?000/)).toBeInTheDocument();
  });

  it("renders the date day-first, never month-first", () => {
    // 26 August, not 8 August. A US-configured workstation renders
    // toLocaleDateString() month-first and the reader silently misreads it —
    // see CLAUDE.md and check:dates.
    inRouter(<ErpCardView card={FULL} />);
    expect(screen.getByText("26/08/2026")).toBeInTheDocument();
  });

  it("shows a redacted card the reference and NO figure", () => {
    const redacted: ErpCard = {
      ...FULL, amount: null, currency: null, status: null, subtitle: null,
      url: null, redacted: true,
    };
    inRouter(<ErpCardView card={redacted} />);
    expect(screen.getByText("INV-2026-0041")).toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
    expect(screen.queryByText(/1[,\s]?250[,\s]?000/)).not.toBeInTheDocument();
    // And no link: one that leads to a 403 reads as a bug, not a permission.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links a permitted card so the reader can open the record", () => {
    inRouter(<ErpCardView card={FULL} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/finance/invoices/inv-1");
  });

  it("says something true when the reference could not be resolved at all", () => {
    inRouter(<ErpCardView card={null} label="INV-2026-0041" />);
    expect(screen.getByText("INV-2026-0041")).toBeInTheDocument();
  });
});

describe("VoiceNote — four transcript states, four sentences", () => {
  const base: CommAttachment = {
    attachment_kind: "MEDIA", media_id: "m-1", media_kind: "AUDIO",
    is_voice_note: true, duration_ms: 8200, waveform: [10, 40, 80, 30],
  };

  it("shows the words when they are there", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "DONE", transcript: "Clear it through customs today" }} />);
    expect(screen.getByText("Clear it through customs today")).toBeInTheDocument();
  });

  it("says it is still working while PENDING", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "PENDING" }} />);
    expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
  });

  it("blames the workspace, not the clip, when no provider is configured", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "UNAVAILABLE" }} />);
    expect(screen.getByText(/isn't set up on this workspace/i)).toBeInTheDocument();
  });

  it("distinguishes a failure from silence", () => {
    const { rerender } = render(<VoiceNote attachment={{ ...base, transcript_status: "FAILED" }} />);
    expect(screen.getByText(/couldn't be transcribed/i)).toBeInTheDocument();
    rerender(<VoiceNote attachment={{ ...base, transcript_status: "DONE", transcript: null }} />);
    expect(screen.getByText(/no speech was found/i)).toBeInTheDocument();
  });

  it("shows the duration before anything has been played", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    expect(screen.getByText("0:08")).toBeInTheDocument();
  });

  it("does not fetch the clip until it is asked to play", () => {
    // A channel with forty voice notes must not pull forty clips down to draw
    // forty bars — the bars are already in the row.
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    expect(document.querySelector("audio")).toBeNull();
  });

  /**
   * ── THE BAR IS A PLAY CONTROL, AND IT SAYS SO ────────────────────────────
   *
   * The waveform is four times the area of the play button and is drawn as a
   * progress bar, so it is what a hand goes for. Its handler used to open with
   * `if (!el) return` against an <audio> that does not exist until the first
   * play — a silent, permanent no-op on the biggest target in the bubble, and
   * the whole of "voice notes not playing".
   *
   * jsdom cannot play audio, so what is pinned HERE is the accessible name —
   * the promise the control makes. That it actually starts the clip is pinned
   * in a real browser by `e2e/voice-note.spec.ts`, which is the only place a
   * media element does anything at all.
   */
  it("names the bar as a play control, not only as a scrubber", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    expect(
      screen.getByRole("button", { name: /play from a point in the voice note/i }),
    ).toBeInTheDocument();
  });

  /**
   * ── AN ATTACHMENT WITH NO CLIP SAYS SO ───────────────────────────────────
   *
   * `voice-recorder.tsx` sets the rule for this feature: "A mic button that
   * does nothing is the worst outcome — people press it again, and again, and
   * conclude the product is broken." The player broke it. With no `media_id`
   * there is nothing to fetch, and both controls used to return in silence.
   */
  it("says something when there is no clip behind the bubble", async () => {
    render(<VoiceNote attachment={{ ...base, media_id: undefined, transcript_status: "NONE" }} />);
    await userEvent.click(screen.getByRole("button", { name: /play voice note/i }));
    expect(screen.getByText(/no longer attached to the message/i)).toBeInTheDocument();
  });

  it("keeps a missing clip apart from a failed download", () => {
    // Two different problems needing two different responses: one is worth
    // retrying, the other never will be. Collapsing them into "couldn't load"
    // sends somebody hunting a network fault that is not there.
    render(<VoiceNote attachment={{ ...base, media_id: undefined, transcript_status: "NONE" }} />);
    expect(screen.queryByText(/Couldn't load that recording/i)).toBeNull();
  });
});

describe("waveform downsampling", () => {
  it("averages each bucket rather than sampling an instant", () => {
    // Sampling every nth reading of speech is as likely to land in a gap
    // between words as in a word.
    expect(downsample([0, 100, 0, 100], 2)).toEqual([50, 50]);
  });

  it("returns the input when there is less of it than there are buckets", () => {
    expect(downsample([10, 20], 8)).toEqual([10, 20]);
  });

  it("is empty for an empty recording", () => {
    expect(downsample([], 48)).toEqual([]);
  });

  it("always produces exactly the number of buckets asked for", () => {
    expect(downsample(Array.from({ length: 7213 }, (_, i) => i % 100), 48)).toHaveLength(48);
  });
});

describe("clock", () => {
  it("renders mm:ss with a padded seconds field", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(8200)).toBe("0:08");
    expect(clock(65_000)).toBe("1:05");
    expect(clock(120_000)).toBe("2:00");
  });
});

describe("forwarding carries pointers, never bytes", () => {
  const message: CommMessage = {
    message_id: "m-1", group_id: "g-1",
    attachments: [
      { attachment_kind: "MEDIA", media_id: "med-1", media_kind: "IMAGE", original_name: "quay.jpg" },
      { attachment_kind: "VAULT", vault_id: "doc-1", filename: "declaration.pdf" },
      { attachment_kind: "ERP", erp_kind: "INVOICE", erp_id: "inv-1", erp_label: "INV-2026-0041" },
    ],
  };

  it("re-points at the same media row and the same vault document", () => {
    // Copying the bytes would give the copy a different content_hash, so a
    // vault document forwarded into a second channel would stop verifying
    // against the signature taken over the original.
    const out = forwardableAttachments(message);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ attachment_kind: "MEDIA", media_id: "med-1" });
    expect(out[1]).toMatchObject({ attachment_kind: "VAULT", vault_id: "doc-1" });
  });

  it("forwards an ERP reference as a reference, so the new reader's rights apply", () => {
    const out = forwardableAttachments(message);
    expect(out[2]).toMatchObject({ attachment_kind: "ERP", erp_kind: "INVOICE", erp_id: "inv-1" });
    // No amount rides along — there is nothing here for the new channel to read
    // that their own permissions would not already allow.
    expect(out[2]).not.toHaveProperty("amount");
  });

  it("drops an attachment with no target rather than posting a broken pointer", () => {
    const broken: CommMessage = {
      message_id: "m-2", group_id: "g-1",
      attachments: [{ attachment_kind: "MEDIA" }, { attachment_kind: "ERP", erp_kind: "INVOICE" }],
    };
    expect(forwardableAttachments(broken)).toEqual([]);
  });
});

describe("the emoji set", () => {
  it("ranks a name prefix above a keyword match anywhere", () => {
    // Typing "th" must reach 👍 before 🌡️ — people type the first letters of
    // the thing they want.
    const [first] = searchEmoji("thumbs");
    expect(first.e).toBe("👍");
  });

  it("matches keywords, not only names", () => {
    expect(searchEmoji("invoice").some((e) => e.e === "🧾")).toBe(true);
    expect(searchEmoji("shipment").some((e) => e.e === "📦")).toBe(true);
  });

  it("applies a skin tone only where one is valid", () => {
    const thumbsUp = { e: "👍", n: "thumbs up", k: [], t: true };
    const parcel = { e: "📦", n: "package", k: [] };
    expect(withSkinTone(thumbsUp, 3)).toBe("👍\u{1F3FD}");
    expect(withSkinTone(thumbsUp, 0)).toBe("👍");
    // Appending a modifier to a glyph that takes none produces a broken
    // sequence, so it must come back untouched.
    expect(withSkinTone(parcel, 3)).toBe("📦");
  });

  it("has no empty category, which a bad merge would leave behind", () => {
    for (const c of CATEGORY_ORDER) expect(EMOJI[c].length).toBeGreaterThan(20);
    expect(EMOJI_COUNT).toBeGreaterThan(400);
  });

  it("has no duplicate glyph, which would render two identical grid cells", () => {
    const all = CATEGORY_ORDER.flatMap((c) => EMOJI[c].map((e) => e.e));
    expect(new Set(all).size).toBe(all.length);
  });
});
