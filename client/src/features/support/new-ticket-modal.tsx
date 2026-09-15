/**
 * "Raise a ticket" — the tenant→Praxis entry point (PRD §11.2).
 *
 * LIVES OUTSIDE the Support page on purpose: the icon rail and the touch
 * cluster open it from ANY screen (the whole point of the revamp — feedback
 * must be one tap away, not a navigation), so the page is just one caller,
 * not the owner. `openRaiseTicket()` in raise-ticket-bus.ts is the one door;
 * GlobalRaiseTicket renders the modal once.
 *
 * G8 CONTEXT RIDE-ALONG (meeting §11.16) — "Need help? Send this to your
 * system admin": every part of buildTicketContext() is independently guarded
 * and never throws. Triage starts with what the user saw — the page, the last
 * client error — not a bare "it's broken".
 *
 * SCREENSHOTS, two-stage like every upload in this app (CLAUDE.md rule 3):
 * FilePicker + UploadList driven by useUpload, upload-on-pick. Each image goes
 * up through the engine (preview, percentage, compression, profile "document"
 * so the screen keeps matching the screen) to its own request, and the create
 * call links the ids. The picker is capped at five; a cancelled form leaves
 * orphans that the server reaps, not attachments on a stranger's ticket.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { ErrorState } from "@/components/ui/states";
import { errMsg, } from "@/lib/use-resource";
import { useUpload } from "@/lib/use-upload";
import {
  createTicket,
  uploadTicketImage,
  KIND_OPTIONS,
  type TicketKind,
  type TicketAttachment,
  type TicketContext,
} from "./support-api";

/**
 * G8 — snapshot the current app context onto a support ticket. Every part is
 * independently guarded and never throws: triage gets what is available and
 * a missing piece must not sink the ticket. Includes the last client error
 * the global error-reporting captured (route + message + stack), the page the
 * user was on, and static browser facts.
 */
function buildTicketContext(): TicketContext {
  const ctx: TicketContext = {
    captured_at: new Date().toISOString(),
    route: typeof window !== "undefined" ? window.location.pathname : null,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  };
  try {
    const last = (window as unknown as {
      __praxisLastClientError?: {
        message: string;
        route?: string;
        stack?: string;
        kind?: string;
        at?: string;
      };
    }).__praxisLastClientError;
    if (last) {
      ctx.last_error = {
        message: String(last.message || "").slice(0, 500),
        route: last.route || null,
        kind: last.kind || "render",
        at: last.at || null,
        stack: last.stack ? String(last.stack).slice(0, 2000) : null,
      };
    }
  } catch {
    /* @silent:parse context capture is best-effort — a broken
       __praxisLastClientError must never sink the ticket. */
  }
  return ctx;
}

const MAX_SCREENSHOTS = 5;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export function NewTicketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [kind, setKind] = React.useState<TicketKind>("SUPPORT");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const upload = useUpload<TicketAttachment>({
    profile: "document",
    multiple: true,
    maxBytes: MAX_SCREENSHOT_BYTES,
    send: uploadTicketImage,
  });

  // The engine has no count cap — a picker can hand over ten at once, and the
  // ticket carries five. Slicing here is the cap; the rest never leave the
  // form (and never upload, because pick is the door).
  const cappedPick = React.useCallback(
    (files: FileList | null) => {
      const room = MAX_SCREENSHOTS - upload.items.length;
      if (room <= 0) return;
      const list = Array.from(files || []);
      void upload.pick(list.slice(0, room));
    },
    [upload],
  );

  // The ids that actually made it to the server — the create call links them.
  const attachmentIds = upload.items
    .filter((it) => it.state === "success" && it.result?.attachment_id)
    .map((it) => it.result!.attachment_id);
  const uploading = upload.items.some(
    (it) => it.state === "compressing" || it.state === "uploading",
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createTicket({
        kind,
        title: title.trim(),
        body: body.trim(),
        // G8 — the Pixie Girl model (meeting §11.16): the route + last client
        // error (ErrorBoundary/window.onerror/unhandledrejection) are already
        // collected by lib/error-reporting; snapshot them so triage starts
        // with what the user saw.
        context: buildTicketContext(),
        attachmentIds,
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Raise a ticket")}
      description="Reach the Praxis team directly — ask for help, report a bug, or request a feature."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Type")} required>
          <Select value={kind} onChange={(e) => setKind(e.target.value as TicketKind)}>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Summary")} required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="One line describing it"
            maxLength={200}
          />
        </Field>
        <Field
          label={tr("Details")}
          hint="What happened, what you expected, where in the app (optional)."
        >
          <Textarea
            className="min-h-[110px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add any detail that would help us…"
            maxLength={5000}
          />
        </Field>
        <FilePicker
          onPick={cappedPick}
          accept="image/png,image/jpeg,image/webp,image/gif"
          label={tr("Screenshots")}
          hint={`Show us the screen — up to ${MAX_SCREENSHOTS} images, 10 MB each.`}
          multiple
          disabled={upload.items.length >= MAX_SCREENSHOTS}
        />
        <UploadList
          items={upload.items}
          onRemove={upload.remove}
          onRetry={upload.retry}
        />
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={title.trim().length < 3 || busy || uploading}
          >
            {tr("Send to Praxis")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
