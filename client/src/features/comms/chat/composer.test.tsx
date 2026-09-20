import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Composer } from "./composer";

const { pick } = vi.hoisted(() => ({ pick: vi.fn() }));

vi.mock("@/lib/use-upload", () => ({
  useUpload: () => ({
    busy: false,
    items: [],
    pick,
    reset: vi.fn(),
    remove: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock("@/lib/fab-floor", () => ({
  useFabFloor: vi.fn(),
}));

const { previewLink } = vi.hoisted(() => ({ previewLink: vi.fn() }));

vi.mock("@/lib/smartcomm-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/smartcomm-api")>()),
  getChannelDraft: vi.fn().mockResolvedValue(null),
  clearChannelDraft: vi.fn().mockResolvedValue(undefined),
  // Autosave runs on a timer after every change; leaving it real would put a fetch
  // to a nonexistent API into every test in this file.
  saveChannelDraft: vi.fn().mockResolvedValue(undefined),
  previewLink,
  // The composer's preview card asks for a picture the way a bubble's does. There
  // is none in these tests, and the card is designed to render without one.
  linkImageObjectUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/components/ui/image-upload", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/ui/image-upload")
  >();
  return {
    ...actual,
    FilePicker: ({
      openRef,
    }: {
      openRef?: React.MutableRefObject<(() => void) | null>;
    }) => {
      React.useEffect(() => {
        if (openRef) openRef.current = vi.fn();
      }, [openRef]);
      return null;
    },
    UploadList: () => null,
  };
});

vi.mock("./message-editor", () => ({
  MessageEditor: ({
    onChange,
  }: {
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Message body"
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("./composer-actions", () => ({
  ComposerActions: () => <div data-testid="composer-actions" />,
}));
vi.mock("./voice-recorder", () => ({ VoiceRecorder: () => null }));
vi.mock("./erp-card", () => ({ ErpCardView: () => null }));
vi.mock("./scheduled-messages", () => ({ ScheduledMessages: () => null }));
vi.mock("./message-format", () => ({ parseMessage: () => ({ content: [] }) }));

const pdf = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "clip.pdf", {
    type: "application/pdf",
  });

const exe = () =>
  new File([new Uint8Array([0x4d, 0x5a])], "clip.exe", {
    type: "application/octet-stream",
  });

const clipboard = (...files: File[]) => ({
  items: files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  })),
  files,
});

describe("chat composer paste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pick.mockResolvedValue(undefined);
  });

  it("routes an accepted pasted file through upload.pick", async () => {
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);

    fireEvent.paste(screen.getByRole("textbox", { name: "Message body" }), {
      clipboardData: clipboard(pdf()),
    });

    await waitFor(() => expect(pick).toHaveBeenCalledTimes(1));
    expect(pick).toHaveBeenCalledWith([
      expect.objectContaining({ name: "clip.pdf", type: "application/pdf" }),
    ]);
  });

  it("shows a local error when the pasted file type is not accepted", async () => {
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);

    fireEvent.paste(screen.getByRole("textbox", { name: "Message body" }), {
      clipboardData: clipboard(exe()),
    });

    expect(pick).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "That file type isn't accepted here — choose a file instead.",
      ),
    ).toBeInTheDocument();
  });
});

/**
 * The paste preview.
 *
 * The composer is the one place this feature waits for the third party, so what is
 * worth pinning is WHEN it asks and when it keeps its hands off: once per URL after
 * the typing stops, never for a draft nobody is editing, and never a second time
 * for the same link. The card itself is tested in `message-links.test.tsx`.
 */
