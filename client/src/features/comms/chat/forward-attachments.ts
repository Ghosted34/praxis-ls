/**
 * An existing message's attachments, in the shape a NEW post takes.
 *
 * Its own module, not `forward-dialog.tsx`: a file exporting both a component
 * and a plain function breaks Fast Refresh, and this is also what the tests
 * reach for without mounting a dialog.
 *
 * ── POINTERS, NEVER BYTES ─────────────────────────────────────────────────
 *
 * The forwarded message points at the SAME `comms_media` row and the same vault
 * document. Copying the bytes would double the storage for every forward and,
 * worse, give the copy a different `content_hash` — so a vault document
 * forwarded into a second channel would no longer verify against the signature
 * taken over the original. `document_verification` compares exactly those two.
 *
 * An ERP reference forwards as a reference, which is the whole reason it is one:
 * the reader in the new channel resolves it against THEIR permissions, so
 * forwarding an invoice card into a channel of people who cannot see invoices
 * shows them the number and no figures.
 */
import type { CommMessage, PostedAttachment } from "@/lib/smartcomm-api";

export function forwardableAttachments(message: CommMessage): PostedAttachment[] {
  return (message.attachments || [])
    .map((a): PostedAttachment | null => {
      if (a.attachment_kind === "MEDIA" && a.media_id) {
        return {
          attachment_kind: "MEDIA",
          media_id: a.media_id,
          kind: a.media_kind || undefined,
          filename: a.original_name || a.filename,
          content_type: a.content_type || undefined,
          size_bytes: a.size_bytes || undefined,
          is_voice_note: !!a.is_voice_note,
        };
      }
      if (a.attachment_kind === "ERP" && a.erp_kind && a.erp_id) {
        return {
          attachment_kind: "ERP",
          erp_kind: a.erp_kind,
          erp_id: a.erp_id,
          erp_label: a.erp_label,
        };
      }
      if (a.attachment_kind === "VAULT" && a.vault_id) {
        return {
          attachment_kind: "VAULT",
          vault_id: a.vault_id,
          filename: a.filename,
          content_type: a.content_type || undefined,
          size_bytes: a.size_bytes || undefined,
        };
      }
      return null;
    })
    .filter((a): a is PostedAttachment => a !== null);
}
