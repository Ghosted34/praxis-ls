/**
 * Smart Comms chat — the rendering decisions worth pinning.
 *
 * Not "does a bubble render text". The things that are invisible when right and
 * expensive when wrong: a restricted record card that leaks a figure, a
 * transcript state shown as the wrong sentence, a waveform downsample that
 * samples instead of averaging, and the forward path copying bytes it must not
 * copy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ErpCardView } from "./erp-card";
import { VoiceNote } from "./voice-note";
import { downsample, clock } from "./audio-utils";
import { sniffContainer, describeClip, isAudioContainer } from "./clip-source";
import { forwardableAttachments } from "./forward-attachments";
import { searchEmoji, withSkinTone, EMOJI_COUNT, CATEGORY_ORDER, EMOJI } from "@/lib/emoji-data";
import * as commsApi from "@/lib/smartcomm-api";
import type { CommAttachment, CommMessage, ErpCard, TranscriptStatus } from "@/lib/smartcomm-api";

/**
 * Only the one call is faked, and everything else in the module stays real.
 *
 * `transcribeMedia` is the whole of the change under test: transcription used
 * to happen to every clip on upload and is now a request one reader makes.
 * What the four states MEAN is therefore what the server answered to a press,
 * not what the thread row happened to carry — so the press is what the tests
 * drive, and the answer is what they set.
 */
vi.mock("@/lib/smartcomm-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/smartcomm-api")>()),
  transcribeMedia: vi.fn(),
  mediaBlob: vi.fn(),
}));
const transcribeMedia = vi.mocked(commsApi.transcribeMedia);
const mediaBlob = vi.mocked(commsApi.mediaBlob);

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