describe("chat composer link preview", () => {
  const body = () => screen.getByRole("textbox", { name: "Message body" });
  const type = (text: string) => fireEvent.change(body(), { target: { value: text } });

  beforeEach(() => {
    vi.clearAllMocks();
    previewLink.mockResolvedValue({});
  });

  it("asks once for the link that was typed, and shows its card", async () => {
    previewLink.mockResolvedValue({
      url: "https://a.example/x",
      state: "OK",
      card: { url: "https://a.example/x", state: "OK", title: "A page about things", description: null, site_name: "a.example", image_src: null, icon_src: null, media: null, fetched_at: null, stale: false },
    });
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);
    type("here: https://a.example/x");
    await waitFor(() => expect(previewLink).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(previewLink).toHaveBeenCalledWith("https://a.example/x");
    expect(await screen.findByText("A page about things")).toBeInTheDocument();
    // More keystrokes on the same URL must not mean more fetches: the debounce is
    // per draft, and a request per character is a way to be blocked by the site.
    type("here: https://a.example/x, and that is all");
    await new Promise((r) => setTimeout(r, 900));
    expect(previewLink).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a message with no link in it", async () => {
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);
    type("the vessel is delayed two days");
    await new Promise((r) => setTimeout(r, 900));
    expect(previewLink).not.toHaveBeenCalled();
  });

  it("does not fetch for a draft it only restored — and does once it is edited", async () => {
    const commsApi = await import("@/lib/smartcomm-api");
    vi.mocked(commsApi.getChannelDraft).mockResolvedValueOnce({
      draft_id: "d1",
      body: "https://a.example/x",
    } as never);
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 900));
    // The reader opened a chat and found their own unfinished words. Fetching the
    // link in them would tell the destination site about a message that was never
    // sent, from a click that meant nothing of the kind.
    expect(previewLink).not.toHaveBeenCalled();
    // The other half, which is what makes the first half a rule rather than an
    // omission: the same URL, once the person touches it, is a live question and
    // gets its card.
    type("https://a.example/x ");
    await waitFor(() => expect(previewLink).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(previewLink).toHaveBeenCalledWith("https://a.example/x");
  });

  it("shows no card when the page had nothing to say", async () => {
    previewLink.mockResolvedValue({ url: "https://a.example/x", state: "EMPTY", card: null });
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);
    type("https://a.example/x");
    await waitFor(() => expect(previewLink).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(document.querySelector("[data-composer] .line-clamp-2")).toBeNull();
  });

  it("a fetch that fails leaves the draft alone", async () => {
    previewLink.mockRejectedValue(new Error("offline"));
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);
    type("https://a.example/x");
    await waitFor(() => expect(previewLink).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(body()).toHaveValue("https://a.example/x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The strip, not the card: the composer's preview must never be the full card,
  // because the full card is what used to push the input below the fold the
  // moment a URL was typed. What renders here is a one-line strip with an ✕, and
  // notably WITHOUT the card's "Open link" button — a control that opens a tab
  // has no business living above a half-written sentence.
  it("shows a dismissible strip, not the full card", async () => {
    previewLink.mockResolvedValue({
      url: "https://a.example/x",
      state: "OK",
      card: { url: "https://a.example/x", state: "OK", title: "A page about things", description: "More words about the things.", site_name: "a.example", image_src: null, icon_src: null, media: null, link_hash: null, fetched_at: null, stale: false },
    });
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);
    type("here: https://a.example/x");
    expect(await screen.findByText("A page about things")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open link/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();
  });

  it("✕ hides the strip for that link — and a different link earns a new one", async () => {
    previewLink.mockImplementation((url: string) =>
      Promise.resolve({
        url,
        state: "OK",
        card: { url, state: "OK", title: `Card for ${url}`, description: null, site_name: "a.example", image_src: null, icon_src: null, media: null, link_hash: null, fetched_at: null, stale: false },
      }),
    );
    render(<Composer channelId="channel-1" onSent={vi.fn()} />);
    type("https://a.example/x");
    expect(await screen.findByText("Card for https://a.example/x")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(screen.queryByText("Card for https://a.example/x")).toBeNull();
    // Still typing around the same link must not resurrect what was dismissed…
    type("https://a.example/x and some more words");
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByText("Card for https://a.example/x")).toBeNull();
    // …but a different URL is a different question, and gets a fresh strip.
    type("https://a.example/y");
    expect(await screen.findByText("Card for https://a.example/y")).toBeInTheDocument();
  });
});
