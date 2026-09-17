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

vi.mock("@/lib/smartcomm-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/smartcomm-api")>()),
  getChannelDraft: vi.fn().mockResolvedValue(null),
  clearChannelDraft: vi.fn().mockResolvedValue(undefined),
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
