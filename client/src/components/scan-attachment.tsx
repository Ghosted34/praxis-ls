/**
 * ScanAttachment — the one control for putting a PDF or a photograph behind a
 * record, and for opening it again afterwards.
 *
 * WHY IT IS SHARED. Every master-data register keeps documents as two separate
 * things: the RECORD (type, number, issuing authority, expiry — what the
 * renewals engine reads) and the FILE (the scan itself, which lives in the
 * document vault, MOD-64). The record can exist without the file; that is
 * deliberate, since refusing to register a certificate you are holding because
 * it has not been scanned yet is how a register ends up incomplete.
 *
 * What was NOT deliberate is that the attaching half only existed on corporate
 * entities, hand-rolled inline, and the opening half only existed in the
 * document viewer. Clients and suppliers had a Scan column that could only ever
 * read PENDING, because nothing in the product could give a party document a
 * `vault_id` — the API accepted one the whole time (`_shared/nested.js` even
 * advances PENDING → SCANNED the moment it lands).
 *
 * The upload is two calls and always will be: the vault owns the bytes, hashes
 * them and audits them, and the document record only points at the result. This
 * component does the first call and hands back the id; the caller patches it
 * onto its own record, because only the caller knows what that record is.
 */
import * as React from "react";
import * as api from "@/lib/masterdata-api";
import {
  SCAN_ACCEPT,
  openVaultDoc,
  scanFileProblem,
} from "@/lib/vault-file";
import { errMsg } from "@/lib/use-resource";
import { FilePicker } from "@/components/ui/image-upload";
import { useUpload } from "@/lib/use-upload";

const linkCls =
  "text-sm text-primary-ink underline underline-offset-2 hover:opacity-80 disabled:opacity-50";

export function ScanAttachment({
  vaultId,
  docType,
  entityRef,
  onAttached,
  onError,
  disabled,
  labelWhenEmpty = "Attach scan",
}: {
  /** The vault id already on the record, if it has been scanned. */
  vaultId?: string | null;
  /**
   * The vault's own doc type — NOT the master-data document type.
   *
   * These two are easy to conflate and the difference has teeth: reading a
   * vaulted file is gated on the module that owns its `doc_type`
   * (`moduleKeyForDocType`), and anything unregistered falls back to MOD-70,
   * the Settings grant. Passing a party document type code like
   * "TAX_CLEARANCE" through here would therefore file the scan under a type the
   * vault has never heard of and demand Settings to open it. Pass the
   * registered owner code — ENTITY_DOCUMENT, CLIENT_DOCUMENT,
   * SUPPLIER_DOCUMENT — and let the record keep its own type.
   */
  docType: string;
  /** `<table>:<id>` of the record the file belongs to, so a file found from the
   *  vault side can be traced back to its owner. */
  entityRef: string;
  /** Patch the returned vault id onto the record. Awaited — the row is not
   *  refreshed until it resolves. */
  onAttached: (vaultId: string) => void | Promise<void>;
  /** Called with the message when something fails, and with `null` when a fresh
   *  attempt starts — so a stale error does not outlive the retry that fixed it. */
  onError?: (message: string | null) => void;
  disabled?: boolean;
  labelWhenEmpty?: string;
}) {
  const [busy, setBusy] = React.useState<"upload" | "open" | null>(null);

  /**
   * Through the engine, so this control compresses and previews like every
   * other upload. It keeps its own inline shape — it lives in a table row, and
   * a dropzone there would be absurd — which is what FilePicker's
   * variant="inline" is for.
   *
   * `profile: "document"`: these are certificate and licence scans, so they are
   * downscaled and re-encoded but never tonally corrected.
   */
  const upload = useUpload<{ doc_id: string }>({
    profile: "document",
    send: (file, ctx) =>
      api.uploadVaultFile(
        file,
        { doc_type: docType, entity_ref: entityRef, original_name: file.name },
        ctx,
      ),
    onAllComplete: async ([vaulted]) => {
      if (vaulted) await onAttached(vaulted.doc_id);
    },
  });

  const item = upload.items[0] ?? null;

  // The engine reports failures per item; this control's contract is a single
  // onError callback, so mirror it across rather than making callers read both.
  React.useEffect(() => {
    if (item?.state === "error" && item.error) onError?.(item.error);
  }, [item?.state, item?.error, onError]);

  function attach(file: File | null) {
    if (!file) return;
    const problem = scanFileProblem(file);
    if (problem) return onError?.(problem);
    onError?.(null);
    void upload.pick([file]);
  }

  async function open() {
    if (!vaultId) return;
    setBusy("open");
    try {
      await openVaultDoc(vaultId);
    } catch (e) {
      onError?.(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="inline-flex items-center gap-3">
      {vaultId && (
        <button
          type="button"
          className={linkCls}
          disabled={busy !== null}
          onClick={() => void open()}
        >
          {busy === "open" ? "Opening…" : "View"}
        </button>
      )}
      <FilePicker
        variant="inline"
        accept={SCAN_ACCEPT}
        disabled={busy !== null || disabled || item?.state === "uploading"}
        trigger={
          item?.state === "compressing"
            ? "Optimising…"
            : item?.state === "uploading"
              ? "Uploading…"
              : vaultId
                ? "Replace"
                : labelWhenEmpty
        }
        onPick={(files) => attach(files?.[0] ?? null)}
      />
      {/* The preview the control never had. Small, because this sits inline in
          a table row — but present, so attaching the wrong scan is visible at
          the moment it happens rather than months later. */}
      {item?.previewUrl && (
        <img
          src={item.previewUrl}
          alt=""
          className="h-6 w-6 rounded border object-cover"
        />
      )}
      {item && (item.state === "uploading" || item.state === "compressing") && (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.percent}
        >
          <span className="num">{item.percent}%</span>
        </span>
      )}
      {item?.state === "success" && (
        <span className="text-xs text-ok" role="status">
          ✓
        </span>
      )}
    </span>
  );
}