describe("VoiceNote — the words are asked for, and every state is a sentence", () => {
  const base: CommAttachment = {
    attachment_kind: "MEDIA", media_id: "m-1", media_kind: "AUDIO",
    is_voice_note: true, duration_ms: 8200, waveform: [10, 40, 80, 30],
  };

  /**
   * A BLOCK body, and it matters: `beforeEach(() => spy.mockClear())` returns
   * the spy, vitest treats a function returned from a hook as that hook's
   * teardown, and so it CALLS THE SPY after every test. With a throwing
   * implementation still installed that is an unhandled rejection with no
   * stack of its own — it lands on whichever test is running when the tick
   * comes, which is how one deliberate failure case reported as five unrelated
   * red tests whose own assertions had all passed.
   */
  beforeEach(() => {
    transcribeMedia.mockReset();
  });

  /** Press Transcribe — the only way any of these states reach the screen. */
  const reveal = () =>
    userEvent.click(screen.getByRole("button", { name: /transcribe|show transcript/i }));

  /**
   * ── NOT AUTOMATIC, WHICH IS THE WHOLE POINT ──────────────────────────────
   *
   * Every clip used to go to the provider the moment it landed: a bill per
   * clip, and a copy of a private conversation leaving the tenant, paid on the
   * guess that somebody would read it. Nothing is sent and nothing is shown
   * until a reader presses the button — including words another reader has
   * already paid for, which are revealed rather than re-fetched.
   */
  it("shows no transcript at all until somebody asks for one", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "DONE", transcript: "Clear it through customs today" }} />);
    expect(screen.queryByText("Clear it through customs today")).toBeNull();
    expect(screen.getByRole("button", { name: /show transcript/i })).toBeInTheDocument();
  });

  it("shows the words when they are there and the reader asks", async () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "DONE", transcript: "Clear it through customs today" }} />);
    await reveal();
    expect(screen.getByText("Clear it through customs today")).toBeInTheDocument();
  });

  it("sends nothing to the provider until the button is pressed", async () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    expect(transcribeMedia).not.toHaveBeenCalled();
    transcribeMedia.mockResolvedValue({ media_id: "m-1", transcript: "Deux conteneurs", transcript_status: "DONE" });
    await reveal();
    expect(transcribeMedia).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Deux conteneurs")).toBeInTheDocument();
  });

  /**
   * The language is SENT, not guessed. Whisper detects on its own and is good
   * at it on a clean thirty-second clip; on a five-second one with a forklift
   * behind it, its failure mode is a fluent translation into the language it
   * picked — which reads as a confident instruction that nobody gave.
   */
  it("tells the provider which language to expect", async () => {
    transcribeMedia.mockResolvedValue({ media_id: "m-1", transcript: "", transcript_status: "DONE" });
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    await userEvent.click(screen.getByRole("button", { name: /language of this recording/i }));
    await reveal();
    expect(transcribeMedia).toHaveBeenCalledWith("m-1", "fr");
  });

  it("says it is still working while the provider is answering", async () => {
    let answer: (r: { media_id: string; transcript: string | null; transcript_status: TranscriptStatus }) => void = () => {};
    transcribeMedia.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    await reveal();
    expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
    // Settled before the test ends: a promise left hanging keeps the component
    // mid-update and the teardown waits on it.
    answer({ media_id: "m-1", transcript: "later", transcript_status: "DONE" });
    expect(await screen.findByText("later")).toBeInTheDocument();
  });

  it("blames the workspace, not the clip, when no provider is configured", async () => {
    transcribeMedia.mockResolvedValue({ media_id: "m-1", transcript: null, transcript_status: "UNAVAILABLE" });
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    await reveal();
    expect(await screen.findByText(/isn't set up on this workspace/i)).toBeInTheDocument();
  });

  /**
   * ── AND THEN OFFERS THE ONE ENGINE THAT NEEDS NO KEY ─────────────────────
   *
   * "Nobody configured a provider" was the end of the road. The reader's own
   * browser ships a recogniser, so it is offered — and the offer says what
   * pressing it will do, because what it does is audible in the room.
   * jsdom has no `SpeechRecognition`, which is the branch pinned here: an
   * absent API must produce a sentence, never a dead button.
   */
  it("says which browsers can stand in when this one cannot", async () => {
    transcribeMedia.mockResolvedValue({ media_id: "m-1", transcript: null, transcript_status: "UNAVAILABLE" });
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    await reveal();
    expect(await screen.findByText(/no speech recognition/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /let this browser listen/i })).toBeNull();
  });

  it("offers a language for the clip, because guessing it produces fluent nonsense", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    expect(screen.getByRole("button", { name: /language of this recording/i })).toBeInTheDocument();
  });

  it("distinguishes a failure from silence", async () => {
    transcribeMedia.mockResolvedValue({ media_id: "m-1", transcript: null, transcript_status: "FAILED" });
    const { unmount } = render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    await reveal();
    expect(await screen.findByText(/couldn't be transcribed/i)).toBeInTheDocument();
    unmount();

    transcribeMedia.mockResolvedValue({ media_id: "m-1", transcript: null, transcript_status: "DONE" });
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    await reveal();
    expect(await screen.findByText(/no speech was found/i)).toBeInTheDocument();
  });

  /** A network drop is not a provider that answered badly, but the reader's
   *  next move is the same one — so it gets the same sentence rather than an
   *  unhandled rejection and a button that stays on "Transcribing…". */
  it("does not sit on a spinner when the request itself never lands", async () => {
    // Thrown SYNCHRONOUSLY rather than returned as a rejected promise, which
    // `await` inside the component's `try` catches just the same. A vi.fn()
    // that returns a rejection leaves vitest's own result bookkeeping holding
    // a derived promise nobody handles, and the unhandled-rejection it reports
    // lands on whichever test happens to be running when the tick comes — the
    // component's catch had run correctly all along.
    transcribeMedia.mockImplementation(() => { throw new Error("offline"); });
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    await reveal();
    expect(await screen.findByText(/couldn't be transcribed/i)).toBeInTheDocument();
  });

  it("shows the duration before anything has been played", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    expect(screen.getByText("0:08")).toBeInTheDocument();
  });

  /**
   * ── THE ELEMENT EXISTS FROM THE FIRST RENDER; THE BYTES DO NOT ───────────
   *
   * Two claims that used to be one, and conflating them is what broke iOS. The
   * <audio> was rendered only once the clip had been fetched, so the first
   * press had nothing to act on and the `play()` that followed the fetch was
   * outside the gesture WebKit requires. The element is mounted up front with
   * no `src` — so the press has something to `load()`, and a channel with
   * forty voice notes still pulls down none of them.
   */
  it("mounts the player before the clip, and fetches nothing to draw the bar", () => {
    render(<VoiceNote attachment={{ ...base, transcript_status: "NONE" }} />);
    const el = document.querySelector("audio");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("src")).toBeNull();
  });

  /**
   * ── SECONDARY TEXT SITS ON THE PLAYER'S OWN SURFACE, NOT A RAW ACCENT ─────
   *
   * The old hazard was `--muted-foreground` on a solid `bg-primary` bubble —
   * 2.39:1 in light, 1.01:1 in dark, invisible. Bubbles are tinted SURFACES
   * now, but the guarantee this pins is unchanged and cheap to keep: every
   * `--muted-foreground` element in the player sits inside the player's own
   * `.voice-wave` ground, never loose on the bubble's tint.
   */
  it("keeps secondary text on the player's own surface ground", () => {
    const { container } = render(
      <VoiceNote attachment={{ ...base, transcript_status: "NONE" }} tone="primary" />,
    );
    const onFill = container.querySelectorAll(".text-muted-foreground, .text-ink-3");
    for (const el of onFill) expect(el.closest(".voice-wave")).not.toBeNull();
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

/**
 * ── THE SNIFF, AND THE WEEKS IT WOULD HAVE SAVED ────────────────────────────
 *
 * "This browser can't play this recording" was reported over and over against
 * a player that plays. The recorder, multer, the storage driver, the
 * controller's headers, the blob: URL and the service worker were each proved
 * sound end to end — and none of that could see WHICH BYTES the failing
 * install received, because an object URL is opaque and `res.ok` is true for a
 * 200 whose body is the SPA shell.
 *
 * These pin the identification itself, because it is what turns the next
 * report from "it says it can't play" into a cause.
 */
describe("what actually came back", () => {
  const head = (...bytes: number[]) => new Uint8Array(bytes);
  const text = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

  it("knows the containers this product can produce", () => {
    expect(sniffContainer(head(0x1a, 0x45, 0xdf, 0xa3))).toBe("webm");
    expect(sniffContainer(text("OggS"))).toBe("ogg");
    expect(sniffContainer(text("\0\0\0 ftypM4A "))).toBe("mp4");
    expect(sniffContainer(text("RIFF....WAVE"))).toBe("wav");
    expect(sniffContainer(text("ID3"))).toBe("mp3");
    expect(sniffContainer(head(0xff, 0xfb, 0x90, 0x00))).toBe("mp3");
  });

  /**
   * THE ONE THAT MATTERS. An auth redirect, a proxy rule or a route that
   * stopped matching answers 200 with the app's own index.html under whatever
   * Content-Type the database column claimed. Handed to <audio> that is a
   * decode error, and a decode error accuses the reader's browser — the one
   * place the answer cannot be.
   */
  it("tells a web page and an error envelope apart from audio", () => {
    expect(sniffContainer(text("<!doctype html><html>"))).toBe("page");
    expect(sniffContainer(text("   \n<!doctype html>"))).toBe("page");
    expect(sniffContainer(text('{"error":{"code":"NOT_FOUND"}}'))).toBe("payload");
    expect(sniffContainer(new Uint8Array())).toBe("empty");
    expect(isAudioContainer("page")).toBe(false);
    expect(isAudioContainer("webm")).toBe(true);
  });

  it("describes the response in terms somebody can act on", () => {
    expect(
      describeClip({ url: null, container: "page", declaredType: "audio/webm", bytes: 4096, loading: false, error: false }),
    ).toMatch(/audio\/webm header, but the body is a web page/);
    expect(
      describeClip({ url: null, container: "webm", declaredType: "audio/webm", bytes: 38456, loading: false, error: false }),
    ).toBe("audio/webm · webm · 38 KB");
    expect(
      describeClip({ url: null, container: "empty", declaredType: "audio/webm", bytes: 0, loading: false, error: false }),
    ).toBe("audio/webm, empty response");
  });
});

describe("VoiceNote blames the right party for a response that is not audio", () => {
  const notAudioBase: CommAttachment = {
    attachment_kind: "MEDIA", media_id: "m-1", media_kind: "AUDIO",
    is_voice_note: true, duration_ms: 8200, waveform: [10, 40, 80, 30],
  };

  beforeEach(() => {
    mediaBlob.mockReset();
  });

  it("says it is the deployment, not the browser, and prints what arrived", async () => {
    // A 200 carrying the SPA shell under an audio Content-Type: exactly what a
    // stale proxy rule or an auth redirect produces.
    mediaBlob.mockResolvedValue(
      new Blob(["<!doctype html><html><body>app shell</body></html>"], { type: "audio/webm" }),
    );
    render(<VoiceNote attachment={{ ...notAudioBase, transcript_status: "NONE" }} />);
    await userEvent.click(screen.getByRole("button", { name: /play voice note/i }));

    expect(await screen.findByText(/for your administrator, not you/i)).toBeInTheDocument();
    expect(screen.getByText(/body is a web page/i)).toBeInTheDocument();
    // The sentence that sent people hunting the wrong fault must NOT appear.
    expect(screen.queryByText(/This browser can't play this recording/i)).toBeNull();
  });

  /**
   * THE FAULT THAT COST MONTHS, now a sentence.
   *
   * `img-src` carried `blob:` and `media-src` was never written down, so CSP
   * fell back to `default-src 'self'` and blocked every <audio> in the product
   * while the recorder, the upload, the storage, the headers, the object URL
   * and the service worker were each provably fine. A blocked element fires
   * `error` with code 4 — the same code as a missing codec — so the bubble
   * accused the reader's browser. The browser does say which directive
   * refused, once, and this is that being heard.
   */
  it("names a policy refusal instead of accusing the browser", async () => {
    mediaBlob.mockResolvedValue(
      new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])], { type: "audio/webm" }),
    );
    render(<VoiceNote attachment={{ ...notAudioBase, transcript_status: "NONE" }} />);
    await userEvent.click(screen.getByRole("button", { name: /^play voice note$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^play voice note$/i })).not.toBeDisabled(),
    );

    // What Chrome dispatches when the policy blocks a blob: media source.
    const violation = new Event("securitypolicyviolation") as Event & {
      blockedURI: string;
      violatedDirective: string;
      effectiveDirective: string;
    };
    violation.blockedURI = "blob:https://smartls.praxisls.com/45a9e4da";
    violation.violatedDirective = "media-src";
    violation.effectiveDirective = "media-src";
    document.dispatchEvent(violation);

    expect(await screen.findByText(/security policy blocked the recording/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked by media-src/i)).toBeInTheDocument();
    expect(screen.queryByText(/This browser can't play this recording/i)).toBeNull();
  });

  it("keeps a real audio container on the browser's side of the line", async () => {
    mediaBlob.mockResolvedValue(
      new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])], { type: "audio/webm" }),
    );
    render(<VoiceNote attachment={{ ...notAudioBase, transcript_status: "NONE" }} />);
    await userEvent.click(screen.getByRole("button", { name: /play voice note/i }));

    // The play button is disabled only while the bytes are in flight, so it
    // coming back is the observable moment the verdict about them would have
    // been rendered if one were going to be. jsdom implements no media stack,
    // so waiting on the <audio> itself would wait forever.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^play voice note$/i })).not.toBeDisabled(),
    );
    // jsdom has no media stack, so nothing plays. What is pinned here is that
    // valid audio is NOT accused of being a deployment fault.
    expect(screen.queryByText(/for your administrator/i)).toBeNull();
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
