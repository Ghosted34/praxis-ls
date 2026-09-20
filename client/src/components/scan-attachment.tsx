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
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { useUpload } from "@/lib/use-upload";

const linkCls =
  "text-sm text-primary-ink underline underline-offset-2 hover:opacity-80 disabled:opacity-50";

/**
 * The compact trigger's own look — the SAME control as the link above, wearing
 * the card's clothing.
 *
 * On a phone the row is a card, and the card's other control is the `⋯` menu
 * (`components/ui/more-menu.tsx`) — a bordered 36px square. An underlined orange
 * link beside it reads as two unrelated things and gives the primary action the
 * smaller target of the two. So both become bordered 36px controls and the
 * primary one keeps the brand colour in its text.
 */
const compactBtnCls =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-micro font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ScanAttachment({
  vaultId,
  docType,
  entityRef,
  onAttached,
  onError,
  disabled,
  labelWhenEmpty = "Attach scan",
  compact = false,
  openRef,
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
  /**
   * ONE control instead of two — the phone-card variant.
   *
   * On a desktop table row both halves earn their place side by side: "View"
   * opens the scan, "Replace" swaps it, and the reader has the width for both.
   * On a 390px card the same pair is two underlined links plus whatever the
   * kebab holds, and the row has room for exactly one of them. Compact shows
   * the one the row is FOR — View when there is a file to open, the picker when
   * there is not — and leaves "Replace" to the card's action menu, which drives
   * the same picker through `openRef`.
   */
  compact?: boolean;
  /**
   * Hands the caller a function that opens the engine's picker, so an ACTION
   * MENU can offer "Replace file" without a second `<input type="file">` (which
   * `praxis/no-raw-upload` forbids anyway) and without the input unmounting
   * between the menu item and the pick. Already the pattern in the chat
   * composer's attach menu.
   */
  openRef?: React.Ref<() => void>;
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

  const picker = (
    <FilePicker
      variant="inline"
      accept={SCAN_ACCEPT}
      openRef={openRef}
      disabled={busy !== null || disabled || item?.state === "uploading"}
      triggerClassName={compact ? compactBtnCls : undefined}
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
  );

  const viewButton = (
    <button
      type="button"
      className={compact ? compactBtnCls : linkCls}
      disabled={busy !== null}
      onClick={() => void open()}
    >
      {busy === "open" ? "Opening…" : "View"}
    </button>
  );

  return (
    <span className={compact ? "inline-flex items-center gap-2" : "inline-flex items-center gap-3"}>
      {vaultId && viewButton}
      {/* Compact with a file already attached: the picker is present but
          unlabelled — the card's `⋯` menu owns "Replace file" and calls in here
          through `openRef`, the same way the chat composer's attach menu does.
          It has to stay MOUNTED for that to work (a hidden `display:none` file
          input still opens the dialog when a user gesture clicks it), which is
          why this is a wrapper rather than a conditional. */}
      {compact && vaultId ? <span className="hidden">{picker}</span> : picker}
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

/**
 * ScanCardActions — `<ScanAttachment compact>` plus the `⋯` menu, as one unit.
 *
 * This is the phone-card action cluster, and it exists because the two halves
 * are not independent: the menu's "Replace file" drives the attachment's picker
 * through a ref, and the attachment's visible control changes with the same
 * fact ("is there a file yet?") that decides whether "Replace" belongs in the
 * menu at all. Split across two call sites, that pairing is three things to
 * keep in step on every screen that grows a card row — which is how the four
 * hand-rolled variants of this control happened in the first place.
 *
 * The order is the one the app uses everywhere: the primary action visible, the
 * rest behind `⋯`. The FILE action leads the menu — it is the fact about this
 * row's content, the way "Open" leads a file manager's menu — the caller's own
 * items follow after a separator, and the caller puts anything destructive last
 * in its own group.
 *
 * @example
 * <ScanCardActions
 *   vaultId={doc.vault_id}
 *   docType="CLIENT_DOCUMENT"
 *   entityRef={`client_document:${doc.document_id}`}
 *   onAttached={(id) => linkScan(doc, id)}
 *   onError={setError}
 *   menuItems={<DropdownItem onSelect={verify}>Verify</DropdownItem>}
 * />
 */
export function ScanCardActions({
  vaultId,
  docType,
  entityRef,
  onAttached,
  onError,
  disabled,
  labelWhenEmpty = "Attach scan",
  menuLabel,
  menuItems,
}: {
  vaultId?: string | null;
  docType: string;
  entityRef: string;
  onAttached: (vaultId: string) => void | Promise<void>;
  onError?: (message: string | null) => void;
  disabled?: boolean;
  labelWhenEmpty?: string;
  /** Accessible name of the menu ("Document actions"). */
  menuLabel: string;
  /** The caller's own items — Verify, Edit, Remove — rendered after the file
   *  action under a separator. */
  menuItems?: React.ReactNode;
}) {
  const pickRef = React.useRef<(() => void) | null>(null);

  return (
    <>
      <ScanAttachment
        compact
        vaultId={vaultId}
        docType={docType}
        entityRef={entityRef}
        onAttached={onAttached}
        onError={onError}
        disabled={disabled}
        labelWhenEmpty={labelWhenEmpty}
        openRef={pickRef}
      />
      <MoreMenu label={menuLabel} disabled={disabled}>
        <DropdownItem onSelect={() => pickRef.current?.()}>
          {vaultId ? "Replace file" : labelWhenEmpty}
        </DropdownItem>
        {menuItems && <DropdownSeparator />}
        {menuItems}
      </MoreMenu>
    </>
  );
}
