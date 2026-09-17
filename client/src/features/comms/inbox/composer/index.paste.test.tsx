import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Composer from "./index";

const { saveDraft, uploadAttachment, draftAttachments } = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  uploadAttachment: vi.fn(),
  draftAttachments: vi.fn(),
}));

vi.mock("@/lib/mail-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mail-api")>()),
  saveDraft,
  uploadAttachment,
  draftAttachments,
  listCommands: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/use-resource", () => ({
  useResource: () => ({ data: [], loading: false, error: null }),
}));

vi.mock("./use-editor", () => ({
  useComposerEditor: () => ({
    getText: () => "Hello",
    getHTML: () => "<p>Hello</p>",
    isEmpty: false,
    commands: {
      setContent: vi.fn(),
      focus: vi.fn(),
    },
    chain: () => ({
      focus: () => ({
        deleteRange: () => ({ insertContent: () => ({ run: vi.fn() }) }),
        insertContent: () => ({ run: vi.fn() }),
      }),
    }),
    view: { dom: document.createElement("div") },
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock("./editor", () => ({
  EditorSurface: () => <div data-testid="editor-surface" />,
}));

vi.mock("./toolbar", () => ({
  ComposerToolbar: () => <div data-testid="composer-toolbar" />,
  FontNote: () => <div data-testid="font-note" />,
}));

vi.mock("./slash-menu", () => ({
  SlashMenu: () => null,
}));

vi.mock("./attachment-tray", () => ({
  MAIL_ATTACHMENT_ACCEPT:
    "application/pdf,image/*,.doc,.docx,.xls,.xlsx,text/plain,text/csv",
  AttachmentTray: () => null,
  AttachButton: () => <div data-testid="attach-button" />,
}));

vi.mock("./recipient-field", () => ({
  RecipientField: ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      id={id}
      aria-label={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("./use-from-mailbox", () => ({
  useFromMailbox: (initial: string) => React.useState(initial),
}));

vi.mock("./offline-queue", () => ({
  newIdempotencyKey: () => "mail-key-1",
  rememberSend: vi.fn(),
  forgetSend: vi.fn(),
}));

vi.mock("@/components/ui/use-confirm", () => ({
  useConfirm: () => [vi.fn().mockResolvedValue(false), null],
}));

vi.mock("../work/assist", () => ({ AssistToolbar: () => null }));
vi.mock("../work/guardrails", () => ({ GuardrailBar: () => null }));
vi.mock("../work/use-guardrails", () => ({
  useGuardrails: () => ({ warnings: [], blocks: [] }),
}));
vi.mock("../work/use-thread-lock", () => ({
  useThreadLock: () => ({ heldByOther: null }),
}));
vi.mock("../work/use-recipient-health", () => ({
  useRecipientHealth: () => ({ hard: [], soft: [] }),
}));
vi.mock("../work/schedule", () => ({ SchedulePicker: () => null }));
vi.mock("../work/schedule-payload", () => ({
  schedulePayload: () => ({}),
}));

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

describe("mail composer paste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveDraft.mockResolvedValue({ email_draft_id: "draft-1" });
    uploadAttachment.mockResolvedValue(undefined);
    draftAttachments.mockResolvedValue({
      attachments: [],
      total_bytes: 0,
      limit_bytes: 25 * 1024 * 1024,
      offer_secure_link: false,
    });
  });

  it("attaches an accepted pasted file through the existing upload path", async () => {
    render(<Composer connectionId="conn-1" initialTo={["ops@example.com"]} />);

    fireEvent.paste(document.getElementById("composer-body")!, {
      clipboardData: clipboard(pdf()),
    });

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(uploadAttachment.mock.calls[0][0]).toMatchObject({
      name: "clip.pdf",
      type: "application/pdf",
    });
  });

  it("shows a composer-local error for a rejected pasted file type", async () => {
    render(<Composer connectionId="conn-1" initialTo={["ops@example.com"]} />);

    fireEvent.paste(document.getElementById("composer-body")!, {
      clipboardData: clipboard(exe()),
    });

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "That file type isn't accepted here — choose a file instead.",
      ),
    ).toBeInTheDocument();
  });
});
