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
  readFileAsDataUrl,
  scanFileProblem,
} from "@/lib/vault-file";
import { errMsg } from "@/lib/use-resource";

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
  const [progress, setProgress] = React.useState<number | null>(null);
  const [uploadSuccess, setUploadSuccess] = React.useState(false);

  async function attach(file: File | null) {
    if (!file) return;
    const problem = scanFileProblem(file);
    if (problem) return onError?.(problem);
    setBusy("upload");
    setProgress(0);
    setUploadSuccess(false);
    onError?.(null);
    try {
      const vaulted = await api.uploadVaultDocument(
        {
          data_url: await readFileAsDataUrl(file),
          doc_type: docType,
          entity_ref: entityRef,
        },
        setProgress,
      );
      await onAttached(vaulted.doc_id);
      setProgress(100);
      setUploadSuccess(true);
    } catch (e) {
      setProgress(null);
      setUploadSuccess(false);
      onError?.(errMsg(e));
    } finally {
      setBusy(null);
    }
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
      <label
        className={`cursor-pointer ${linkCls} ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {busy === "upload"
          ? "Uploading…"
          : vaultId
            ? "Replace"
            : labelWhenEmpty}
        <input
          type="file"
          className="sr-only"
          accept={SCAN_ACCEPT}
          disabled={busy !== null || disabled}
          onChange={(ev) => {
            const file = ev.target.files?.[0] ?? null;
            // Clear the input so re-picking the same file fires onChange again.
            ev.target.value = "";
            void attach(file);
          }}
        />
      </label>
      {busy === "upload" && progress !== null && (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span className="num">{progress}%</span>
        </span>
      )}
      {uploadSuccess && (
        <span className="text-xs text-ok" role="status">
          ✓
        </span>
      )}
    </span>
  );
}
